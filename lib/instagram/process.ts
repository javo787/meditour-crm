// Обработка событий вебхука Instagram: публичный и личный ответ на комментарий, приглашение в Direct,
// cooldown по контакту и защита от повторной доставки и параллельных дублей. Зависимости передаются снаружи,
// поэтому всё тестируется без сети, MongoDB и реальных таймеров.
import { createLogger, type Logger } from "@/lib/logger";

import type { InstagramConfig } from "./config";
import * as graphModule from "./graph";
import type { GraphResult } from "./graph";
import { buildCommentPrivateReply, buildCommentReply, buildDirectInvite, isWorthReplying } from "./replies";
import * as storeModule from "./store";
import type { InstagramEvent } from "./webhook";

export interface ProcessDeps {
  cfg: InstagramConfig;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: Logger;
  getToken?: () => Promise<string>;
  store?: Pick<typeof storeModule, "claimEvent" | "getContact" | "markDmInvited" | "markCommentReplied">;
  graph?: Pick<typeof graphModule, "replyToComment" | "sendDirect">;
}

export type EventOutcome = { key: string; outcome: "replied" | "skipped" | "failed"; reason?: string };

type Store = NonNullable<ProcessDeps["store"]>;
type Graph = NonNullable<ProcessDeps["graph"]>;

interface Ctx {
  cfg: InstagramConfig;
  store: Store;
  graph: Graph;
  log: Logger;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  getToken: () => Promise<string>;
}

type CommentEvent = Extract<InstagramEvent, { type: "comment" }>;
type DmEvent = Extract<InstagramEvent, { type: "dm" }>;
type EchoEvent = Extract<InstagramEvent, { type: "echo" }>;

// Паузы «как у живого человека»: значение = минимум + random() * span.
const DM_DELAY = { min: 4000, span: 6000 };
const COMMENT_DELAY = { min: 15000, span: 30000 };
const PRIVATE_DELAY = { min: 2000, span: 4000 };

// Занятые отправители: пока одно событие отправителя обрабатывается, параллельные события того же отправителя пропускаются.
// NOTE: модульное состояние допустимо, потому что сервис работает в одном процессе (WEB_CONCURRENCY=1).
const inflight = new Set<string>();

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function randomDelay(random: () => number, range: { min: number; span: number }): number {
  return range.min + random() * range.span;
}

function eventKey(event: InstagramEvent): string {
  if (event.type === "comment") return `comment:${event.commentId}`;
  if (event.type === "dm") return `dm:${event.mid}`;
  return `echo:${event.mid}`;
}

// Cooldown: с отметки прошло меньше cooldownMs. Нет отметки или дата не разбирается — cooldown не действует.
function inCooldown(iso: string | undefined, now: Date, cooldownMs: number): boolean {
  return iso !== undefined && now.getTime() - Date.parse(iso) < cooldownMs;
}

function whatsappCtx(cfg: InstagramConfig) {
  return { whatsappNumber: cfg.whatsappNumber, whatsappDigits: cfg.whatsappDigits };
}

// Причина сбоя Graph — только статус и код: тексты ошибок API и токены в логи не попадают.
function describeFailure(res: GraphResult<unknown>): string {
  if (res.ok) return "ok";
  return res.code === undefined ? `status ${res.status}` : `status ${res.status}, code ${res.code}`;
}

// Итог события: в лог уходят только идентификатор события и причина, без текстов и имён.
function outcome(ctx: Ctx, key: string, result: EventOutcome["outcome"], reason?: string): EventOutcome {
  const entry: EventOutcome = reason === undefined ? { key, outcome: result } : { key, outcome: result, reason };
  if (result === "failed") ctx.log.error("событие Instagram не отправлено", entry);
  else ctx.log.info("событие Instagram обработано", entry);
  return entry;
}

// Эхо: это наш аккаунт написал человеку (бот или сотрудник вручную). Бот молчит в этом диалоге весь cooldown.
async function handleEcho(event: EchoEvent, ctx: Ctx, key: string): Promise<EventOutcome> {
  if (event.recipientId === event.accountId) return outcome(ctx, key, "skipped", "own");
  await ctx.store.markDmInvited(event.recipientId, ctx.now());
  return outcome(ctx, key, "skipped", "echo");
}

// Личное сообщение: приглашение в WhatsApp. Отметка ставится до паузы, поэтому второе сообщение во время паузы не запустит второе приглашение.
async function handleDm(event: DmEvent, ctx: Ctx, key: string): Promise<EventOutcome> {
  if (event.senderId === event.accountId) return outcome(ctx, key, "skipped", "own");
  const now = ctx.now();
  if (!(await ctx.store.claimEvent(key, now))) return outcome(ctx, key, "skipped", "duplicate");

  const lock = `dm:${event.senderId}`;
  if (inflight.has(lock)) return outcome(ctx, key, "skipped", "inflight");
  inflight.add(lock);
  try {
    const contact = await ctx.store.getContact(event.senderId);
    if (inCooldown(contact?.lastDmInviteAt, now, ctx.cfg.dmCooldownMs)) {
      return outcome(ctx, key, "skipped", "cooldown");
    }

    await ctx.store.markDmInvited(event.senderId, now);
    if (ctx.cfg.replyDelay) await ctx.sleep(randomDelay(ctx.random, DM_DELAY));

    const token = await ctx.getToken();
    const text = buildDirectInvite({ text: event.text ?? "", ...whatsappCtx(ctx.cfg) });
    const res = await ctx.graph.sendDirect(ctx.cfg, token, { userId: event.senderId }, text);
    return res.ok ? outcome(ctx, key, "replied") : outcome(ctx, key, "failed", describeFailure(res));
  } finally {
    inflight.delete(lock);
  }
}

// Комментарий верхнего уровня: публичный ответ, затем личный ответ (Direct) по comment_id.
// Ответы на ответы, свои комментарии и комментарии без смысла пропускаются.
async function handleComment(event: CommentEvent, ctx: Ctx, key: string): Promise<EventOutcome> {
  if (event.fromId === event.accountId) return outcome(ctx, key, "skipped", "own");
  if (event.parentId !== undefined) return outcome(ctx, key, "skipped", "reply");
  if (!isWorthReplying(event.text)) return outcome(ctx, key, "skipped", "not-worth");

  const now = ctx.now();
  if (!(await ctx.store.claimEvent(key, now))) return outcome(ctx, key, "skipped", "duplicate");

  const lock = `comment:${event.fromId}`;
  if (inflight.has(lock)) return outcome(ctx, key, "skipped", "inflight");
  inflight.add(lock);
  try {
    const contact = await ctx.store.getContact(event.fromId);
    if (inCooldown(contact?.lastCommentReplyAt, now, ctx.cfg.commentCooldownMs)) {
      return outcome(ctx, key, "skipped", "cooldown");
    }

    await ctx.store.markCommentReplied(event.fromId, now);
    if (ctx.cfg.replyDelay) await ctx.sleep(randomDelay(ctx.random, COMMENT_DELAY));

    const token = await ctx.getToken();
    const publicRes = await ctx.graph.replyToComment(
      ctx.cfg,
      token,
      event.commentId,
      buildCommentReply({ text: event.text, commentId: event.commentId, ...whatsappCtx(ctx.cfg) }),
    );
    if (!publicRes.ok) {
      ctx.log.error("публичный ответ на комментарий не отправлен", { key, reason: describeFailure(publicRes) });
    }

    // Личный ответ не шлём, если этому человеку недавно уже писали в Direct. Контакт перечитываем: за паузу перед
    // публичным ответом ему могли отправить приглашение (или сотрудник мог ответить вручную).
    const fresh = await ctx.store.getContact(event.fromId);
    let privateRes: GraphResult<unknown> | null = null;
    if (!inCooldown(fresh?.lastDmInviteAt, ctx.now(), ctx.cfg.dmCooldownMs)) {
      if (ctx.cfg.replyDelay) await ctx.sleep(randomDelay(ctx.random, PRIVATE_DELAY));
      privateRes = await ctx.graph.sendDirect(
        ctx.cfg,
        token,
        { commentId: event.commentId },
        buildCommentPrivateReply({ text: event.text, ...whatsappCtx(ctx.cfg) }),
      );
      if (privateRes.ok) {
        await ctx.store.markDmInvited(event.fromId, now);
      } else {
        ctx.log.error("личный ответ на комментарий не отправлен", { key, reason: describeFailure(privateRes) });
      }
    }

    if (publicRes.ok || privateRes?.ok) return outcome(ctx, key, "replied");
    const privateReason = privateRes ? `private ${describeFailure(privateRes)}` : "private cooldown";
    return outcome(ctx, key, "failed", `public ${describeFailure(publicRes)}; ${privateReason}`);
  } finally {
    inflight.delete(lock);
  }
}

// Ошибка обработки одного события не должна задевать остальные события пачки.
async function processEvent(event: InstagramEvent, ctx: Ctx): Promise<EventOutcome> {
  const key = eventKey(event);
  try {
    if (event.type === "echo") return await handleEcho(event, ctx, key);
    if (event.type === "dm") return await handleDm(event, ctx, key);
    return await handleComment(event, ctx, key);
  } catch (err) {
    ctx.log.error("ошибка при обработке события Instagram", {
      key,
      reason: "exception",
      error: err instanceof Error ? err.name : "unknown",
    });
    return { key, outcome: "failed", reason: "exception" };
  }
}

// Никогда не бросает исключений: каждое событие получает свой итог.
export async function processInstagramEvents(events: InstagramEvent[], deps: ProcessDeps): Promise<EventOutcome[]> {
  const cfg = deps.cfg;
  const log = deps.log ?? createLogger("instagram");
  const ctx: Ctx = {
    cfg,
    store: deps.store ?? storeModule,
    graph: deps.graph ?? graphModule,
    log,
    now: deps.now ?? (() => new Date()),
    sleep: deps.sleep ?? defaultSleep,
    random: deps.random ?? Math.random,
    getToken: deps.getToken ?? (() => storeModule.ensureFreshToken(cfg.accessToken, graphModule.refreshAccessToken)),
  };

  if (!cfg.enabled) return events.map((event) => outcome(ctx, eventKey(event), "skipped", "disabled"));
  if (!cfg.accessToken) {
    log.warn("INSTAGRAM_ACCESS_TOKEN не задан: события Instagram пропущены", { events: events.length });
    return events.map((event) => outcome(ctx, eventKey(event), "skipped", "no-token"));
  }

  const settled = await Promise.allSettled(events.map((event) => processEvent(event, ctx)));
  return settled.map((result, i) =>
    result.status === "fulfilled" ? result.value : outcome(ctx, eventKey(events[i]), "failed", "exception"),
  );
}

// Обработка событий вебхука Instagram: публичный и личный ответ на комментарий, приглашение в Direct, ответы ИИ
// в Direct (при aiReplies), cooldown по контакту и защита от повторной доставки и параллельных дублей.
// Зависимости передаются снаружи, поэтому всё тестируется без сети, MongoDB и реальных таймеров.
import { createLogger, type Logger } from "@/lib/logger";
import type { ChatMessage } from "@/lib/types";

import * as aiModule from "./ai";
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
  store?: Pick<
    typeof storeModule,
    | "claimEvent"
    | "getContact"
    | "markDmInvited"
    | "markCommentReplied"
    | "addIgMessage"
    | "getIgMessages"
    | "countIgAiMessagesSince"
    | "pauseAi"
    | "findIgMessageByMid"
  >;
  graph?: Pick<typeof graphModule, "replyToComment" | "sendDirect">;
  ai?: Pick<typeof aiModule, "composeDirectReply">;
}

export type EventOutcome = { key: string; outcome: "replied" | "skipped" | "failed"; reason?: string };

type Store = NonNullable<ProcessDeps["store"]>;
type Graph = NonNullable<ProcessDeps["graph"]>;
type AiDeps = NonNullable<ProcessDeps["ai"]>;
type DirectResult = GraphResult<{ recipient_id: string; message_id: string }>;

interface Ctx {
  cfg: InstagramConfig;
  store: Store;
  graph: Graph;
  ai: AiDeps;
  log: Logger;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  getToken: () => Promise<string>;
}

// Итог одного хода ИИ: ответ отправлен, отвечать нечего, отвечать нельзя (причина) или отправка не удалась (причина).
type TurnStep =
  | { kind: "sent" }
  | { kind: "idle" }
  | { kind: "stop"; reason: string }
  | { kind: "failed"; reason: string };

type CommentEvent = Extract<InstagramEvent, { type: "comment" }>;
type DmEvent = Extract<InstagramEvent, { type: "dm" }>;
type EchoEvent = Extract<InstagramEvent, { type: "echo" }>;

// Паузы «как у живого человека»: значение = минимум + random() * span.
const DM_DELAY = { min: 4000, span: 6000 };
const COMMENT_DELAY = { min: 15000, span: 30000 };
const PRIVATE_DELAY = { min: 2000, span: 4000 };
const BUBBLE_DELAY = { min: 1500, span: 2000 }; // между пузырями ответа ИИ
const ECHO_SETTLE_MS = 1500; // даёт записать собственное сообщение бота в переписку до разбора эха

const HISTORY_LIMIT = 30; // сколько последних сообщений переписки получает модель
const MAX_AI_TURNS = 3; // ходов ИИ за один захват блокировки отправителя
const DAY_MS = 24 * 60 * 60 * 1000;
const ECHO_BOT_WINDOW_MS = 30 * 1000; // эхо считаем своим, если бот писал этому человеку не позже чем за 30 секунд
const BOT_SEND_KEEP_MS = 60 * 1000; // записи журнала отправок старше этого удаляются

// Текст в переписке вместо вложения, комментария под постом и сообщения сотрудника без текста.
const ATTACHMENT_TEXT = "[вложение]";
const COMMENT_CONTEXT = "[комментарий под постом]";
const STAFF_TEXT = "[сообщение сотрудника]";

// Занятые отправители: пока одно событие отправителя обрабатывается, параллельные события того же отправителя пропускаются.
// NOTE: модульное состояние допустимо, потому что сервис работает в одном процессе (WEB_CONCURRENCY=1).
const inflight = new Set<string>();
// Отправители, чьи сообщения пришли, пока их переписку вёл другой ход. Холдер блокировки проверит переписку ещё раз.
const pendingMerges = new Set<string>();
// Когда бот в последний раз писал человеку (id → мс). По этому журналу распознаём эхо собственных сообщений.
const lastBotSend = new Map<string, number>();

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Для тестов: очищает журнал отправок бота, чтобы тесты не влияли друг на друга.
export function resetBotSendLogForTests(): void {
  lastBotSend.clear();
}

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

// Пауза ИИ действует, пока её момент впереди. Нет отметки или дата не разбирается — пауза не действует.
function isPaused(iso: string | undefined, now: Date): boolean {
  return iso !== undefined && Date.parse(iso) > now.getTime();
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

// Журнал отправок бота: запоминаем, кому и когда бот писал, чтобы узнать его эхо.
function noteBotSend(recipientId: string, atMs: number): void {
  for (const [id, sentAt] of lastBotSend) {
    if (atMs - sentAt > BOT_SEND_KEEP_MS) lastBotSend.delete(id);
  }
  lastBotSend.set(recipientId, atMs);
}

function sentByBotRecently(recipientId: string, nowMs: number): boolean {
  const sentAt = lastBotSend.get(recipientId);
  return sentAt !== undefined && nowMs - sentAt <= ECHO_BOT_WINDOW_MS;
}

// Шаблонное приглашение в Direct, одинаковое для старого режима и для первого обращения в режиме ИИ.
// Отметка ставится до паузы, поэтому повторное сообщение во время паузы не запустит второе приглашение.
async function sendInviteTemplate(
  ctx: Ctx,
  senderId: string,
  lastText: string,
  now: Date,
): Promise<{ text: string; res: DirectResult }> {
  await ctx.store.markDmInvited(senderId, now);
  if (ctx.cfg.replyDelay) await ctx.sleep(randomDelay(ctx.random, DM_DELAY));

  const token = await ctx.getToken();
  const text = buildDirectInvite({ text: lastText, ...whatsappCtx(ctx.cfg) });
  noteBotSend(senderId, ctx.now().getTime());
  const res = await ctx.graph.sendDirect(ctx.cfg, token, { userId: senderId }, text);
  return { text, res };
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

    const { res } = await sendInviteTemplate(ctx, event.senderId, event.text ?? "", now);
    return res.ok ? outcome(ctx, key, "replied") : outcome(ctx, key, "failed", describeFailure(res));
  } finally {
    inflight.delete(lock);
  }
}

// Хвост переписки: подряд идущие сообщения пациента после последнего ответа бота или сотрудника.
function unansweredRun(history: ChatMessage[]): ChatMessage[] {
  let start = history.length;
  while (start > 0 && history[start - 1].from === "patient") start--;
  return history.slice(start);
}

// Личное сообщение в режиме ИИ: сообщение сохраняется всегда, отвечает ИИ по переписке.
async function handleDmAi(event: DmEvent, ctx: Ctx, key: string): Promise<EventOutcome> {
  if (event.senderId === event.accountId) return outcome(ctx, key, "skipped", "own");
  const now = ctx.now();
  if (!(await ctx.store.claimEvent(key, now))) return outcome(ctx, key, "skipped", "duplicate");

  const text = event.text?.trim() || (event.hasAttachment ? ATTACHMENT_TEXT : "");
  if (text === "") return outcome(ctx, key, "skipped", "empty");
  await ctx.store.addIgMessage({ igUserId: event.senderId, from: "patient", text, at: now, mid: event.mid });

  const contact = await ctx.store.getContact(event.senderId);
  if (isPaused(contact?.aiPausedUntil, now)) return outcome(ctx, key, "skipped", "paused");

  const lock = `dm:${event.senderId}`;
  if (inflight.has(lock)) {
    // Сообщение уже в переписке: ход, который держит блокировку, на него ответит.
    pendingMerges.add(event.senderId);
    return outcome(ctx, key, "skipped", "merged");
  }
  inflight.add(lock);
  try {
    return await runAiTurns(event.senderId, key, ctx);
  } finally {
    inflight.delete(lock);
    pendingMerges.delete(event.senderId);
  }
}

// Ходы ИИ, пока есть непрочитанные сообщения: не больше MAX_AI_TURNS за один захват блокировки.
async function runAiTurns(senderId: string, key: string, ctx: Ctx): Promise<EventOutcome> {
  let sent = false;
  let last: TurnStep = { kind: "idle" };
  for (let turn = 0; turn < MAX_AI_TURNS; turn++) {
    last = await runAiTurn(senderId, key, ctx);
    if (last.kind === "sent") {
      sent = true;
      continue;
    }
    // Сообщения, пришедшие во время захвата блокировки, не должны остаться без ответа.
    if (last.kind === "idle" && pendingMerges.delete(senderId)) continue;
    break;
  }

  if (sent) return outcome(ctx, key, "replied");
  if (last.kind === "failed") return outcome(ctx, key, "failed", last.reason);
  if (last.kind === "stop") return outcome(ctx, key, "skipped", last.reason);
  return outcome(ctx, key, "skipped", "answered");
}

// Один ход: ответ на хвост непрочитанных сообщений пациента.
async function runAiTurn(senderId: string, key: string, ctx: Ctx): Promise<TurnStep> {
  const history = await ctx.store.getIgMessages(senderId, HISTORY_LIMIT);
  const readAt = ctx.now();
  const run = unansweredRun(history);
  if (run.length === 0) return { kind: "idle" };

  const contact = await ctx.store.getContact(senderId);
  if (isPaused(contact?.aiPausedUntil, ctx.now())) return { kind: "stop", reason: "paused" };

  // Первое обращение: бот этому человеку ещё ничего не писал (ни в переписке, ни до появления ИИ-режима, когда
  // приглашение отмечалось только в контакте), поэтому шаблонное приглашение в WhatsApp. Уже приглашённого человека
  // не оставляем в молчании на весь cooldown: ему отвечает ИИ.
  const alreadyInvited = history.some((m) => m.from === "ai") || contact?.lastDmInviteAt !== undefined;
  if (!alreadyInvited) return sendTemplateReply(senderId, run[run.length - 1].text, readAt, ctx);

  const sinceIso = new Date(ctx.now().getTime() - DAY_MS).toISOString();
  if ((await ctx.store.countIgAiMessagesSince(senderId, sinceIso)) >= ctx.cfg.aiDailyLimit) {
    return { kind: "stop", reason: "limit" };
  }

  // Пауза перед ответом по-человечески; за неё успевает прийти пачка сообщений.
  if (ctx.cfg.replyDelay) await ctx.sleep(randomDelay(ctx.random, DM_DELAY));

  // Переписку перечитываем после паузы: могли прийти новые сообщения или ответить сотрудник (тогда ответа не будет).
  const fresh = await ctx.store.getIgMessages(senderId, HISTORY_LIMIT);
  // Ответ датируется моментом чтения: всё, что придёт позже, окажется в переписке после ответа и получит свой ход.
  const answeredAt = ctx.now();
  const items = unansweredRun(fresh);
  if (items.length === 0) return { kind: "idle" };
  const base = fresh.slice(0, fresh.length - items.length);

  const reply = await composeReply(base, items, key, ctx);
  if (reply?.kind === "reply") return sendAiBubbles(senderId, key, reply.bubbles, answeredAt, ctx);
  if (reply?.kind === "handoff") {
    await ctx.store.pauseAi(senderId, new Date(ctx.now().getTime() + ctx.cfg.dmCooldownMs));
  }
  ctx.log.info("ИИ не дал ответа: отправляем приглашение в WhatsApp", {
    key,
    reason: reply?.kind === "none" ? reply.reason : (reply?.kind ?? "error"),
  });
  return sendTemplateReply(senderId, items[items.length - 1].text, answeredAt, ctx);
}

// Приглашение в WhatsApp как ответ ИИ: в пределах cooldown молчим, отправленное записываем в переписку.
async function sendTemplateReply(senderId: string, lastText: string, answeredAt: Date, ctx: Ctx): Promise<TurnStep> {
  const now = ctx.now();
  const contact = await ctx.store.getContact(senderId);
  if (inCooldown(contact?.lastDmInviteAt, now, ctx.cfg.dmCooldownMs)) return { kind: "stop", reason: "cooldown" };

  const { text, res } = await sendInviteTemplate(ctx, senderId, lastText, now);
  if (!res.ok) return { kind: "failed", reason: describeFailure(res) };
  await ctx.store.addIgMessage({ igUserId: senderId, from: "ai", text, at: answeredAt, mid: res.data.message_id });
  return { kind: "sent" };
}

// Ответ модели. Сбой модели не выходит наружу: вместо ответа уйдёт приглашение.
async function composeReply(
  base: ChatMessage[],
  items: ChatMessage[],
  key: string,
  ctx: Ctx,
): Promise<aiModule.DirectReply | null> {
  try {
    return await ctx.ai.composeDirectReply({
      history: base,
      items: items.map((m) => ({ text: m.text })),
      ctx: whatsappCtx(ctx.cfg),
      now: ctx.now(),
      requestId: key,
    });
  } catch (err) {
    ctx.log.error("ошибка ИИ при ответе в Direct", { key, error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}

// Пузыри по порядку. Сбой пузыря останавливает отправку; уже отправленные пузыри записаны в переписку.
async function sendAiBubbles(
  senderId: string,
  key: string,
  bubbles: string[],
  answeredAt: Date,
  ctx: Ctx,
): Promise<TurnStep> {
  const token = await ctx.getToken();
  let sentCount = 0;
  for (let i = 0; i < bubbles.length; i++) {
    if (i > 0 && ctx.cfg.replyDelay) await ctx.sleep(randomDelay(ctx.random, BUBBLE_DELAY));
    noteBotSend(senderId, ctx.now().getTime());
    const res = await ctx.graph.sendDirect(ctx.cfg, token, { userId: senderId }, bubbles[i]);
    if (!res.ok) {
      const reason = describeFailure(res);
      ctx.log.error("пузырь ответа ИИ не отправлен", { key, reason, sent: sentCount });
      return sentCount > 0 ? { kind: "sent" } : { kind: "failed", reason };
    }
    await ctx.store.addIgMessage({
      igUserId: senderId,
      from: "ai",
      text: bubbles[i],
      at: answeredAt,
      mid: res.data.message_id,
    });
    sentCount++;
  }
  return { kind: "sent" };
}

// Эхо в режиме ИИ. Своё сообщение бота молча пропускаем. Написанное сотрудником из приложения сохраняем в переписку,
// ставим ИИ на паузу и блокируем приглашение на время cooldown.
async function handleEchoAi(event: EchoEvent, ctx: Ctx, key: string): Promise<EventOutcome> {
  if (event.recipientId === event.accountId) return outcome(ctx, key, "skipped", "own");
  if (ctx.cfg.replyDelay) await ctx.sleep(ECHO_SETTLE_MS);

  const now = ctx.now();
  if ((await ctx.store.findIgMessageByMid(event.mid)) || sentByBotRecently(event.recipientId, now.getTime())) {
    return outcome(ctx, key, "skipped", "echo-bot");
  }
  await ctx.store.addIgMessage({
    igUserId: event.recipientId,
    from: "coordinator",
    text: event.text ?? STAFF_TEXT,
    at: now,
    mid: event.mid,
  });
  await ctx.store.pauseAi(event.recipientId, new Date(now.getTime() + ctx.cfg.dmCooldownMs));
  await ctx.store.markDmInvited(event.recipientId, now);
  return outcome(ctx, key, "skipped", "echo-staff");
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

    // В режиме ИИ сам комментарий попадает в переписку: личный разговор продолжится с учётом вопроса из-под поста.
    if (ctx.cfg.aiReplies) {
      await ctx.store.addIgMessage({
        igUserId: event.fromId,
        from: "patient",
        text: `${COMMENT_CONTEXT} ${event.text}`,
        at: now,
      });
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
    let privateRes: DirectResult | null = null;
    if (!inCooldown(fresh?.lastDmInviteAt, ctx.now(), ctx.cfg.dmCooldownMs)) {
      if (ctx.cfg.replyDelay) await ctx.sleep(randomDelay(ctx.random, PRIVATE_DELAY));
      const privateText = buildCommentPrivateReply({ text: event.text, ...whatsappCtx(ctx.cfg) });
      noteBotSend(event.fromId, ctx.now().getTime());
      privateRes = await ctx.graph.sendDirect(ctx.cfg, token, { commentId: event.commentId }, privateText);
      if (privateRes.ok) {
        await ctx.store.markDmInvited(event.fromId, now);
        if (ctx.cfg.aiReplies) {
          await ctx.store.addIgMessage({
            igUserId: event.fromId,
            from: "ai",
            text: privateText,
            at: ctx.now(),
            mid: privateRes.data.message_id,
          });
        }
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
    if (event.type === "echo") {
      return ctx.cfg.aiReplies ? await handleEchoAi(event, ctx, key) : await handleEcho(event, ctx, key);
    }
    if (event.type === "dm") {
      return ctx.cfg.aiReplies ? await handleDmAi(event, ctx, key) : await handleDm(event, ctx, key);
    }
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
    ai: deps.ai ?? aiModule,
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

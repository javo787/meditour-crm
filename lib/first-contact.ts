import {
  addMessage,
  claimFirstContactTouch1,
  closeFirstContact,
  getFirstContactCandidates,
  getMessages,
  revertFirstContactTouch1,
  saveFirstContactSchedule,
} from "@/lib/db";
import { sendWhatsAppText } from "@/lib/evolution";
import { FIRST_CONTACT_CONFIG } from "@/lib/first-contact-config";
import { composeFirstContactMessage, summarizeLeadBrief } from "@/lib/gemini";
import { createLogger, newRequestId } from "@/lib/logger";
import { DEFAULT_CRM_TIMEZONE, endOfDayInZone } from "@/lib/touches";
import { buildAnamnesisTranscript } from "@/lib/transcripts";
import type { ChatMessage, Lead } from "@/lib/types";

const log = createLogger("first-contact");

// Каденция первых контактов. Лид написал, бот ответил (приветствие, видео), а пациент молчит:
//   • через 3 часа тишины ИИ один раз читает переписку и записывает краткую сводку лида (aiBrief);
//     касание переносится на +2 дня от последнего сообщения бота;
//   • через 2 дня ИИ пишет пациенту одно короткое сообщение по сводке, касание — на +1 неделю;
//   • ещё через неделю без ответа лид получает «Без ответа» и уходит из касаний.
// Любое сообщение пациента обнуляет цикл (см. addMessage в lib/db.ts). Подробности и защиты — ниже.

export { FIRST_CONTACT_CONFIG };

export function crmTimeZone(): string {
  return process.env.CRM_TIMEZONE || DEFAULT_CRM_TIMEZONE;
}

// ───────────────────────── решение (чистая логика) ─────────────────────────

export type DecisionMessage = Pick<ChatMessage, "from" | "at" | "text"> &
  Partial<Pick<ChatMessage, "deliveryFailed">> & { transcript?: { text: string } };

export type CloseReason = "silent-week" | "stale" | "opt-out";

export type FirstContactDecision =
  | { kind: "skip"; reason: string }
  | { kind: "summarize"; cycleKey: string; anchorAt: string; touch1DueAt: string }
  | { kind: "send-touch1"; cycleKey: string }
  | { kind: "close"; reason: CloseReason };

// Пациент просил не писать (русский, таджикский, узбекский): тогда не пишем сами, лид сразу «Без ответа».
const OPT_OUT =
  /не\s+пишите|не\s+беспокойте|не\s+надо\s+(?:мне\s+)?писать|не\s+звоните|отстаньте|прекратите\s+(?:писать|рассылку)|\bstop\b|yozmang|bezovta\s+qilmang|нанависед|безовта\s+накунед/i;

export function isOptOut(text: string): boolean {
  return OPT_OUT.test(text);
}

export function hasUsablePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 15;
}

export function hourInZone(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function inSendWindow(now: Date, timeZone: string): boolean {
  const hour = hourInZone(now, timeZone);
  return hour >= FIRST_CONTACT_CONFIG.windowStartHour && hour < FIRST_CONTACT_CONFIG.windowEndHour;
}

function skip(reason: string): FirstContactDecision {
  return { kind: "skip", reason };
}

/**
 * Что делать с лидом прямо сейчас. Состояние цикла берётся из lead.firstContact; оно привязано к времени
 * последнего сообщения пациента (cycleKey), поэтому новое сообщение пациента начинает цикл заново.
 */
export function decideFirstContact(input: {
  lead: Lead;
  messages: DecisionMessage[];
  now: Date;
  timeZone: string;
}): FirstContactDecision {
  const { lead, messages, now, timeZone } = input;
  const cfg = FIRST_CONTACT_CONFIG;

  if (lead.stage !== "new" && lead.stage !== "first_contact") return skip("stage");
  if (lead.aiPaused) return skip("ai-paused");
  if (lead.noResponse) return skip("no-response");
  if (!hasUsablePhone(lead.phone)) return skip("no-phone");

  const last = messages[messages.length - 1];
  if (!last) return skip("no-messages");
  if (last.from === "patient") return skip("patient-last"); // идёт обычный диалог
  if (last.from === "coordinator") return skip("coordinator-last"); // лида ведёт человек
  if (last.deliveryFailed) return skip("delivery-failed"); // пациент нашего сообщения не получил — молчание не в счёт

  if (messages.some((m) => m.from === "patient" && isOptOut(m.text))) return { kind: "close", reason: "opt-out" };

  const lastPatient = [...messages].reverse().find((m) => m.from === "patient");
  const cycleKey = lastPatient?.at ?? "none";
  const nowMs = now.getTime();
  const state = lead.firstContact?.cycleKey === cycleKey ? lead.firstContact : undefined;

  // Фаза 0: цикл ещё не начат — считаем тишину от последнего сообщения бота.
  if (!state) {
    const anchorMs = Date.parse(last.at);
    const age = nowMs - anchorMs;
    if (age >= cfg.staleAfterMs) return { kind: "close", reason: "stale" };
    if (age < cfg.silentAfterMs) return skip("waiting-3h");
    return {
      kind: "summarize",
      cycleKey,
      anchorAt: last.at,
      touch1DueAt: new Date(anchorMs + cfg.touch1AfterMs).toISOString(),
    };
  }

  // Фаза 1: сводка есть, касание запланировано.
  if (state.phase === "scheduled") {
    if (nowMs - Date.parse(state.anchorAt) >= cfg.staleAfterMs) return { kind: "close", reason: "stale" };
    if (nowMs < Date.parse(state.touch1DueAt)) return skip("touch1-not-due");
    if (!inSendWindow(now, timeZone)) return skip("quiet-hours");
    return { kind: "send-touch1", cycleKey };
  }

  // Фаза 2: касание отправлено — ждём неделю.
  const sentMs = Date.parse(state.touch1At ?? state.anchorAt);
  return nowMs >= sentMs + cfg.closeAfterTouch1Ms ? { kind: "close", reason: "silent-week" } : skip("waiting-week");
}

// ───────────────────────── язык и тексты ─────────────────────────

export type LeadLanguage = "tg" | "uz" | "ru";

// То, что пациент реально написал: без подписей-заглушек вроде «📎 [изображение без подписи]» и «(+фото)».
function writtenText(m: DecisionMessage): string {
  const raw = (m.transcript?.text ?? m.text).trim();
  return /^[📎🎤📄]|^\(\+|^\[|^—/u.test(raw) ? "" : raw;
}

/**
 * Язык лида по тому, что он писал сам. Если не писал ничего (получил только приветствие и видео) — таджикский:
 * так начинается каждый диалог по регламенту. Нужен для запасного текста; основной текст ИИ пишет сам.
 */
export function detectLanguage(messages: DecisionMessage[]): LeadLanguage {
  const patientText = messages.filter((m) => m.from === "patient").map(writtenText).join(" ").trim();
  if (!patientText) return "tg";
  if (/[ҷқғӣӯҳ]/i.test(patientText)) return "tg";
  const letters = patientText.replace(/[^\p{L}]/gu, "");
  const latin = (letters.match(/\p{Script=Latin}/gu) ?? []).length;
  const cyrillic = (letters.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  return latin > cyrillic ? "uz" : "ru";
}

// Запасные тексты — только если Gemini не ответил или вернул негодное. Короткие и безопасные: приветствие,
// кто мы, один вопрос. Проверьте таджикский и узбекский у носителя и при необходимости поправьте.
export const FALLBACK_TOUCH_TEXT: Record<LeadLanguage, string> = {
  ru: "Ассалому алейкум! Это Meditur HBG. Вы обращались к нам — подскажите, чем можем помочь?",
  tg: "Ассалому алейкум! Ин Meditur HBG. Шумо ба мо муроҷиат карда будед — бигӯед, чӣ хел ёрӣ расонда метавонем?",
  uz: "Assalomu alaykum! Bu Meditur HBG. Siz bizga murojaat qilgan edingiz — qanday yordam bera olamiz?",
};

/** Приводит ответ модели к виду сообщения; null — негодный (пустой, слишком длинный, со ссылкой). */
export function cleanFollowUpText(raw: string): string | null {
  const text = raw
    .replace(/^```\w*\s*/, "")
    .replace(/```\s*$/, "")
    .replace(/^["«“]+|["»”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > 600 || /https?:\/\/|www\./i.test(text)) return null;
  return text;
}

// ───────────────────────── исполнение ─────────────────────────

export interface PassBudget {
  summaries: number;
  sends: number;
}

export interface LeadOutcome {
  leadId: string;
  name: string;
  kind: FirstContactDecision["kind"];
  reason?: string;
  done: boolean;
  error?: string;
}

const CLOSE_NOTES: Record<CloseReason, string> = {
  "silent-week": "— Автоматически: нет ответа после повторного касания, лид переведён в «Без ответа». —",
  stale: "— Автоматически: нет ответа дольше 9 дней, лид переведён в «Без ответа». —",
  "opt-out": "— Автоматически: пациент просил не писать, лид переведён в «Без ответа». —",
};

function nextTouchIso(at: Date, timeZone: string): string {
  return endOfDayInZone(at, timeZone).toISOString();
}

export async function processFirstContactLead(
  lead: Lead,
  options: { now: Date; dryRun: boolean; budget: PassBudget; timeZone?: string }
): Promise<LeadOutcome> {
  const { now, dryRun, budget } = options;
  const timeZone = options.timeZone ?? crmTimeZone();
  const base = { leadId: lead.id, name: lead.name };

  const messages = await getMessages(lead.id);
  const decision = decideFirstContact({ lead, messages, now, timeZone });
  if (decision.kind === "skip") return { ...base, kind: "skip", reason: decision.reason, done: false };

  const reason = decision.kind === "close" ? decision.reason : undefined;
  if (dryRun) return { ...base, kind: decision.kind, reason, done: false };

  const requestId = newRequestId();
  const logger = log.child(requestId);
  try {
    if (decision.kind === "summarize") {
      if (budget.summaries <= 0) return { ...base, kind: "summarize", reason: "budget", done: false };
      budget.summaries--;
      // Чат читается один раз: сводка сохраняется на лиде и дальше используется вместо повторного чтения.
      const text = await summarizeLeadBrief({ transcript: buildAnamnesisTranscript(messages as ChatMessage[]), requestId });
      await saveFirstContactSchedule(lead.id, {
        state: {
          phase: "scheduled",
          cycleKey: decision.cycleKey,
          anchorAt: decision.anchorAt,
          touch1DueAt: decision.touch1DueAt,
        },
        brief: { text, at: now.toISOString() },
        nextTouch: nextTouchIso(new Date(decision.touch1DueAt), timeZone),
      });
      logger.info("сводка лида записана, касание назначено", { leadId: lead.id, dueAt: decision.touch1DueAt });
      return { ...base, kind: "summarize", done: true };
    }

    if (decision.kind === "send-touch1") {
      if (budget.sends <= 0) return { ...base, kind: "send-touch1", reason: "budget", done: false };
      budget.sends--;

      let text = FALLBACK_TOUCH_TEXT[detectLanguage(messages)];
      try {
        const generated = cleanFollowUpText(
          await composeFirstContactMessage({
            brief: lead.aiBrief?.text,
            transcript: buildAnamnesisTranscript(messages.slice(-12) as ChatMessage[]),
            requestId,
          })
        );
        if (generated) text = generated;
        else logger.warn("текст касания от Gemini негодный — запасной шаблон", { leadId: lead.id });
      } catch (err) {
        logger.warn("Gemini не написал касание — запасной шаблон", {
          leadId: lead.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // Сначала занимаем касание (атомарно), потом отправляем: при сбое между этими шагами лучше потерять
      // касание, чем отправить пациенту два одинаковых сообщения.
      const claimed = await claimFirstContactTouch1(lead.id, decision.cycleKey, {
        touch1At: now.toISOString(),
        nextTouch: nextTouchIso(new Date(now.getTime() + FIRST_CONTACT_CONFIG.closeAfterTouch1Ms), timeZone),
      });
      if (!claimed) return { ...base, kind: "send-touch1", reason: "already-claimed", done: false };

      try {
        await sendWhatsAppText(lead.phone, text);
      } catch (err) {
        const attempts = (lead.firstContact?.attempts ?? 0) + 1;
        const message = err instanceof Error ? err.message : String(err);
        logger.error("не удалось отправить касание", { leadId: lead.id, attempts, message });
        if (attempts >= FIRST_CONTACT_CONFIG.maxSendAttempts) {
          await closeFirstContact(lead.id);
          await addMessage(lead.id, "coordinator", "— Автоматически: не удалось отправить касание, лид переведён в «Без ответа». —");
          return { ...base, kind: "send-touch1", reason: "send-failed-closed", done: true, error: message };
        }
        await revertFirstContactTouch1(lead.id, decision.cycleKey, {
          attempts,
          nextTouch: nextTouchIso(new Date(lead.firstContact?.touch1DueAt ?? now.toISOString()), timeZone),
        });
        return { ...base, kind: "send-touch1", reason: "send-failed", done: false, error: message };
      }
      await addMessage(lead.id, "ai", text);
      logger.info("касание №1 отправлено", { leadId: lead.id });
      return { ...base, kind: "send-touch1", done: true };
    }

    await closeFirstContact(lead.id);
    await addMessage(lead.id, "coordinator", CLOSE_NOTES[decision.reason]);
    logger.info("лид переведён в «Без ответа»", { leadId: lead.id, reason: decision.reason });
    return { ...base, kind: "close", reason: decision.reason, done: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("ошибка обработки лида", { leadId: lead.id, kind: decision.kind, message });
    return { ...base, kind: decision.kind, reason, done: false, error: message };
  }
}

export interface PassReport {
  dryRun: boolean;
  total: number;
  /** Сколько лидов получили каждое решение: «summarize», «send-touch1», «close:stale», «skip:waiting-3h»… */
  summary: Record<string, number>;
  outcomes: LeadOutcome[];
}

let passRunning = false;

/**
 * Один прогон по всем подходящим лидам. dryRun — только посчитать, что бы произошло (без Gemini, без
 * отправки, без записи): так проверяют правила перед включением. Реальные прогоны не пересекаются.
 */
export async function runFirstContactPass(options: { dryRun?: boolean; now?: Date } = {}): Promise<PassReport | null> {
  const dryRun = options.dryRun ?? false;
  if (!dryRun) {
    if (passRunning) return null;
    passRunning = true;
  }
  try {
    const now = options.now ?? new Date();
    const budget: PassBudget = {
      summaries: FIRST_CONTACT_CONFIG.maxSummariesPerPass,
      sends: FIRST_CONTACT_CONFIG.maxSendsPerPass,
    };
    const candidates = await getFirstContactCandidates();
    const outcomes: LeadOutcome[] = [];
    for (const lead of candidates) {
      outcomes.push(await processFirstContactLead(lead, { now, dryRun, budget }));
    }

    const summary: Record<string, number> = {};
    for (const o of outcomes) {
      const key = o.reason ? `${o.kind}:${o.reason}` : o.kind;
      summary[key] = (summary[key] ?? 0) + 1;
    }
    if (!dryRun) log.info("прогон каденции первых контактов завершён", { total: candidates.length, ...summary });
    return { dryRun, total: candidates.length, summary, outcomes };
  } finally {
    if (!dryRun) passRunning = false;
  }
}

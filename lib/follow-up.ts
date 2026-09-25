import { addMessage, getMessages, updateLead } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/evolution";
import { createLogger } from "@/lib/logger";
import type { Lead } from "@/lib/types";

const log = createLogger("follow-up");

// Каденция из «Медитур — Гид для координатора» (слайд 13: День 0/1/2–3/5–7/
// 10–14), адаптирована под автоматическую отправку в WhatsApp вместо звонков
// координатора. День 0 уходит сразу при переводе лида в «Смета отправлена»
// (см. sendDay0, вызывается из app/api/leads/[id]/route.ts). Остальные шаги —
// по крону (см. app/api/cron/follow-up/route.ts), и только пока последним
// писал не пациент: если пациент уже ответил, дальше ведёт обычный диалог
// через вебхук, а не эта каденция.

export const DAY0_TEXT =
  "Здравствуйте! Отправил(а) документы по вашему плану лечения — посмотрите, пожалуйста.";

const STEPS: { step: number; afterDays: number; text: string | null }[] = [
  {
    step: 1,
    afterDays: 1,
    text:
      "Здравствуйте! Написал(а) вчера по плану лечения — удобно обсудить сейчас, или подскажете, когда созвониться?",
  },
  {
    step: 2,
    afterDays: 2,
    text: "Добрый день! Остались вопросы по плану лечения или срокам? Готов(а) подробно рассказать.",
  },
  {
    step: 3,
    afterDays: 5,
    text:
      "Что беспокоит больше всего: сама операция, стоимость, сроки или оформление документов? Так смогу помочь конкретно с этим.",
  },
  { step: 4, afterDays: 10, text: null }, // эскалация — пациенту ничего не шлём
];

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export async function sendDay0(lead: Lead): Promise<void> {
  try {
    await sendWhatsAppText(lead.phone, DAY0_TEXT);
    await addMessage(lead.id, "ai", DAY0_TEXT);
    log.info("Day 0 отправлен", { leadId: lead.id });
  } catch (err) {
    log.error("не удалось отправить Day 0", {
      leadId: lead.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export type FollowUpResult = "sent" | "escalated" | "skipped";

// Проверяет одного лида и, если пора, шлёт следующий шаг каденции.
export async function runFollowUpCheck(lead: Lead): Promise<FollowUpResult> {
  if (lead.aiPaused) return "skipped";
  if (lead.stage !== "estimate_sent" && lead.stage !== "awaiting_decision") {
    return "skipped";
  }
  if (!lead.estimateSentAt) return "skipped";

  const messages = await getMessages(lead.id);
  const last = messages[messages.length - 1];
  if (last && last.from === "patient") return "skipped"; // ждём обычный диалог, не каденцию

  const anchor = last?.at ?? lead.estimateSentAt;
  const days = daysSince(anchor);
  const doneStep = lead.followUpStep ?? 0;
  const next = STEPS.find((s) => s.step > doneStep && days >= s.afterDays);
  if (!next) return "skipped";

  if (next.text === null) {
    await updateLead(lead.id, { aiPaused: true, followUpStep: next.step });
    await addMessage(
      lead.id,
      "coordinator",
      "— Автоматическая эскалация: нет ответа 10+ дней после отправки сметы. ИИ поставлен на паузу, нужен координатор. —"
    );
    log.info("эскалация по каденции", { leadId: lead.id, days });
    return "escalated";
  }

  try {
    await sendWhatsAppText(lead.phone, next.text);
    await addMessage(lead.id, "ai", next.text);
    await updateLead(lead.id, { followUpStep: next.step });
    log.info("шаг каденции отправлен", { leadId: lead.id, step: next.step, days });
    return "sent";
  } catch (err) {
    log.error("не удалось отправить шаг каденции", {
      leadId: lead.id,
      step: next.step,
      message: err instanceof Error ? err.message : String(err),
    });
    return "skipped";
  }
}

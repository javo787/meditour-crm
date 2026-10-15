import { NextResponse } from "next/server";

import { analyzeMessages } from "@/lib/chat-analysis";
import { getMessagesSince } from "@/lib/db";
import { createLogger, newRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("chat-analysis");

const DEFAULT_DAYS = 30;
const MAX_DAYS = 180;

// Статистика переписок для настройки бота: длина и «вода» в ответах, паузы
// между пузырями, арабская графика, когда пишут пациенты и зовёт ли бот на
// звонок в рабочее окно. Только агрегаты — ни текстов, ни имён, ни номеров.
// Закрыт логином тем же middleware, что и остальные /api/settings/*.
//
// GET /api/settings/chat-analysis?days=30
// GET /api/settings/chat-analysis?since=2026-10-16T00:00:00Z  — «после выкладки правок»
export async function GET(request: Request) {
  const requestId = newRequestId();
  const logger = log.child(requestId);

  const params = new URL(request.url).searchParams;
  const sinceParam = params.get("since");
  const daysParam = Number(params.get("days") ?? DEFAULT_DAYS);
  const days = Number.isFinite(daysParam) ? Math.min(MAX_DAYS, Math.max(1, Math.floor(daysParam))) : DEFAULT_DAYS;

  const sinceDate =
    sinceParam && !Number.isNaN(Date.parse(sinceParam))
      ? new Date(sinceParam)
      : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const { messages, truncated } = await getMessagesSince(sinceDate.toISOString());
    const analysis = analyzeMessages(messages);
    logger.info("chat-analysis: статистика посчитана", { messages: messages.length, truncated });
    return NextResponse.json({ since: sinceDate.toISOString(), truncated, ...analysis });
  } catch (err) {
    logger.error("chat-analysis: не удалось посчитать статистику", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Не удалось посчитать статистику" }, { status: 500 });
  }
}

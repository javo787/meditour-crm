import { NextResponse } from "next/server";

import { getLeads } from "@/lib/db";
import { runFollowUpCheck } from "@/lib/follow-up";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("cron:follow-up");

// Дёргается раз в день внешним планировщиком (Render Cron Job, cron-job.org
// и т.п.) — сам по себе Next.js/Render такие задачи по расписанию не
// запускает. Проверка секрета — чтобы эндпоинт не мог вызвать кто попало:
// GET /api/cron/follow-up?secret=... или заголовок x-cron-secret.
function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // секрет ещё не настроен — не блокируем локальную разработку
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("secret");
  const fromHeader = request.headers.get("x-cron-secret");
  return fromQuery === expected || fromHeader === expected;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Неверный secret" }, { status: 401 });
  }

  const candidates = [
    ...(await getLeads({ stage: "estimate_sent" })),
    ...(await getLeads({ stage: "awaiting_decision" })),
  ];

  const results = { sent: 0, escalated: 0, skipped: 0, total: candidates.length };
  for (const lead of candidates) {
    const outcome = await runFollowUpCheck(lead);
    results[outcome]++;
  }

  log.info("прогон каденции follow-up завершён", results);
  return NextResponse.json({ ok: true, ...results });
}

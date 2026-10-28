import { NextResponse } from "next/server";

import { runFirstContactPass } from "@/lib/first-contact";
import { firstContactEnabled } from "@/lib/first-contact-scheduler";

export const dynamic = "force-dynamic";

// Ручной запуск и «пробный прогон» каденции первых контактов. Сам прогон идёт и без этого адреса — его
// запускает планировщик из instrumentation.ts каждые 30 минут.
//   GET /api/cron/first-contact?secret=...&dryRun=1 — только показать, что бы произошло (ничего не отправляется и
//   не записывается, Gemini не вызывается). Работает всегда — так проверяют правила перед включением.
//   GET /api/cron/first-contact?secret=...          — реальный прогон; только если FIRST_CONTACT_CADENCE=on.
// Секрет обязателен: адрес показывает имена лидов и может отправлять сообщения пациентам.
function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === expected || request.headers.get("x-cron-secret") === expected;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Задайте CRON_SECRET в переменных окружения" }, { status: 401 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Неверный secret" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  if (!dryRun && !firstContactEnabled()) {
    return NextResponse.json(
      { error: "Каденция выключена. Сначала посмотрите ?dryRun=1, затем задайте FIRST_CONTACT_CADENCE=on." },
      { status: 403 }
    );
  }

  const report = await runFirstContactPass({ dryRun });
  if (!report) return NextResponse.json({ error: "Прогон уже идёт" }, { status: 409 });
  return NextResponse.json({ ok: true, ...report, outcomes: report.outcomes.slice(0, 300) });
}

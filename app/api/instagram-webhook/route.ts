import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { getInstagramConfig } from "@/lib/instagram/config";
import { processInstagramEvents } from "@/lib/instagram/process";
import { parseInstagramWebhook, verifySignature, type InstagramEvent } from "@/lib/instagram/webhook";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Публичный приёмник вебхуков Instagram (объект "instagram"). Авторизация — по подписи и verify token, не по сессии.
const log = createLogger("instagram-webhook");

// Сравнение без утечки по времени. Разная длина — сразу false (timingSafeEqual требует равных буферов).
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// Проверка адреса при подключении вебхука в консоли Meta: отдаём challenge, если токен совпал.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const cfg = getInstagramConfig();
  const mode = params.get("hub.mode");
  const sent = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";

  if (mode === "subscribe" && cfg.verifyToken !== "" && safeEqual(sent, cfg.verifyToken)) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  log.warn("проверка адреса вебхука Instagram отклонена (403)", {
    modeSubscribe: mode === "subscribe",
    verifyTokenConfigured: cfg.verifyToken !== "",
  });
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

// Приём событий. Отвечаем 200 сразу, обработка идёт в фоне: Meta повторяет доставку, если ответ запаздывает.
export async function POST(req: Request) {
  const cfg = getInstagramConfig();
  const raw = await req.text();

  if (!cfg.appSecret) {
    log.error("INSTAGRAM_APP_SECRET не задан: вебхук Instagram не принимается (503)");
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret)) {
    log.warn("подпись вебхука Instagram не совпала (401)");
    return NextResponse.json({ error: "bad-signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    log.warn("тело вебхука Instagram не разобрано как JSON (400)");
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const events = parseInstagramWebhook(body);
  log.info("вебхук Instagram принят", countByType(events));

  void processInstagramEvents(events, { cfg, log }).catch((err: unknown) => {
    log.error("фоновая обработка событий Instagram завершилась ошибкой", {
      error: err instanceof Error ? err.name : "unknown",
    });
  });
  return NextResponse.json({ ok: true });
}

// В журнал уходят только количества по типам событий, без текстов и идентификаторов.
function countByType(events: InstagramEvent[]) {
  return {
    comments: events.filter((e) => e.type === "comment").length,
    dms: events.filter((e) => e.type === "dm").length,
    echoes: events.filter((e) => e.type === "echo").length,
  };
}

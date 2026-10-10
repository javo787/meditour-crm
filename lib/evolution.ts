// Обёртка над Evolution API (шлюз WhatsApp из Этапа 1 плана).
// Эндпоинты и формат подтверждены по документации/issue-трекеру Evolution API v2:
// POST /message/sendText/{instance}              — отправка текста, плоское тело { number, text, delay? }
//   delay (мс) — Evolution сам показывает «печатает…» это время и только потом шлёт
//   сообщение (документация v2: «Presence time in milliseconds before sending message»)
// POST /chat/getBase64FromMediaMessage/{instance} — расшифровка медиа в base64

import { createLogger } from "@/lib/logger";

const log = createLogger("evolution");

const BASE_URL = process.env.EVOLUTION_API_URL;
const API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE;

function getConfig(): { baseUrl: string; apiKey: string; instance: string } {
  if (!BASE_URL || !API_KEY || !INSTANCE) {
    throw new Error(
      "Evolution API не настроен — заполните EVOLUTION_API_URL, EVOLUTION_API_KEY и EVOLUTION_INSTANCE в .env.local"
    );
  }
  return { baseUrl: BASE_URL, apiKey: API_KEY, instance: INSTANCE };
}

async function sendTextOnce(
  baseUrl: string,
  apiKey: string,
  instance: string,
  number: string,
  text: string,
  typingDelayMs?: number
): Promise<void> {
  const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    // delay === undefined → ключ не попадает в JSON, тело остаётся прежним
    body: JSON.stringify({ number, text, delay: typingDelayMs }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution API sendText вернул ${res.status}: ${body}`);
  }
}

// "Connection Closed" (500 от Evolution) — типичный обрыв внутреннего
// WebSocket-соединения Baileys с WhatsApp, который обычно сам
// восстанавливается за секунды. Раньше одна такая ошибка сразу считалась
// окончательным провалом (ИИ на паузу, "не доставлено") — 3 ручных
// сообщения подряд падали с одной и той же ошибкой ровно так. Теперь
// пробуем ещё дважды с паузой, прежде чем сдаться.
export async function sendWhatsAppText(
  number: string,
  text: string,
  requestId?: string,
  options?: { typingDelayMs?: number }
): Promise<void> {
  const logger = requestId ? log.child(requestId) : log;
  const { baseUrl, apiKey, instance } = getConfig();
  logger.info("sendText: отправка запроса", {
    baseUrl,
    instance,
    number,
    textLength: text.length,
    typingDelayMs: options?.typingDelayMs,
  });

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS_MS = [1500, 3000];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sendTextOnce(baseUrl, apiKey, instance, number, text, options?.typingDelayMs);
      logger.info("sendText: успешно отправлено", { attempt });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_ATTEMPTS) {
        logger.error("sendText: не удалось отправить после всех попыток", {
          attempts: MAX_ATTEMPTS,
          message,
        });
        throw err;
      }
      logger.warn("sendText: попытка не удалась, повторяем — часто это временный обрыв соединения у шлюза", {
        attempt,
        message,
      });
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
  }
}

export async function fetchMediaBase64(
  messageKey: unknown,
  requestId?: string
): Promise<{ base64: string; mimetype: string }> {
  const logger = requestId ? log.child(requestId) : log;
  const { baseUrl, apiKey, instance } = getConfig();
  logger.info("getBase64FromMediaMessage: запрос медиа", { baseUrl, instance });

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ message: { key: messageKey } }),
    });
  } catch (err) {
    logger.error("getBase64FromMediaMessage: сетевая ошибка запроса к Evolution API", {
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("getBase64FromMediaMessage: Evolution API вернул ошибку", {
      status: res.status,
      body,
    });
    throw new Error(`Evolution API getBase64FromMediaMessage вернул ${res.status}: ${body}`);
  }

  const data = await res.json();
  logger.info("getBase64FromMediaMessage: медиа получено", {
    mimetype: data.mimetype,
    base64Length: typeof data.base64 === "string" ? data.base64.length : 0,
    hasBase64: Boolean(data.base64),
  });
  return { base64: data.base64, mimetype: data.mimetype };
}

// Для страницы настроек: не просто "сервер отвечает", а реально ли сессия
// WhatsApp подключена (state === "open") — сервер Evolution может быть жив,
// а сессия при этом разлогинена и ждёт новый QR. Никогда не бросает ошибку
// и не возвращает деталей — только true/false, с таймаутом на случай
// зависшего шлюза.
export async function checkWhatsAppConnection(requestId?: string): Promise<boolean> {
  const logger = requestId ? log.child(requestId) : log;
  try {
    const { baseUrl, apiKey, instance } = getConfig();
    const res = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
      method: "GET",
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn("checkWhatsAppConnection: шлюз ответил ошибкой", {
        status: res.status,
        body: (await res.text().catch(() => "")).slice(0, 300),
      });
      return false;
    }
    const data = await res.json();
    const state = data?.instance?.state;
    if (state !== "open") {
      logger.warn("checkWhatsAppConnection: сессия не подключена", { state });
    }
    return state === "open";
  } catch (err) {
    logger.warn("checkWhatsAppConnection: ошибка при проверке", {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

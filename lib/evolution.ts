// Обёртка над Evolution API (шлюз WhatsApp из Этапа 1 плана).
// Эндпоинты и формат подтверждены по документации/issue-трекеру Evolution API v2:
// POST /message/sendText/{instance}              — отправка текста, плоское тело { number, text }
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

export async function sendWhatsAppText(number: string, text: string, requestId?: string): Promise<void> {
  const logger = requestId ? log.child(requestId) : log;
  const { baseUrl, apiKey, instance } = getConfig();
  logger.info("sendText: отправка запроса", {
    baseUrl,
    instance,
    number,
    textLength: text.length,
  });

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number, text }),
    });
  } catch (err) {
    logger.error("sendText: сетевая ошибка запроса к Evolution API", {
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("sendText: Evolution API вернул ошибку", { status: res.status, body });
    throw new Error(`Evolution API sendText вернул ${res.status}: ${body}`);
  }

  logger.info("sendText: успешно отправлено", { status: res.status });
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

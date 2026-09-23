// Обёртка над Evolution API (шлюз WhatsApp из Этапа 1 плана).
// Эндпоинты и формат подтверждены по документации/issue-трекеру Evolution API v2:
// POST /message/sendText/{instance}              — отправка текста, плоское тело { number, text }
// POST /chat/getBase64FromMediaMessage/{instance} — расшифровка медиа в base64

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

export async function sendWhatsAppText(number: string, text: string): Promise<void> {
  const { baseUrl, apiKey, instance } = getConfig();
  const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution API sendText вернул ${res.status}: ${body}`);
  }
}

export async function fetchMediaBase64(
  messageKey: unknown
): Promise<{ base64: string; mimetype: string }> {
  const { baseUrl, apiKey, instance } = getConfig();
  const res = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ message: { key: messageKey } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution API getBase64FromMediaMessage вернул ${res.status}: ${body}`);
  }
  const data = await res.json();
  return { base64: data.base64, mimetype: data.mimetype };
}

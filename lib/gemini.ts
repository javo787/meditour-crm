import type { ChatMessage } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { MEDITUR_SYSTEM_PROMPT } from "@/lib/playbook";

const log = createLogger("gemini");

// ВАЖНО: в исходном плане названа модель "Gemini 1.5 Flash", но поколение
// 1.5 (как и 1.0) уже полностью отключено Google — такие запросы возвращают
// 404. Используем текущую модель по умолчанию, но линейка Gemini обновляется
// быстро, поэтому имя вынесено в переменную окружения GEMINI_MODEL, чтобы
// её можно было поменять без правки кода.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const API_KEY = process.env.GEMINI_API_KEY;

// Регламент Meditur HBG (объяснение диагноза, цены, отработка возражений,
// визовые правила) вынесен в lib/playbook.ts — редактируйте его там.
const BASE_SYSTEM_INSTRUCTION = MEDITUR_SYSTEM_PROMPT;

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

function roleFor(from: ChatMessage["from"]): "user" | "model" {
  return from === "ai" ? "model" : "user";
}

export async function askGemini(params: {
  history: ChatMessage[];
  userText: string;
  image?: { base64: string; mimeType: string };
  requestId?: string;
}): Promise<string> {
  const logger = params.requestId ? log.child(params.requestId) : log;

  if (!API_KEY) {
    logger.error("GEMINI_API_KEY не задан");
    throw new Error("GEMINI_API_KEY не задан — добавьте его в .env.local");
  }

  const contents = params.history.map((m) => ({
    role: roleFor(m.from),
    parts: [{ text: m.text }] as GeminiPart[],
  }));

  const newParts: GeminiPart[] = [
    { text: params.userText || "(сообщение пришло без текста)" },
  ];
  if (params.image) {
    newParts.push({
      inlineData: { mimeType: params.image.mimeType, data: params.image.base64 },
    });
  }
  contents.push({ role: "user", parts: newParts });

  logger.info("askGemini: отправка запроса", {
    model: MODEL,
    historyMessages: params.history.length,
    hasImage: Boolean(params.image),
    userTextLength: params.userText.length,
  });

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: BASE_SYSTEM_INSTRUCTION }] },
        }),
      }
    );
  } catch (err) {
    logger.error("askGemini: сетевая ошибка запроса к Gemini API", {
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error("askGemini: Gemini API вернул ошибку", {
      status: res.status,
      model: MODEL,
      body,
    });
    throw new Error(`Gemini API вернул ${res.status}: ${body}`);
  }

  const data = await res.json();
  const finishReason = data?.candidates?.[0]?.finishReason;
  const blockReason = data?.promptFeedback?.blockReason;
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: GeminiPart) => p.text ?? "")
    .join("")
    .trim();

  logger.info("askGemini: ответ получен", {
    status: res.status,
    finishReason,
    blockReason,
    replyLength: text.length,
    fallbackUsed: !text,
  });

  if (!text) {
    logger.warn("askGemini: пустой ответ от модели — используется запасная фраза", {
      finishReason,
      blockReason,
    });
  }

  return text || "Извините, не получилось сформировать ответ — уточните, пожалуйста, вопрос.";
}

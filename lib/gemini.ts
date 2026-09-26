import type { ChatMessage } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { MEDITUR_SYSTEM_PROMPT } from "@/lib/playbook";
import { MEDICAL_OPINION_SYSTEM_PROMPT } from "@/lib/medical-opinion-prompt";

const log = createLogger("gemini");

// ВАЖНО: в исходном плане названа модель "Gemini 1.5 Flash", но поколение
// 1.5 (как и 1.0) уже полностью отключено Google — такие запросы возвращают
// 404. Используем текущую модель по умолчанию, но линейка Gemini обновляется
// быстро, поэтому имя вынесено в переменную окружения GEMINI_MODEL, чтобы
// её можно было поменять без правки кода.
const MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.8-flash",
  process.env.GEMINI_MODEL_FALLBACK_1 || "gemini-3.7-flash",
  process.env.GEMINI_MODEL_FALLBACK_2 || "gemini-3.5-flash-lite",
].filter((m): m is string => Boolean(m));

const MAX_CYCLES = 2; // 2 full passes через MODELS = до 6 попыток
const CYCLE_DELAY_MS = 2000; // задержка перед новым циклом; удваивается каждый цикл

const API_KEY = process.env.GEMINI_API_KEY;

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

function roleFor(from: ChatMessage["from"]): "user" | "model" {
  return from === "ai" ? "model" : "user";
}

async function callModel(
  model: string,
  contents: any[],
  systemInstruction: string,
  logger: any
): Promise<
  | { ok: true; res: Response }
  | { ok: false; status: number; body: string; retryable: boolean }
> {
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY as string },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
        }),
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Gemini: сетевая ошибка запроса к API", { message, model });
    return { ok: false, status: 0, body: message, retryable: true };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const status = res.status;
    const retryable = status === 429 || status >= 500 || status === 404;
    return { ok: false, status, body, retryable };
  }

  return { ok: true, res };
}

// Общий цикл перебора моделей с ретраями (MODELS x MAX_CYCLES). Вынесен из
// askGemini, чтобы им мог пользоваться и askCaseAssistant — у каждого свой
// systemInstruction, но сетевые ретраи и парсинг ответа одинаковые. В
// отличие от старого askGemini, здесь НЕТ запасной фразы при пустом
// ответе — это решает вызывающая сторона (для пациента в WhatsApp это
// извинение, для координатора в Medical Opinion Request — ошибка и повтор).
async function generateWithFallback(
  contents: any[],
  systemInstruction: string,
  logger: any
): Promise<string> {
  if (!API_KEY) {
    logger.error("GEMINI_API_KEY не задан");
    throw new Error("GEMINI_API_KEY не задан — добавьте его в .env.local");
  }

  let lastStatus = 0;
  let lastBody = "";
  let res: Response | undefined;

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    for (const model of MODELS) {
      const result = await callModel(model, contents, systemInstruction, logger);
      if (result.ok) {
        res = result.res;
        break;
      }

      lastStatus = result.status;
      lastBody = result.body;

      if (!result.retryable) {
        logger.error("Gemini API вернул ошибку", {
          status: result.status,
          model,
          body: result.body,
        });
        throw new Error(`Gemini API вернул ${result.status}: ${result.body}`);
      }

      logger.warn("Gemini: модель недоступна, пробуем следующую", {
        model,
        status: result.status,
        cycle,
      });
    }

    if (res) break;

    if (cycle < MAX_CYCLES) {
      const delay = CYCLE_DELAY_MS * cycle;
      logger.warn("Gemini: все модели заняты, ждём перед новым циклом", {
        cycle,
        delayMs: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  if (!res) {
    logger.error("Gemini: все модели исчерпаны", { status: lastStatus, body: lastBody });
    throw new Error(`Gemini API вернул ${lastStatus}: ${lastBody}`);
  }

  const data = await res.json();
  const finishReason = data?.candidates?.[0]?.finishReason;
  const blockReason = data?.promptFeedback?.blockReason;
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: GeminiPart) => p.text ?? "")
    .join("")
    .trim();

  logger.info("Gemini: ответ получен", {
    status: res.status,
    finishReason,
    blockReason,
    replyLength: text.length,
  });

  if (!text) {
    logger.warn("Gemini: пустой ответ от модели", { finishReason, blockReason });
  }

  return text;
}

export async function askGemini(params: {
  history: ChatMessage[];
  items: Array<{
    text: string;
    image?: { base64: string; mimeType: string };
    audio?: { base64: string; mimeType: string };
  }>;
  requestId?: string;
}): Promise<string> {
  const logger = params.requestId ? log.child(params.requestId) : log;

  const contents = params.history.map((m) => ({
    role: roleFor(m.from),
    parts: [{ text: m.text }] as GeminiPart[],
  }));

  const newParts: GeminiPart[] = [];
  let totalTextLength = 0;
  let imageCount = 0;
  let audioCount = 0;
  let hasTextInBatch = false;

  for (const item of params.items) {
    if (item.text) {
      newParts.push({ text: item.text });
      totalTextLength += item.text.length;
      hasTextInBatch = true;
    }
    if (item.image) {
      newParts.push({
        inlineData: { mimeType: item.image.mimeType, data: item.image.base64 },
      });
      imageCount++;
    }
    if (item.audio) {
      newParts.push({
        inlineData: { mimeType: item.audio.mimeType, data: item.audio.base64 },
      });
      audioCount++;
    }
  }

  if (!hasTextInBatch && imageCount === 0 && audioCount === 0) {
    newParts.push({ text: "(сообщение пришло без текста)" });
  }

  contents.push({ role: "user", parts: newParts });

  logger.info("askGemini: отправка запроса", {
    models: MODELS,
    historyMessages: params.history.length,
    itemCount: params.items.length,
    imageCount,
    audioCount,
    totalTextLength,
  });

  const text = await generateWithFallback(contents, MEDITUR_SYSTEM_PROMPT, logger);
  if (!text) {
    logger.warn("askGemini: используется запасная фраза для пациента");
  }
  return text || "Извините, не получилось сформировать ответ — уточните, пожалуйста, вопрос.";
}

// Ассистент подготовки Medical Opinion Request (Этап 4). Промпт — в
// lib/medical-opinion-prompt.ts, редактируется отдельно от регламента
// WhatsApp-бота (lib/playbook.ts). В отличие от askGemini, при пустом
// ответе бросает ошибку — вызывающий роут (case-assistant) должен вернуть
// координатору понятную 502, а не сохранить пустой "документ" в историю.
export async function askCaseAssistant(params: {
  history: Array<{ role: "user" | "assistant"; text: string }>;
  leadContext?: string;
  requestId?: string;
}): Promise<string> {
  const logger = params.requestId ? log.child(params.requestId) : log;

  const contents = params.history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }] as GeminiPart[],
  }));

  const systemInstruction = params.leadContext
    ? `${MEDICAL_OPINION_SYSTEM_PROMPT}\n\n# CASE DATA ALREADY ON FILE IN THE CRM\nUse this instead of asking the coordinator to repeat it. Treat anything the coordinator types below as additional or corrected information layered on top of this.\n${params.leadContext}`
    : MEDICAL_OPINION_SYSTEM_PROMPT;

  logger.info("askCaseAssistant: отправка запроса", {
    models: MODELS,
    historyMessages: params.history.length,
  });

  const text = await generateWithFallback(contents, systemInstruction, logger);
  if (!text) {
    throw new Error("Gemini вернул пустой ответ для Medical Opinion Request");
  }
  return text;
}

const ANAMNESIS_EXTRACTION_PROMPT = `You extract structured intake data for a medical-tourism coordinator from a WhatsApp conversation transcript between their AI/coordinator ("Meditour") and a patient.

Read the whole transcript and output ONLY a single valid JSON object — no markdown code fences, no commentary before or after it. Shape:
{"age": number or null, "proceduresDone": array of short strings (past surgeries/procedures already done — empty array if none mentioned), "summary": a 2-4 sentence case summary written in Russian, for the coordinator's own dashboard}

If the transcript does not mention a fact, use null (for age) or an empty array (for proceduresDone) — never invent details that were not actually said in the conversation.`;

// Извлечение структурированного анамнеза (age/proceduresDone/summary) из
// переписки с пациентом — раньше Anamnesis заполнялся только один раз при
// createLead и никогда не обновлялся, хотя AnamnesisPanel обещал, что "ИИ
// соберёт данные в переписке". Вызывается по кнопке из
// app/api/leads/[id]/anamnesis, не на каждое входящее сообщение (иначе
// удваивали бы стоимость и задержку каждого ответа пациенту).
export async function extractAnamnesis(params: {
  transcript: string;
  requestId?: string;
}): Promise<{ age: number | null; proceduresDone: string[]; summary: string }> {
  const logger = params.requestId ? log.child(params.requestId) : log;
  const contents = [{ role: "user", parts: [{ text: params.transcript }] as GeminiPart[] }];

  logger.info("extractAnamnesis: отправка запроса", { models: MODELS });

  const text = await generateWithFallback(contents, ANAMNESIS_EXTRACTION_PROMPT, logger);
  if (!text) {
    throw new Error("Gemini вернул пустой ответ при извлечении анамнеза");
  }

  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      age: typeof parsed.age === "number" ? parsed.age : null,
      proceduresDone: Array.isArray(parsed.proceduresDone)
        ? parsed.proceduresDone.filter((p: unknown): p is string => typeof p === "string")
        : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
  } catch (err) {
    logger.error("extractAnamnesis: не удалось разобрать JSON от Gemini", {
      message: err instanceof Error ? err.message : String(err),
      raw: text.slice(0, 500),
    });
    throw new Error("Gemini вернул невалидный JSON при извлечении анамнеза");
  }
}

import type { ChatMessage } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { MEDITUR_SYSTEM_PROMPT } from "@/lib/playbook";
import { MEDICAL_OPINION_SYSTEM_PROMPT } from "@/lib/medical-opinion-prompt";
import { dropDuplicateBubbles, parseModelReply, type DialogLanguage } from "@/lib/humanize";

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
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  // Gemini's Schema.type is an UPPERCASE enum (OBJECT/STRING/...), not
  // lowercase JSON-Schema style — get this wrong and Google returns 400 on
  // every request that includes tools. For a no-argument function it's
  // simplest and safest to just omit parameters (Google's own docs: "for a
  // function with no parameters, this can be left unset").
  parameters?: { type: "OBJECT"; properties: Record<string, unknown>; required?: string[] };
}

interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

type GeminiTools = Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;

function roleFor(from: ChatMessage["from"]): "user" | "model" {
  return from === "ai" ? "model" : "user";
}

// Формат ответа WhatsApp-бота — structured output (JSON по схеме), а не
// свободный текст + function calling. Почему так:
//  • messages — это и есть WhatsApp-пузыри: модель сама решает, где одна
//    мысль заканчивается и начинается следующая, а код не гадает по \n;
//  • minItems: 1 лишает модель возможности «вызвать функцию без текста» —
//    именно из-за этого раньше пациентам уходила жёсткая запасная строка;
//  • handoff — тот же сигнал «передаю координатору», что был у функции
//    pauseForHumanHandoff, но без tools: никакой схемы функции, которая могла
//    уронить все ответы (см. историю: неверный регистр в схеме → 400);
//  • language идёт ПЕРВЫМ полем (propertyOrdering): модель сначала фиксирует
//    язык диалога, потом пишет текст на нём — это лечит «русская реплика
//    посреди таджикского диалога».
// Если запрос со схемой не прошёл, generateWithFallback повторит его без
// схемы, а parseModelReply разберёт обычный текст — ответ не теряется.
const REPLY_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    language: {
      type: "STRING",
      format: "enum",
      enum: ["tg", "ru", "uz"],
      description:
        "Language of THIS reply, judged from the patient's latest coherent sentences (not isolated loanwords such as diagnoses or exam names): tg = Tajik, ru = Russian, uz = Uzbek. The very first reply to a new patient is always tg.",
    },
    messages: {
      type: "ARRAY",
      minItems: 1,
      maxItems: 4,
      items: { type: "STRING" },
      description:
        "The reply as 1-3 separate WhatsApp messages in the order they are sent. Each message is one short thought, written like a person typing in a chat: no lists, no markdown, no headers, no line breaks inside a message. Never repeat a thought, greeting, self-introduction or thank-you that already appears earlier in the conversation. Always at least one message, even when handoff is true.",
    },
    handoff: {
      type: "BOOLEAN",
      description:
        "Set true ONLY in exactly two situations, never speculatively and never as a default way to end a message. (1) The messages you are writing now tell the patient you are passing the medical documents/history they shared to the Indian doctors and will get back once there's a reply — only once the patient has actually shared what they have (not while you are still asking questions or waiting for something from them). (2) You are handing off per the playbook's КОГДА ПЕРЕДАВАТЬ ЧЕЛОВЕКУ rule (sensitive topic, patient explicitly asked for a human, patient is upset, or the request is outside this playbook). Do not set it because the conversation is quiet or because you are unsure how to answer. The closing message itself always goes into messages.",
    },
  },
  required: ["language", "messages", "handoff"],
  propertyOrdering: ["language", "messages", "handoff"],
};

const REPLY_GENERATION_CONFIG = {
  responseMimeType: "application/json",
  responseSchema: REPLY_RESPONSE_SCHEMA,
};

// Служебные подсказки модели при пустом ответе / повторе. Добавляются как
// ещё одна часть в последнее сообщение пользователя (а не отдельным ходом —
// чтобы не плодить два user-хода подряд) и в историю не сохраняются.
const NUDGE_EMPTY =
  "(Служебная подсказка, пациент её не видит.) В прошлый раз ты не вернул ни одного сообщения. Верни хотя бы одно короткое сообщение пациенту — по существу его последнего сообщения, на языке диалога.";
const NUDGE_DUPLICATE =
  "(Служебная подсказка, пациент её не видит.) Всё, что ты собирался написать, ты уже говорил пациенту раньше в этом диалоге. Не повторяй ни одну прежнюю мысль, приветствие, представление или благодарность. Напиши только то, что действительно ново и относится к его последнему сообщению. Если нового сказать нечего — одним коротким сообщением задай один конкретный уточняющий вопрос по его последнему сообщению.";

function withNudge(contents: any[], nudge: string): any[] {
  const copy = contents.slice();
  const last = copy[copy.length - 1];
  copy[copy.length - 1] = { ...last, parts: [...last.parts, { text: nudge }] };
  return copy;
}

async function callModel(
  model: string,
  contents: any[],
  systemInstruction: string,
  tools: GeminiTools | undefined,
  cachedContentName: string | undefined,
  logger: any,
  generationConfig?: Record<string, unknown>
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
          // При использовании explicit cache системную инструкцию в запрос
          // класть нельзя — она уже часть cachedContent на стороне Google.
          ...(cachedContentName
            ? { cachedContent: cachedContentName }
            : { systemInstruction: { parts: [{ text: systemInstruction }] } }),
          ...(tools ? { tools } : {}),
          ...(generationConfig ? { generationConfig } : {}),
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

// Explicit context caching (guaranteed экономия, в отличие от implicit —
// та включена у Google по умолчанию, но без гарантии и требует, чтобы
// весь запрос перевалил за порог модели в токенах, то есть в коротких
// диалогах может вообще не сработать). Кэшируем только systemInstruction
// askGemini — он константный и шлётся на КАЖДОЕ сообщение КАЖДого лида,
// это самый горячий путь. Кэш привязан к конкретной модели на стороне
// Google, поэтому создаём его только под MODELS[0] (основную модель) —
// резервные модели используются редко, ради них не усложняем.
const PLAYBOOK_CACHE_TTL_SECONDS = 3600;
let playbookCache: { name: string; expiresAt: number } | null = null;

async function getOrCreatePlaybookCache(logger: any): Promise<string | null> {
  const now = Date.now();
  if (playbookCache && playbookCache.expiresAt > now + 60_000) {
    return playbookCache.name;
  }

  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/cachedContents", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY as string },
      body: JSON.stringify({
        model: `models/${MODELS[0]}`,
        systemInstruction: { parts: [{ text: MEDITUR_SYSTEM_PROMPT }] },
        ttl: `${PLAYBOOK_CACHE_TTL_SECONDS}s`,
      }),
    });

    if (!res.ok) {
      logger.warn("Gemini: не удалось создать explicit cache для промпта — шлём без кэша", {
        status: res.status,
        body: await res.text().catch(() => ""),
      });
      return null;
    }

    const data = await res.json();
    playbookCache = { name: data.name, expiresAt: now + PLAYBOOK_CACHE_TTL_SECONDS * 1000 };
    logger.info("Gemini: создан explicit cache для системного промпта", { name: data.name });
    return playbookCache.name;
  } catch (err) {
    logger.warn("Gemini: ошибка при создании explicit cache — шлём без кэша", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Общий цикл перебора моделей с ретраями (MODELS x MAX_CYCLES). Используется
// askGemini, askCaseAssistant и extractAnamnesis — у каждого свой
// systemInstruction (и опционально свои tools), но сетевые ретраи и парсинг
// ответа одинаковые. Возвращает и text, и functionCall (если модель его
// вызвала) — при пустом тексте НЕ подставляет запасную фразу, это решает
// вызывающая сторона.
async function generateWithFallback(
  contents: any[],
  systemInstruction: string,
  logger: any,
  options?: { tools?: GeminiTools; cacheable?: boolean; generationConfig?: Record<string, unknown> }
): Promise<{ text: string; functionCall?: GeminiFunctionCall }> {
  if (!API_KEY) {
    logger.error("GEMINI_API_KEY не задан");
    throw new Error("GEMINI_API_KEY не задан — добавьте его в .env.local");
  }

  const cachedContentName = options?.cacheable ? await getOrCreatePlaybookCache(logger) : null;

  let lastStatus = 0;
  let lastBody = "";
  let res: Response | undefined;

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    for (const model of MODELS) {
      // Кэш создан только под MODELS[0] — для остальных моделей (и если
      // кэш не создался) шлём инструкцию как раньше, инлайном.
      const useCache = cachedContentName && model === MODELS[0] ? cachedContentName : undefined;
      let result = await callModel(
        model,
        contents,
        systemInstruction,
        options?.tools,
        useCache,
        logger,
        options?.generationConfig
      );

      // Если запрос с кэшем не удался (например, кэш протух или был
      // удалён на стороне Google раньше TTL) — не сдаёмся и не прыгаем
      // сразу на следующую модель, а пробуем эту же модель без кэша, с
      // инструкцией целиком в запросе. Так кэширование в худшем случае
      // просто не экономит на этом вызове, но никогда не роняет ответ.
      if (!result.ok && useCache) {
        logger.warn("Gemini: запрос с cachedContent не удался, пробуем без кэша", {
          model,
          status: result.status,
        });
        result = await callModel(
          model,
          contents,
          systemInstruction,
          options?.tools,
          undefined,
          logger,
          options?.generationConfig
        );
      }

      // Та же логика для tools и схемы ответа: если запрос с ними не удался
      // (например, из-за ошибки в схеме — именно так однажды упал вообще весь
      // ответ пациентам), пробуем без них. Потерять на этом ответе
      // handoff/разбивку на пузыри — не страшно (parseModelReply разберёт
      // обычный текст), а вот отвечать пациенту вообще нечем — критично.
      if (!result.ok && (options?.tools || options?.generationConfig)) {
        logger.warn("Gemini: запрос с tools/схемой ответа не удался, пробуем без них", {
          model,
          status: result.status,
        });
        result = await callModel(model, contents, systemInstruction, undefined, undefined, logger);
      }

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
  const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  const functionCall = parts.find((p) => p.functionCall)?.functionCall;

  logger.info("Gemini: ответ получен", {
    status: res.status,
    finishReason,
    blockReason,
    replyLength: text.length,
    functionCall: functionCall?.name,
    cacheHitTokens: data?.usageMetadata?.cachedContentTokenCount,
  });

  if (!text && !functionCall) {
    logger.warn("Gemini: пустой ответ от модели", { finishReason, blockReason });
  }

  return { text, functionCall };
}

export async function askGemini(params: {
  history: ChatMessage[];
  items: Array<{
    text: string;
    image?: { base64: string; mimeType: string };
    audio?: { base64: string; mimeType: string };
  }>;
  requestId?: string;
}): Promise<{
  // Готовые к отправке WhatsApp-сообщения (пузыри) по порядку. Пусто только
  // если suppressed задан — тогда отправлять нечего и решает координатор.
  messages: string[];
  handoff: boolean;
  language?: DialogLanguage;
  suppressed?: "empty" | "duplicate";
}> {
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

  // Что пациент уже слышал от нас — для защиты от повторов. Системные
  // пометки и недоставленные ответы фильтрует вызывающий код (webhook).
  const recentAiTexts = params.history.filter((m) => m.from === "ai").map((m) => m.text);

  const generate = async (nudge?: string) => {
    const { text } = await generateWithFallback(
      nudge ? withNudge(contents, nudge) : contents,
      MEDITUR_SYSTEM_PROMPT,
      logger,
      { cacheable: true, generationConfig: REPLY_GENERATION_CONFIG }
    );
    return parseModelReply(text);
  };

  let reply = await generate();
  let handoff = reply.handoff;

  // (а) Модель не вернула ни одного сообщения (блок безопасности,
  // MAX_TOKENS, пустой JSON). Раньше здесь подставлялась одна жёсткая
  // русская строка — она уходила ВСЕМ пациентам одинаково и даже на
  // таджикском диалоге. Теперь: один повтор с подсказкой, а если и он
  // пустой — ничего не шлём, диалог уходит координатору (см. webhook).
  if (reply.messages.length === 0) {
    logger.warn("askGemini: модель не вернула ни одного сообщения — один повтор с подсказкой", { handoff });
    reply = await generate(NUDGE_EMPTY);
    handoff = handoff || reply.handoff;
  }

  // (б) Антидубль. Пузыри, повторяющие уже сказанное (или друг друга),
  // просто не отправляем — чаще всего это приклеенная в конец «закрывающая»
  // фраза. Если выброшено ВСЁ — один раз просим сказать что-то новое.
  let produced = reply.messages.length;
  let { kept, dropped } = dropDuplicateBubbles(reply.messages, recentAiTexts);
  if (produced > 0 && kept.length === 0) {
    logger.warn("askGemini: весь ответ повторяет уже сказанное — один повтор с подсказкой", {
      dropped: dropped.length,
    });
    reply = await generate(NUDGE_DUPLICATE);
    handoff = handoff || reply.handoff;
    produced = reply.messages.length;
    ({ kept, dropped } = dropDuplicateBubbles(reply.messages, recentAiTexts));
  }

  if (dropped.length > 0) {
    logger.info("askGemini: отброшены повторяющиеся пузыри", { dropped: dropped.length, kept: kept.length });
  }
  if (handoff) {
    logger.info("askGemini: модель запросила передачу координатору (handoff) — диалог будет поставлен на паузу");
  }

  const suppressed: "empty" | "duplicate" | undefined =
    kept.length > 0 ? undefined : produced === 0 ? "empty" : "duplicate";
  if (suppressed) {
    logger.warn("askGemini: отправлять нечего — ответ подавлен", { suppressed, handoff });
  }

  logger.info("askGemini: ответ готов", {
    bubbles: kept.length,
    structured: reply.structured,
    language: reply.language,
    handoff,
  });

  return { messages: kept, handoff, language: reply.language, suppressed };
}

// Ассистент подготовки Medical Opinion Request (Этап 4). Промпт — в
// lib/medical-opinion-prompt.ts, редактируется отдельно от регламента
// WhatsApp-бота (lib/playbook.ts). В отличие от askGemini, при пустом
// ответе бросает ошибку — вызывающий роут (case-assistant) должен вернуть
// координатору понятную 502, а не сохранить пустой "документ" в историю.
export async function askCaseAssistant(params: {
  history: Array<{ role: "user" | "assistant"; text: string }>;
  leadContext?: string;
  media?: Array<{ mimeType: string; base64: string }>;
  requestId?: string;
}): Promise<string> {
  const logger = params.requestId ? log.child(params.requestId) : log;

  const contents: any[] = [];

  // Реальные фото/голосовые, которые пациент прислал в WhatsApp (теперь
  // кэшируются в MediaAssets, см. lib/db.ts) — отдельным сообщением перед
  // историей чата с координатором, а не подмешаны в systemInstruction
  // (там может быть только текст).
  if (params.media && params.media.length > 0) {
    contents.push({
      role: "user",
      parts: params.media.map((m) => ({
        inlineData: { mimeType: m.mimeType, data: m.base64 },
      })) as GeminiPart[],
    });
  }

  contents.push(
    ...params.history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }] as GeminiPart[],
    }))
  );

  const systemInstruction = params.leadContext
    ? `${MEDICAL_OPINION_SYSTEM_PROMPT}\n\n# CASE DATA ALREADY ON FILE IN THE CRM\nUse this instead of asking the coordinator to repeat it. Treat anything the coordinator types below as additional or corrected information layered on top of this.\n${params.leadContext}`
    : MEDICAL_OPINION_SYSTEM_PROMPT;

  logger.info("askCaseAssistant: отправка запроса", {
    models: MODELS,
    historyMessages: params.history.length,
    mediaCount: params.media?.length ?? 0,
  });

  const { text } = await generateWithFallback(contents, systemInstruction, logger);
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

  const { text } = await generateWithFallback(contents, ANAMNESIS_EXTRACTION_PROMPT, logger);
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

// Быстрая проверка "жив ли ИИ" для страницы настроек. Пробует каждую
// модель из MODELS по очереди (как и реальные запросы через
// generateWithFallback) — раньше проверялась только основная модель без
// фолбэка, из-за чего статус мог показывать "не работает", хотя резервная
// модель прекрасно отвечала (именно так и было: extractAnamnesis работал,
// а статус — нет). В обход ретраев/кэша/tools — тут не нужна экономия,
// нужен быстрый и точный да/нет, с таймаутом на каждую попытку, чтобы
// страница настроек не зависала.
export async function checkGeminiHealth(requestId?: string): Promise<boolean> {
  const logger = requestId ? log.child(requestId) : log;
  if (!API_KEY) {
    logger.warn("checkGeminiHealth: GEMINI_API_KEY не задан");
    return false;
  }

  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }] }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (res.ok) {
        logger.info("checkGeminiHealth: модель ответила успешно", { model });
        return true;
      }
      logger.warn("checkGeminiHealth: модель вернула ошибку", {
        model,
        status: res.status,
        body: (await res.text().catch(() => "")).slice(0, 300),
      });
    } catch (err) {
      logger.warn("checkGeminiHealth: сетевая ошибка при проверке модели", {
        model,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.error("checkGeminiHealth: ни одна модель не ответила");
  return false;
}

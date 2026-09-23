import type { ChatMessage } from "@/lib/types";

// ВАЖНО: в плане названа модель "Gemini 1.5 Flash", но поколение 1.5 (как и
// 1.0) уже полностью отключено Google — такие запросы возвращают 404.
// Используем текущую модель по умолчанию, но линейка Gemini обновляется
// быстро, поэтому имя вынесено в переменную окружения GEMINI_MODEL, чтобы
// её можно было поменять без правки кода.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const API_KEY = process.env.GEMINI_API_KEY;

// Минимальная системная инструкция для проверки маршрута
// «вебхук → ИИ → ответ пациенту» на Этапе 3. Полный регламент Meditour
// (запрет на диагнозы от своего лица, финансовая и визовая политика,
// отработка возражений, Context Caching) — предмет Этапа 4.
const BASE_SYSTEM_INSTRUCTION = [
  "Ты — ассистент координационного центра Meditour, который помогает",
  "пациентам из Центральной Азии организовать лечение в Индии.",
  "Отвечай кратко, вежливо и на языке пациента.",
  "Уточняй диагноз, возраст и уже проведённые обследования, если их ещё нет.",
  "Никогда не формулируй диагноз от своего имени — только координатор или",
  "заключение индийской клиники. Не называй точные цены, если их нет в базе.",
].join(" ");

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
}): Promise<string> {
  if (!API_KEY) {
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

  const res = await fetch(
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

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API вернул ${res.status}: ${body}`);
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: GeminiPart) => p.text ?? "")
    .join("")
    .trim();

  return text || "Извините, не получилось сформировать ответ — уточните, пожалуйста, вопрос.";
}

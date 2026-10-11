/**
 * Песочница ИИ: чистая логика без сети и БД (покрыта lib/simulator.test.ts).
 * Здесь — как «играть пациента»: промпт для роли, преобразование переписки в
 * формат модели и разбор её реплики.
 */

export type SimLanguage = "ru" | "tg" | "uz";

export const SIM_LANGUAGE_LABELS: Record<SimLanguage, string> = {
  ru: "Русский",
  tg: "Таджикский",
  uz: "Узбекский",
};

export interface SimTurn {
  from: "patient" | "ai";
  text: string;
}

/** Модель-«пациент» отвечает этим маркером, когда разговору пора закончиться. */
export const END_MARKER = "[END]";

const LANGUAGE_INSTRUCTIONS: Record<SimLanguage, string> = {
  ru: "Russian, informal chat style, small typos and missing punctuation are fine",
  tg: "Tajik in Cyrillic script, informal, the way an ordinary Tajik person types in WhatsApp (short phrases, occasional spelling slips)",
  uz: "Uzbek, informal, the way an ordinary Uzbek person types in WhatsApp (Latin or Cyrillic script, whichever the persona would naturally use)",
};

export function buildPatientSystemPrompt(persona: string, language: SimLanguage): string {
  return [
    "You are role-playing a REAL person who writes on WhatsApp to a medical-tourism coordination service (treatment in clinics in India). The service's replies are produced by a chatbot that is being tested. Behave exactly like a genuine patient or patient's relative would. Never reveal that this is a simulation and never mention being an AI.",
    "",
    `PERSONA: ${persona}`,
    "",
    `LANGUAGE of every message you write: ${LANGUAGE_INSTRUCTIONS[language]}.`,
    "",
    "RULES:",
    "- Write ONLY the next single message the patient would send: one or two short sentences, like a chat message. No quotes, no labels, no explanations, no markdown.",
    "- The service's messages appear as the \"user\" turns of this conversation; your own earlier messages are the \"model\" turns.",
    "- Answer what the service asks, in character. Invent consistent, realistic details (age, diagnosis, city, which documents you have) and stay consistent with what you already said.",
    "- Do not be unrealistically cooperative: real people answer partially, hesitate, change the subject or ask about price — as the persona dictates.",
    "- You cannot attach files or photos. If asked for documents, say you will send them later, that you only have them on paper, or that you need to ask the doctor — whatever fits the persona.",
    `- If the conversation has naturally concluded (the service said it will pass your information to the doctors and get back to you, or you decided to stop writing), reply with exactly ${END_MARKER} and nothing else.`,
  ].join("\n");
}

export interface PatientContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

/**
 * Для модели-«пациента» роли зеркальны: её собственные реплики — «model»,
 * ответы сервиса (ИИ-ассистента) — «user». Последний ход обязан быть «user»,
 * иначе модели нечего продолжать.
 */
export function toPatientContents(transcript: SimTurn[]): PatientContent[] {
  const contents: PatientContent[] = transcript.map((t) => ({
    role: t.from === "patient" ? "model" : "user",
    parts: [{ text: t.text }],
  }));

  if (contents.length === 0) {
    return [{ role: "user", parts: [{ text: "(Диалог только начался. Напиши первое сообщение пациента.)" }] }];
  }
  if (contents[contents.length - 1].role === "model") {
    contents.push({
      role: "user",
      parts: [
        {
          text: `(Служебно: сервис пока не ответил. Напиши следующее сообщение пациента или ${END_MARKER}, если разговор окончен.)`,
        },
      ],
    });
  }
  return contents;
}

export function parsePatientReply(raw: string): { text: string; end: boolean } {
  let text = raw.trim();
  const end = text.toUpperCase().includes(END_MARKER);
  if (end) text = text.replace(/\[END\]/gi, "").trim();

  text = text
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^(patient|пациент)\s*:\s*/i, "")
    .trim();
  // Модель иногда оборачивает реплику в кавычки.
  if (/^["«“][\s\S]*["»”]$/.test(text)) text = text.slice(1, -1).trim();

  return { text, end };
}

export function transcriptToText(turns: SimTurn[]): string {
  return turns
    .map((t) => `${t.from === "patient" ? "Пациент" : "ИИ"}: ${t.text}`)
    .join("\n");
}

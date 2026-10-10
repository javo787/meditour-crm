import { z } from "zod";

// Всё, что отличает ответ живого координатора от ответа бота, но НЕ про
// содержание (содержание — это lib/playbook.ts), а про форму доставки:
//   1) разбор структурированного ответа модели (несколько WhatsApp-пузырей
//      + флаг передачи координатору) с безопасным откатом на обычный текст;
//   2) чистка markdown-артефактов, которые в WhatsApp выглядят как «ИИ»;
//   3) защита от повторов одной и той же мысли внутри диалога;
//   4) время «печатает…» пропорционально длине сообщения.
// Функции чистые (без сети и БД) — всё покрыто lib/humanize.test.ts.

export type DialogLanguage = "tg" | "uz" | "ru";

export const MAX_BUBBLES = 4;
const BUBBLE_SOFT_MAX = 240; // длиннее — уже «стена текста», а не сообщение

// ---------------------------------------------------------------------------
// 1) Разбор ответа модели
// ---------------------------------------------------------------------------

const ReplySchema = z.object({
  language: z.enum(["tg", "uz", "ru"]).optional().catch(undefined),
  messages: z.array(z.unknown()).optional().catch(undefined),
  handoff: z.boolean().optional().catch(undefined),
});

export interface ParsedReply {
  language?: DialogLanguage;
  messages: string[];
  handoff: boolean;
  // false — модель (или шлюз) вернула не JSON, и мы откатились на разбивку
  // обычного текста по строкам. Нужно только для логов/мониторинга.
  structured: boolean;
}

function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

// WhatsApp-форматирование: *жирный*, _курсив_. Модели по привычке пишут
// markdown (**жирный**, «- пункты», «# заголовки») — в чате это сразу
// выдаёт машину, а промпт списки и так запрещает.
export function sanitizeBubble(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\*\*([\s\S]+?)\*\*/g, "*$1*")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-•–]|\*(?=\s)|\d+[.)])\s+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Запасной разбор обычного текста на пузыри: по строкам, короткие соседние
// мысли склеиваем (чтобы не получилось 6 пузырей по 3 слова), хвост сверх
// MAX_BUBBLES возвращаем в последний пузырь, а не теряем.
export function splitIntoBubbles(text: string): string[] {
  const chunks = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const bubbles: string[] = [];
  for (const chunk of chunks) {
    const last = bubbles[bubbles.length - 1];
    if (last && last.length < 50 && last.length + chunk.length + 1 <= BUBBLE_SOFT_MAX) {
      bubbles[bubbles.length - 1] = `${last}\n${chunk}`;
    } else {
      bubbles.push(chunk);
    }
  }
  return capBubbles(bubbles);
}

export function capBubbles(bubbles: string[]): string[] {
  if (bubbles.length <= MAX_BUBBLES) return bubbles;
  const head = bubbles.slice(0, MAX_BUBBLES - 1);
  return [...head, bubbles.slice(MAX_BUBBLES - 1).join("\n")];
}

export function parseModelReply(raw: string): ParsedReply {
  const cleaned = stripCodeFences(raw);

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    json = undefined;
  }

  if (json && typeof json === "object" && !Array.isArray(json)) {
    const parsed = ReplySchema.safeParse(json);
    if (parsed.success) {
      const messages = (parsed.data.messages ?? [])
        .filter((m): m is string => typeof m === "string")
        .map(sanitizeBubble)
        .filter(Boolean);
      return {
        language: parsed.data.language,
        messages: capBubbles(messages),
        handoff: parsed.data.handoff ?? false,
        structured: true,
      };
    }
  }

  // Не JSON (например, запрос со схемой не прошёл и шлюз ответил обычным
  // текстом) — не теряем ответ, просто режем по строкам.
  return {
    messages: splitIntoBubbles(sanitizeBubble(raw)),
    handoff: false,
    structured: false,
  };
}

// ---------------------------------------------------------------------------
// 2) Повторы
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function bigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}

// Коэффициент Сёренсена–Дайса по биграммам символов: не зависит от языка и
// алфавита (кириллица/латиница), переживает перестановку пары слов и смену
// знаков препинания — ровно та разница, которой отличаются «одинаковые»
// ответы модели. 1 — идентично, 0 — ничего общего.
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const A = bigrams(na);
  const B = bigrams(nb);
  let overlap = 0;
  for (const [g, countA] of A) {
    const countB = B.get(g);
    if (countB) overlap += Math.min(countA, countB);
  }
  return (2 * overlap) / (na.length - 1 + (nb.length - 1));
}

const DUPLICATE_THRESHOLD = 0.82;
const MIN_LEN_FOR_CONTAINMENT = 25;
const RECENT_WINDOW = 8;

export function isNearDuplicate(candidate: string, recentAiTexts: string[]): boolean {
  const c = normalize(candidate);
  if (!c) return false;

  for (const prev of recentAiTexts.slice(-RECENT_WINDOW)) {
    const p = normalize(prev);
    if (!p) continue;
    if (p === c) return true;
    const [shorter, longer] = p.length <= c.length ? [p, c] : [c, p];
    // Короткое «Рахмат!» два раза подряд — нормальная речь; повтор целой
    // мысли — уже нет.
    if (shorter.length >= MIN_LEN_FOR_CONTAINMENT && longer.includes(shorter)) return true;
    if (shorter.length >= MIN_LEN_FOR_CONTAINMENT && similarity(candidate, prev) >= DUPLICATE_THRESHOLD) {
      return true;
    }
  }
  return false;
}

// Выкидывает пузыри, повторяющие уже сказанное (в том числе друг друга
// внутри одного ответа). Дешевле и надёжнее, чем просить модель
// переформулировать: типичный дубль — это приклеенная в конец «закрывающая»
// фраза, которую достаточно просто не отправлять.
export function dropDuplicateBubbles(
  bubbles: string[],
  recentAiTexts: string[]
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = [...recentAiTexts];
  for (const bubble of bubbles) {
    if (isNearDuplicate(bubble, seen)) {
      dropped.push(bubble);
    } else {
      kept.push(bubble);
      seen.push(bubble);
    }
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// 3) Время «печатает…»
// ---------------------------------------------------------------------------

const TYPING_BASE_MS = 600;
const TYPING_PER_CHAR_MS = 35;
const TYPING_MIN_MS = 900;
const TYPING_MAX_MS = 7000;

// Человек не отвечает за 0 секунд и не печатает 200 символов за секунду.
// Длительность линейна по длине + разброс ±20%, чтобы два одинаковых по
// длине сообщения не уходили с одинаковой паузой. rand инъектируется ради
// детерминированных тестов.
export function typingDelayMs(text: string, rand: () => number = Math.random): number {
  const raw = TYPING_BASE_MS + text.length * TYPING_PER_CHAR_MS;
  const jitter = 0.8 + rand() * 0.4;
  return Math.round(Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, raw * jitter)));
}

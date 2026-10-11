/**
 * Исходящие сообщения приходят в вебхук дважды по смыслу:
 *  1) CRM/ИИ сами отправили сообщение — оно уже в истории (его сохраняют ДО
 *     отправки), а WhatsApp присылает «эхо» с пометкой fromMe;
 *  2) координатор написал пациенту с телефона — в истории его нет, и это
 *     эхо — единственный способ его увидеть.
 * Чтобы отличить одно от другого, сопоставляем эхо с ещё «не закреплённым»
 * исходящим сообщением из недавней истории по тексту.
 */

/** Как долго после сохранения сообщения ждём его эхо из WhatsApp. */
export const ECHO_WINDOW_MS = 10 * 60 * 1000;

/** Сравнение без учёта лишних пробелов и переносов — WhatsApp их может нормализовать. */
export function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Находит среди кандидатов (от старых к новым) первое исходящее сообщение с
 * тем же текстом. Берём самое раннее: так два одинаковых «Хорошо» подряд
 * закрепятся за двумя разными эхо, а не за одним.
 */
export function findEchoMatch<T extends { text: string }>(
  candidates: T[],
  text: string
): T | undefined {
  const target = normalizeMessageText(text);
  if (!target) return undefined;
  return candidates.find((c) => normalizeMessageText(c.text) === target);
}

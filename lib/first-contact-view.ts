import { format } from "date-fns";
import { ru } from "date-fns/locale";

import { FIRST_CONTACT_CONFIG } from "@/lib/first-contact-config";
import type { FirstContactState } from "@/lib/types";

/** Одна строка для карточки лида: что сейчас делает каденция первых контактов. */
export function describeFirstContact(state: FirstContactState | undefined): string | undefined {
  if (!state) return undefined;
  if (state.phase === "scheduled") {
    return `ИИ напишет сам ${format(new Date(state.touch1DueAt), "d MMMM", { locale: ru })} (с 10:00 до 19:00), если лид не ответит раньше.`;
  }
  const sent = new Date(state.touch1At ?? state.anchorAt);
  const closeAt = new Date(sent.getTime() + FIRST_CONTACT_CONFIG.closeAfterTouch1Ms);
  return `ИИ написал ${format(sent, "d MMMM", { locale: ru })}. Если до ${format(closeAt, "d MMMM", { locale: ru })} ответа не будет — лид станет «Без ответа».`;
}

import { addDays, differenceInCalendarDays, endOfDay, startOfDay } from "date-fns";

/**
 * Быстрые пресеты для выбора даты следующего касания.
 * Значения — «через N дней от сегодня» (см. cadence в гайде координатора).
 */
export const NEXT_TOUCH_PRESETS = [
  { label: "Сегодня", days: 0 },
  { label: "Завтра", days: 1 },
  { label: "Через 3 дня", days: 3 },
  { label: "Через неделю", days: 7 },
  { label: "Через 2 недели", days: 14 },
] as const;

/** Русская плюрализация: 1 день, 2 дня, 5 дней, 21 день. */
export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «Сегодня», «Завтра», «Через 5 дней», «Просрочено на 2 дня». */
export function describeRelativeDay(target: Date, now: Date = new Date()): string {
  const diff = differenceInCalendarDays(startOfDay(target), startOfDay(now));
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  if (diff === -1) return "Просрочено на 1 день";
  if (diff < 0) {
    const n = Math.abs(diff);
    return `Просрочено на ${n} ${pluralizeRu(n, "день", "дня", "дней")}`;
  }
  return `Через ${diff} ${pluralizeRu(diff, "день", "дня", "дней")}`;
}

/**
 * Касание считается просроченным только после окончания выбранного дня,
 * поэтому сохраняем конец дня по локальному времени координатора.
 * (Не начало дня: иначе «сегодня» сразу становилось бы просроченным,
 * а при рендере на сервере в UTC дата могла бы «съехать» на вчера.)
 */
export function toNextTouchIso(date: Date): string {
  return endOfDay(date).toISOString();
}

export function presetDate(days: number, now: Date = new Date()): Date {
  return startOfDay(addDays(now, days));
}

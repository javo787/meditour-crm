import { differenceInCalendarDays } from "date-fns";

import type { Lead } from "@/lib/types";

/**
 * Часовой пояс координатора. Нужен серверу, чтобы понимать, где кончается
 * «сегодня» (счётчик в меню считается в layout, а не в браузере).
 * Переопределяется переменной окружения CRM_TIMEZONE.
 */
export const DEFAULT_CRM_TIMEZONE = "Asia/Dushanbe";

export type TouchBucket = "overdue" | "today" | "tomorrow" | "week" | "later";

export const TOUCH_BUCKETS: TouchBucket[] = ["overdue", "today", "tomorrow", "week", "later"];

export function isActiveLead(lead: Pick<Lead, "stage">): boolean {
  return lead.stage !== "won" && lead.stage !== "declined";
}

/**
 * Раскладка по календарным дням (а не по isPast): касание «на сегодня»
 * остаётся в «Сегодня» до полуночи, а не превращается в просрочку в 00:01.
 */
export function touchBucket(nextTouch: string, now: Date = new Date()): TouchBucket {
  const diff = differenceInCalendarDays(new Date(nextTouch), now);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return "week";
  return "later";
}

/**
 * Приоритет внутри группы: сначала те, кому мы должны ответить (пациент
 * написал последним), затем по дате касания, затем по имени.
 */
function compareTouches(a: Lead, b: Lead): number {
  const aWaiting = a.lastMessageFrom === "patient" ? 0 : 1;
  const bWaiting = b.lastMessageFrom === "patient" ? 0 : 1;
  if (aWaiting !== bWaiting) return aWaiting - bWaiting;
  const byDate = new Date(a.nextTouch).getTime() - new Date(b.nextTouch).getTime();
  if (byDate !== 0) return byDate;
  return a.name.localeCompare(b.name, "ru");
}

export function groupTouches(
  leads: Lead[],
  now: Date = new Date()
): Record<TouchBucket, Lead[]> {
  const out: Record<TouchBucket, Lead[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
  };
  for (const lead of leads) {
    if (!isActiveLead(lead)) continue;
    out[touchBucket(lead.nextTouch, now)].push(lead);
  }
  for (const key of TOUCH_BUCKETS) out[key].sort(compareTouches);
  return out;
}

/** Смещение часового пояса tz относительно UTC в мс на момент date. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Конец текущего дня (23:59:59.999) в часовом поясе timeZone — как момент времени. */
export function endOfDayInZone(now: Date, timeZone: string): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(Date.parse(`${ymd}T23:59:59.999Z`) - zoneOffsetMs(now, timeZone));
}

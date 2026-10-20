// Окно, в которое бот зовёт пациента на звонок (по умолчанию 12:00–17:00
// по Душанбе — рабочие часы координатора).
//
// Почему это отдельная «служебная подсказка», а не часть MEDITUR_SYSTEM_PROMPT:
// системный промпт лежит в explicit-кэше Gemini (см. lib/gemini.ts) и шлётся
// на каждое сообщение по сниженному тарифу. Любое изменение его текста — это
// новый кэш и полная цена за весь промпт. Поэтому промпт остаётся константным,
// а в рабочее окно к ПОСЛЕДНЕМУ сообщению пациента дописывается короткая
// подсказка (~90 токенов; вне окна — 0). Золотая середина: качество
// приглашения как у «живого» промпта, расход — копейки, кэш не ломается.

export interface CallWindowConfig {
  timeZone: string;
  startHour: number; // включительно
  endHour: number; // не включительно
}

const DEFAULT_TIME_ZONE = "Asia/Dushanbe";
const DEFAULT_START_HOUR = 12;
const DEFAULT_END_HOUR = 17;

function parseHour(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 24 ? n : fallback;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Читается при каждом вызове (а не при загрузке модуля), чтобы смена
// переменных на Render и тесты не требовали перезагрузки процесса. Любое
// некорректное значение молча заменяется значением по умолчанию — опечатка в
// настройке не должна ронять ответ пациенту.
// Одинаковые начало и конец = окно пустое, приглашения на звонок отключены.
export function getCallWindowConfig(env: NodeJS.ProcessEnv = process.env): CallWindowConfig {
  const tz = env.BOT_TIMEZONE?.trim();
  return {
    timeZone: tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE,
    startHour: parseHour(env.CALL_WINDOW_START_HOUR, DEFAULT_START_HOUR),
    endHour: parseHour(env.CALL_WINDOW_END_HOUR, DEFAULT_END_HOUR),
  };
}

// Час (0–23) в заданном часовом поясе. hourCycle h23 — чтобы полночь была 0, а не 24.
export function localHour(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export function isInCallWindow(now: Date, config: CallWindowConfig = getCallWindowConfig()): boolean {
  const hour = localHour(now, config.timeZone);
  const { startHour, endHour } = config;
  // Окно через полночь (например, 22 → 2).
  if (startHour > endHour) return hour >= startHour || hour < endHour;
  return hour >= startHour && hour < endHour;
}

export const CALL_INVITE_HINT =
  "(Служебная подсказка, пациент её не видит.) Сейчас рабочие часы координатора. " +
  "Ответь по существу, а затем отдельным коротким сообщением предложи созвониться прямо сейчас " +
  "(своими словами, на языке диалога, без давления). " +
  "Если ты уже звал на звонок в этом диалоге и пациент не откликнулся или отказался — не повторяй. " +
  "Если пациент согласился — скажи, что координатор сам ему наберёт, и поставь handoff = true.";

export function callInviteHint(now: Date, config?: CallWindowConfig): string | undefined {
  return isInCallWindow(now, config) ? CALL_INVITE_HINT : undefined;
}

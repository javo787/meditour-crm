// Форматирование плана: суммы так, как их пишут в письмах, даты по-русски, подписи пола и клиники.
// Чистые функции без сети и БД: используются и на сервере, и в браузере.
import type { PlanClinic, PlanGender } from "./schema";

// Неразрывный пробел: разделяет разряды в суммах, чтобы «6 800» не рвалось на две строки.
const NBSP = " ";

// Число: с разрядами (пробел, NBSP или запятая между группами по три цифры) или с дробной частью (1–2 цифры после точки или запятой).
const NUMBER = /\d{1,3}(?:[ , ]\d{3}(?!\d))+|\d+(?:[.,]\d{1,2}(?!\d))?/g;
// То же с разделителями разрядов внутри, с предшествующим символом (чтобы не начинаться посреди числа).
const THOUSANDS = /(^|\D)(\d{1,3}(?:[ , ]\d{3}(?!\d))+)/g;

// Валюта: USD, US$, $ и «dollars» — перед числом или после него.
const CURRENCY = /US\$|USD|\$|dollars?(?![a-z])/.source;
const SEP = "[ \\u00A0]";
// Денежное выражение: «USD 6,800», «$7600 - $9000», «USD 500-USD 800», «Cost 6,800 USD», «USD 2000-2500».
const MONEY = new RegExp(
  `(?:(?:${CURRENCY})${SEP}?)?(${NUMBER.source})(?:${SEP}*[-\\u2013\\u2014]${SEP}*(?:(?:${CURRENCY})${SEP}?)?(${NUMBER.source}))?(?:${SEP}?(?:${CURRENCY}))?`,
  "gi",
);
const HAS_CURRENCY = /US\$|USD|\$|dollar/i;

// Английские приписки к сумме («per day») и их русские пары; закрытый набор, регистр не важен.
const PER_UNIT: Array<[RegExp, string]> = [
  [/\s+per\s+day\b|\s+a\s+day\b|\s+daily\b|\s*\/\s*day\b/gi, " в день"],
  [/\s+per\s+night\b/gi, " за ночь"],
  [/\s+per\s+visit\b/gi, " за визит"],
  [/\s+per\s+session\b/gi, " за сеанс"],
  [/\s+per\s+week\b/gi, " в неделю"],
];

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTHS_NOMINATIVE = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
const GENDER_LABELS: Record<PlanGender, string> = { male: "Мужской", female: "Женский", unknown: "—" };

// Группы по три цифры от конца, между ними неразрывный пробел: 6800 → «6 800».
const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

// Убирает разделители разрядов: «6,800» и «6 800» → «6800».
const joinThousands = (text: string) =>
  text.replace(THOUSANDS, (_, before: string, num: string) => before + num.replace(/[ , ]/g, ""));

// Число из текста: «6800» и «6,800» → 6800, «1,5» → 1.5.
const toNumber = (token: string): number =>
  /^\d{1,3}(?:[ , ]\d{3})+$/.test(token)
    ? Number(token.replace(/[ , ]/g, ""))
    : Number(token.replace(",", "."));

// Сумма в виде, как её печатаем: без валюты, диапазон через «–», разряды неразрывным пробелом, приписка по-русски.
export function formatAmount(raw: string): string {
  let s = joinThousands(raw.replace(/US\$|USD|\$/gi, "").replace(/\/-/g, "").trim());
  for (const [english, russian] of PER_UNIT) s = s.replace(english, russian);
  s = s.replace(/(\d)[  ]*[-–—][  ]*(?=\d)/g, "$1 – ");
  s = s.replace(/(^|[^\d.])(\d{4,})/g, (_, before: string, digits: string) => before + groupDigits(digits));
  return s.replace(/ {2,}/g, " ").trim();
}

// Все числа текста; разряды схлопнуты: «6 800», «6,800» и «6800» дают 6800.
export function amountNumbers(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(toNumber);
}

// Числа, стоящие рядом с маркером валюты (до или после), включая вторую часть диапазона без маркера.
// Рупии и числа без маркера не попадают. Порядок — как в письме.
export function letterMoneyNumbers(source: string): number[] {
  const out: number[] = [];
  for (const m of source.matchAll(MONEY)) {
    if (!HAS_CURRENCY.test(m[0])) continue;
    for (const token of [m[1], m[2]]) if (token) out.push(toNumber(token));
  }
  return out;
}

// «2026-10-09» → «9 октября 2026 г.»
export function formatRuDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS_GENITIVE[Number(month) - 1]} ${year} г.`;
}

// «2026-10-09» → «09.10.2026»
export function formatDotDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

// «2026-09» → «сентябрь 2026 г.»
export function formatMonthYear(ym: string): string {
  const [year, month] = ym.split("-");
  return `${MONTHS_NOMINATIVE[Number(month) - 1]} ${year} г.`;
}

// Сегодняшняя дата ISO («2026-10-09») в часовом поясе плана.
export function todayInZone(now: Date = new Date(), timeZone = "Asia/Dushanbe"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function genderLabel(gender: PlanGender): string {
  return GENDER_LABELS[gender];
}

// Короткое название клиники для таблиц: «Example A (Фаридабад)».
export function clinicLabel(clinic: Pick<PlanClinic, "name" | "shortName" | "city">): string {
  const base = clinic.shortName || clinic.name;
  return clinic.city ? `${base} (${clinic.city})` : base;
}

// Строки по возрастанию первого числа суммы; без чисел — в конце. Порядок равных — прежний; исходный массив не меняется.
export function sortRowsByAmount<T extends { amount: string }>(rows: T[]): T[] {
  const first = (row: T) => amountNumbers(row.amount)[0] ?? Infinity;
  return rows
    .map((row, index) => ({ row, index, key: first(row) }))
    .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? -1 : 1))
    .map((item) => item.row);
}

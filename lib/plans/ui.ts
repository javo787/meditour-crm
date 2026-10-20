import { PLAN_LIMITS, type PlanGeneration, type PlanStatus, type PlanWarning } from "./schema";

// Чистая логика интерфейса раздела «Планы»: подписи статусов, счётчики, раздел редактора по пути
// предупреждения, форматы даты и лимитов. Без React и без сети, поэтому покрыта тестами (ui.test.ts).

export const PLAN_TIME_ZONE = "Asia/Dushanbe";

// «Читаю письмо…» и т. д. — подпись статуса в списке и в шапке редактора.
export function statusLabel(status: PlanStatus, generationState: PlanGeneration["state"]): string {
  if (status === "reviewed") return "Проверено";
  if (status === "draft") return "Черновик";
  if (generationState === "running") return "Читаю письмо…";
  if (generationState === "failed") return "Не удалось разобрать";
  return "Нет черновика";
}

// Сколько предупреждений каждого уровня (красные, жёлтые, серые).
export function warningCounts(warnings: PlanWarning[]): { error: number; warn: number; info: number } {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const warning of warnings) counts[warning.level] += 1;
  return counts;
}

// Корень пути предупреждения → раздел редактора.
const ROOT_SECTIONS = new Map<string, string>([
  ["patient", "patient"],
  ["profile", "patient"],
  ["overview", "overview"],
  ["diagnosis", "diagnosis"],
  ["indiaSteps", "indiaSteps"],
  ["tactic", "tactic"],
  ["documents", "documents"],
  ["clinics", "clinics"],
  ["approach", "approach"],
  ["costs", "costs"],
  ["stay", "stay"],
  ["included", "included"],
  ["notIncluded", "included"],
]);

// Поля внутри fixed: часть из них относится к разделу, которого нет в корне пути.
const FIXED_SECTIONS = new Map<string, string>([
  ["tacticDisclaimer", "tactic"],
  ["costFootnote", "costs"],
  ["flights", "stay"],
  ["support", "included"],
  ["nextSteps", "nextSteps"],
]);

// Поля внутри options: переключатели и дата живут в разделе «Настройки».
const OPTION_SECTIONS = new Map<string, string>([
  ["diagnosisHeading", "diagnosis"],
  ["clinicsVerifiedOnSites", "clinics"],
  ["clinicsVerifiedMonth", "clinics"],
  ["date", "settings"],
  ["showPageNumbers", "settings"],
]);

// Ключ раздела редактора по пути предупреждения («costs.groups[0].rows[1].amount» → «costs»).
// Без пути или с неизвестным корнем — «general». Карты, а не объекты: «constructor» не должен находить прототип объекта.
export function sectionOfPath(path?: string): string {
  if (!path) return "general";
  const parts = path.split(/[.[\]]+/).filter(Boolean);
  const root = parts[0] ?? "";
  const key = parts[1] ?? "";
  if (root === "fixed") return FIXED_SECTIONS.get(key) ?? "general";
  if (root === "options") return OPTION_SECTIONS.get(key) ?? "general";
  return ROOT_SECTIONS.get(root) ?? "general";
}

// Разделители тысяч пробелом: 40000 → «40 000».
function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// Счётчик письма «N / 40 000»: длина считается как вставлено; при превышении поле краснеет.
export function sourceCounter(length: number): { label: string; over: boolean } {
  return {
    label: `${groupDigits(length)} / ${groupDigits(PLAN_LIMITS.sourceChars)}`,
    over: length > PLAN_LIMITS.sourceChars,
  };
}

// Можно ли отправить форму: не во время запроса; с файлом текст не учитывается; без файла нужен непустой
// текст не длиннее лимита.
export function canSubmitPlan({ text, hasFile, busy }: { text: string; hasFile: boolean; busy: boolean }): boolean {
  if (busy) return false;
  if (hasFile) return true;
  return text.trim().length > 0 && text.length <= PLAN_LIMITS.sourceChars;
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: PLAN_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Дата и время в часовом поясе плана: «2026-10-20T09:30:00Z» → «20.10.2026 14:30».
export function formatPlanDateTime(iso: string): string {
  const parts = new Map(DATE_TIME_FORMAT.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.get("day")}.${parts.get("month")}.${parts.get("year")} ${parts.get("hour")}:${parts.get("minute")}`;
}

// Имя выбранного файла — .docx (без учёта регистра). Проверка на клиенте только для подсказки; сервер проверяет сам.
export function isDocxName(name: string): boolean {
  return name.toLowerCase().endsWith(".docx");
}

// Перенос элемента списка (кнопки «вверх» / «вниз»). Возвращает новый массив; неверный индекс — копия без изменений.
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < list.length;
  if (!valid(from) || !valid(to)) return next;
  const moved = next.splice(from, 1);
  next.splice(to, 0, ...moved);
  return next;
}

// Удаление элемента списка по индексу. Возвращает новый массив.
export function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

// Можно ли отметить план проверенным: все три подтверждения отмечены и нет предупреждений уровня error (§9).
export function canReview(
  warnings: PlanWarning[],
  confirmations: Record<"amounts" | "clinics" | "patient", boolean>,
): boolean {
  if (warnings.some((warning) => warning.level === "error")) return false;
  return confirmations.amounts && confirmations.clinics && confirmations.patient;
}

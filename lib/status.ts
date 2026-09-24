import type { Stage } from "@/lib/types";

// Порядок и подписи — один в один с листом «Дашборд» реальной таблицы
// координатора (Meditur-Учёт_лидов.xlsx).
export const STAGES: { key: Stage; label: string }[] = [
  { key: "new", label: "Новый" },
  { key: "first_contact", label: "Первый контакт" },
  { key: "consult_scheduled", label: "Консультация назначена" },
  { key: "consult_done", label: "Консультация проведена" },
  { key: "estimate_sent", label: "Смета отправлена" },
  { key: "awaiting_decision", label: "Ожидание решения" },
  { key: "won", label: "Выиграно" },
  { key: "declined", label: "Отказ" },
];

// Один и тот же цвет статуса используется и в канбане, и в таблице лидов —
// осознанный приём, чтобы статус читался одинаково в обоих местах.
export const STAGE_STYLES: Record<Stage, string> = {
  new: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  first_contact: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  consult_scheduled:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  consult_done:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  estimate_sent:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  awaiting_decision:
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  won: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  declined: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

export function stageLabel(stage: Stage): string {
  return STAGES.find((s) => s.key === stage)?.label ?? stage;
}

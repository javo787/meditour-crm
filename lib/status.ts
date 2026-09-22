import type { Stage } from "@/lib/types";

export const STAGES: { key: Stage; label: string }[] = [
  { key: "new", label: "Новый" },
  { key: "data_collection", label: "Сбор данных" },
  { key: "waiting_india", label: "Ожидание Индии" },
  { key: "plan_sent", label: "План отправлен" },
  { key: "declined", label: "Отказ" },
  { key: "won", label: "Выиграно" },
];

// Один и тот же цвет статуса используется и в канбане, и в таблице лидов —
// это осознанный приём, чтобы статус читался одинаково в обоих местах.
export const STAGE_STYLES: Record<Stage, string> = {
  new: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  data_collection:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  waiting_india:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  plan_sent: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  declined: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  won: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

export function stageLabel(stage: Stage): string {
  return STAGES.find((s) => s.key === stage)?.label ?? stage;
}

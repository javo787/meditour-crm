"use client";

import { AlertTriangle, CircleAlert, Info, type LucideIcon } from "lucide-react";

import type { PlanWarning } from "@/lib/plans/schema";
import { sectionOfPath, warningCounts } from "@/lib/plans/ui";
import { cn } from "@/lib/utils";

import { LEVEL_TEXT_CLASS, PLAN_SECTION_TITLES } from "./fields";

const LEVEL_ORDER: Record<PlanWarning["level"], number> = { error: 0, warn: 1, info: 2 };

// Подпись уровня рядом со значком: цвет не единственный признак.
const LEVEL_LABEL: Record<PlanWarning["level"], string> = { error: "Ошибка", warn: "Проверить", info: "Заметка" };

const LEVEL_ICON: Record<PlanWarning["level"], LucideIcon> = { error: CircleAlert, warn: AlertTriangle, info: Info };

export interface WarningsPanelProps {
  warnings: PlanWarning[];
  onJump: (sectionKey: string) => void; // ключ раздела из sectionOfPath; редактор открывает и прокручивает раздел
}

// Панель «Нужно проверить»: счётчики по уровням и список предупреждений. Красные выше жёлтых, жёлтые выше серых.
export function WarningsPanel({ warnings, onJump }: WarningsPanelProps) {
  const counts = warningCounts(warnings);
  const sorted = [...warnings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">Нужно проверить</h2>
        <ul className="flex flex-wrap gap-x-3 text-xs font-medium">
          <li className={cn(LEVEL_TEXT_CLASS.error, counts.error === 0 && "opacity-50")}>Ошибок: {counts.error}</li>
          <li className={cn(LEVEL_TEXT_CLASS.warn, counts.warn === 0 && "opacity-50")}>Проверить: {counts.warn}</li>
          <li className={cn(LEVEL_TEXT_CLASS.info, counts.info === 0 && "opacity-50")}>Заметки: {counts.info}</li>
        </ul>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Предупреждений нет.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {sorted.map((warning, index) => {
            const Icon = LEVEL_ICON[warning.level];
            const sectionKey = sectionOfPath(warning.path);
            return (
              <li key={`${warning.code}-${index}`}>
                <button
                  type="button"
                  onClick={() => onJump(sectionKey)}
                  className="flex min-h-10 w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", LEVEL_TEXT_CLASS[warning.level])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{warning.message}</span>
                    <span className="block text-xs text-muted-foreground">
                      {LEVEL_LABEL[warning.level]} · {PLAN_SECTION_TITLES[sectionKey] ?? PLAN_SECTION_TITLES.general}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

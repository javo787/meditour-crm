"use client";

import { useId, type ChangeEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PlanWarning } from "@/lib/plans/schema";
import { moveItem, removeAt } from "@/lib/plans/ui";
import { cn } from "@/lib/utils";

// Строительные блоки формы плана: раздел-«details», поля ввода с подсветкой предупреждений, редактор списка.
// Компоненты не знают про сеть и план целиком: всё приходит через props.

// Русские заголовки разделов в порядке PDF. Ключи — из sectionOfPath (lib/plans/ui.ts).
export const PLAN_SECTION_TITLES: Readonly<Record<string, string>> = {
  patient: "Пациент и профиль",
  overview: "Обзор",
  diagnosis: "Диагноз",
  indiaSteps: "Что сделать в Индии",
  tactic: "Тактика",
  documents: "Документы",
  clinics: "Клиники",
  approach: "Подход",
  costs: "Стоимость",
  stay: "Проезд и пребывание",
  included: "Включено и не включено",
  nextSteps: "Следующий шаг",
  settings: "Настройки документа",
  general: "Общее",
};

// Цвет текста предупреждения по уровню: красный / жёлтый / серый.
export const LEVEL_TEXT_CLASS: Readonly<Record<PlanWarning["level"], string>> = {
  error: "text-destructive",
  warn: "text-amber-700 dark:text-amber-400",
  info: "text-muted-foreground",
};

const LEVEL_BADGE_CLASS: Record<PlanWarning["level"], string> = {
  error: "bg-destructive text-destructive-foreground",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  info: "bg-secondary text-secondary-foreground",
};

const LEVEL_BORDER_CLASS: Record<PlanWarning["level"], string> = {
  error: "border-destructive",
  warn: "border-amber-500",
  info: "border-muted-foreground",
};

// Самый тяжёлый уровень из списка: красный > жёлтый > серый; пустой список — null.
function worstLevel(warnings: PlanWarning[]): PlanWarning["level"] | null {
  if (warnings.some((w) => w.level === "error")) return "error";
  if (warnings.some((w) => w.level === "warn")) return "warn";
  if (warnings.length > 0) return "info";
  return null;
}

// id элемента раздела на странице: по нему панель «Нужно проверить» находит раздел.
export function sectionDomId(key: string): string {
  return `plan-section-${key}`;
}

// Открывает раздел и прокручивает к нему. false — такого раздела на странице нет.
export function revealSection(key: string): boolean {
  const el = document.getElementById(sectionDomId(key));
  if (!(el instanceof HTMLDetailsElement)) return false;
  el.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

export interface SectionProps {
  id: string; // ключ раздела, как у sectionOfPath
  title: string;
  warnings: PlanWarning[]; // предупреждения этого раздела
  defaultOpen?: boolean;
  children: ReactNode;
}

// Раздел редактора на нативном <details>. Счётчик предупреждений окрашен по самому тяжёлому уровню.
export function Section({ id, title, warnings, defaultOpen, children }: SectionProps) {
  const level = worstLevel(warnings);
  return (
    <details
      id={sectionDomId(id)}
      open={defaultOpen}
      className="group rounded-lg border border-border bg-card"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {level ? (
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", LEVEL_BADGE_CLASS[level])}>
              <span className="sr-only">Предупреждений: </span>
              {warnings.length}
            </span>
          ) : null}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number; // из PLAN_LIMITS; ограничивает ввод и показывает счётчик у предела
  hint?: string;
  warning?: PlanWarning[]; // только предупреждения, чей path равен пути этого поля
  disabled?: boolean;
}

// Поле в одну строку.
export function TextField(props: TextFieldProps) {
  return <Field {...props} multiline={false} />;
}

// Поле в несколько строк.
export function TextAreaField(props: TextFieldProps) {
  return <Field {...props} multiline />;
}

function Field({
  label,
  value,
  onChange,
  maxLength,
  hint,
  warning = [],
  disabled,
  multiline,
}: TextFieldProps & { multiline: boolean }) {
  const id = useId();
  const noteId = `${id}-note`;
  const level = worstLevel(warning);
  const over = maxLength !== undefined && value.length > maxLength;
  const nearLimit = maxLength !== undefined && value.length >= maxLength * 0.8;
  const common = {
    id,
    value,
    disabled,
    maxLength,
    "aria-invalid": level === "error" ? true : undefined,
    "aria-describedby": noteId,
    className: level ? LEVEL_BORDER_CLASS[level] : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? <Textarea {...common} /> : <Input {...common} />}
      <div id={noteId} className="space-y-1 text-xs">
        {hint ? <p className="text-muted-foreground">{hint}</p> : null}
        {warning.map((w, i) => (
          <p key={`${w.code}-${i}`} className={cn("font-medium", LEVEL_TEXT_CLASS[w.level])}>
            {w.message}
          </p>
        ))}
        {nearLimit ? (
          <p className={cn("text-right tabular-nums", over ? "font-medium text-destructive" : "text-muted-foreground")}>
            {value.length} / {maxLength}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface ListEditorProps<T> {
  items: T[];
  onChange: (items: T[]) => void;
  createItem: () => T; // значение для новой строки
  // Поля одной строки. update заменяет строку целиком (вызывать с новым объектом).
  renderItem: (item: T, index: number, update: (next: T) => void) => ReactNode;
  addLabel: string; // текст кнопки добавления, например «Добавить клинику»
  getKey?: (item: T, index: number) => string; // стабильный ключ строки; по умолчанию индекс
  max?: number; // предел числа строк: по достижении добавление отключается
  disabled?: boolean;
  emptyText?: string;
}

// Список строк с кнопками «Вверх», «Вниз», «Удалить» и «Добавить». Не мутирует массив: каждое действие отдаёт новый.
export function ListEditor<T>({
  items,
  onChange,
  createItem,
  renderItem,
  addLabel,
  getKey,
  max,
  disabled = false,
  emptyText,
}: ListEditorProps<T>) {
  const full = max !== undefined && items.length >= max;
  return (
    <div className="space-y-3">
      {items.length === 0 && emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null}
      <ul className="space-y-3">
        {items.map((item, index) => {
          const update = (next: T) => onChange(items.map((old, i) => (i === index ? next : old)));
          const position = index + 1;
          return (
            <li key={getKey ? getKey(item, index) : index} className="space-y-3 rounded-md border border-border p-3">
              {renderItem(item, index, update)}
              <div className="flex flex-wrap justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Вверх, строка ${position}`}
                  disabled={disabled || index === 0}
                  onClick={() => onChange(moveItem(items, index, index - 1))}
                >
                  <ChevronUp className="h-4 w-4" />
                  Вверх
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Вниз, строка ${position}`}
                  disabled={disabled || index === items.length - 1}
                  onClick={() => onChange(moveItem(items, index, index + 1))}
                >
                  <ChevronDown className="h-4 w-4" />
                  Вниз
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Удалить, строка ${position}`}
                  disabled={disabled}
                  onClick={() => onChange(removeAt(items, index))}
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || full}
          onClick={() => onChange([...items, createItem()])}
        >
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
        {full ? <span className="text-xs text-muted-foreground">Не больше {max} строк</span> : null}
      </div>
    </div>
  );
}

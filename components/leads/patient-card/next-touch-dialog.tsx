"use client";

import { useEffect, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarClock, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NEXT_TOUCH_PRESETS, describeRelativeDay, presetDate } from "@/lib/next-touch";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEK = { weekStartsOn: 1 } as const;
const keyOf = (d: Date) => format(d, "yyyy-MM-dd");

interface NextTouchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Текущая дата следующего касания (ISO). */
  currentValue: string;
  patientName?: string;
  onSave: (date: Date) => Promise<void>;
}

export function NextTouchDialog({
  open,
  onOpenChange,
  currentValue,
  patientName,
  onSave,
}: NextTouchDialogProps) {
  const [selected, setSelected] = useState<Date>(() => startOfDay(new Date()));
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [focusDay, setFocusDay] = useState<Date>(() => startOfDay(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);

  // «Сегодня» фиксируем на момент открытия — модалка не должна «прыгать»,
  // если её оставили открытой через полночь.
  const [today, setToday] = useState<Date>(() => startOfDay(new Date()));
  const currentDay = startOfDay(new Date(currentValue));

  useEffect(() => {
    if (!open) return;
    const t = startOfDay(new Date());
    const initial = startOfDay(new Date(currentValue));
    const anchor = isBefore(initial, t) ? t : initial;
    setToday(t);
    setSelected(initial);
    setFocusDay(anchor);
    setViewMonth(startOfMonth(anchor));
    setError(null);
    setSaving(false);
  }, [open, currentValue]);

  // Всегда 6 недель — высота модалки не скачет при смене месяца.
  const gridStart = startOfWeek(startOfMonth(viewMonth), WEEK);
  const days = eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });

  // Якорь для roving tabindex: всегда существует в видимом месяце.
  const firstValidInMonth = isBefore(startOfMonth(viewMonth), today)
    ? today
    : startOfMonth(viewMonth);
  const anchor = isSameMonth(focusDay, viewMonth) ? focusDay : firstValidInMonth;

  const canGoPrev = isBefore(today, startOfMonth(viewMonth));
  const unchanged = isSameDay(selected, currentDay);
  const selectedPast = isBefore(selected, today);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${keyOf(focusDay)}"]`)
      ?.focus();
  }, [focusDay, viewMonth]);

  function select(day: Date) {
    setSelected(day);
    setFocusDay(day);
    if (!isSameMonth(day, viewMonth)) setViewMonth(startOfMonth(day));
    setError(null);
  }

  function moveFocus(next: Date) {
    const clamped = isBefore(next, today) ? today : next;
    pendingFocus.current = true;
    setFocusDay(clamped);
    if (!isSameMonth(clamped, viewMonth)) setViewMonth(startOfMonth(clamped));
  }

  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    let next: Date;
    switch (e.key) {
      case "ArrowLeft":
        next = addDays(anchor, -1);
        break;
      case "ArrowRight":
        next = addDays(anchor, 1);
        break;
      case "ArrowUp":
        next = addDays(anchor, -7);
        break;
      case "ArrowDown":
        next = addDays(anchor, 7);
        break;
      case "Home":
        next = startOfWeek(anchor, WEEK);
        break;
      case "End":
        next = endOfWeek(anchor, WEEK);
        break;
      case "PageUp":
        next = addMonths(anchor, e.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        next = addMonths(anchor, e.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    moveFocus(startOfDay(next));
  }

  async function handleSave() {
    if (saving || unchanged) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(selected);
      onOpenChange(false);
    } catch {
      setError("Не удалось сохранить дату. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }

  const relative = describeRelativeDay(selected, today);

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          // Фокус сразу на выбранный день — удобно для клавиатуры.
          e.preventDefault();
          requestAnimationFrame(() =>
            gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus()
          );
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Следующее касание
          </DialogTitle>
          <DialogDescription>
            {patientName
              ? `Когда напомнить о связи с пациентом: ${patientName}`
              : "Выберите дату, когда нужно снова связаться с пациентом"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 pb-5">
          {/* Итог выбора */}
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg",
                selectedPast ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary"
              )}
            >
              <span className="text-[10px] font-medium uppercase leading-none tracking-wide">
                {format(selected, "LLL", { locale: ru }).replace(".", "")}
              </span>
              <span className="mt-0.5 text-lg font-semibold leading-none tabular-nums">
                {format(selected, "d")}
              </span>
            </div>
            <div className="min-w-0">
              <div
                className="block truncate font-medium first-letter:uppercase"
                aria-live="polite"
              >
                {format(selected, "EEEE, d MMMM yyyy", { locale: ru })}
              </div>
              <div
                className={cn(
                  "text-xs",
                  selectedPast ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {relative}
              </div>
            </div>
          </div>

          {/* Быстрые пресеты */}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Быстрый выбор даты">
            {NEXT_TOUCH_PRESETS.map((p) => {
              const date = presetDate(p.days, today);
              const active = isSameDay(selected, date);
              return (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => select(date)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Календарь */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMonth(subMonths(viewMonth, 1))}
                disabled={!canGoPrev}
                aria-label="Предыдущий месяц"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-sm font-semibold capitalize" aria-live="polite">
                {format(viewMonth, "LLLL yyyy", { locale: ru })}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                aria-label="Следующий месяц"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-1" aria-hidden="true">
              {WEEKDAYS.map((d, i) => (
                <div
                  key={d}
                  className={cn(
                    "py-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                    i >= 5 && "text-muted-foreground/60"
                  )}
                >
                  {d}
                </div>
              ))}
            </div>

            <div
              ref={gridRef}
              role="group"
              aria-label={format(viewMonth, "LLLL yyyy", { locale: ru })}
              onKeyDown={handleGridKeyDown}
              className="grid grid-cols-7 gap-1"
            >
              {days.map((day) => {
                const key = keyOf(day);
                const past = isBefore(day, today);
                const isSelected = isSameDay(day, selected);
                const isToday = isSameDay(day, today);
                const inMonth = isSameMonth(day, viewMonth);
                return (
                  <button
                    key={key}
                    type="button"
                    data-day={key}
                    tabIndex={isSameDay(day, anchor) ? 0 : -1}
                    disabled={past}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={format(day, "EEEE, d MMMM yyyy", { locale: ru })}
                    onClick={() => select(day)}
                    onFocus={() => setFocusDay(day)}
                    className={cn(
                      "flex h-10 w-full items-center justify-center rounded-lg text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      !inMonth && "text-muted-foreground/50",
                      !past && !isSelected && "hover:bg-secondary",
                      isToday && !isSelected && "font-semibold text-primary ring-1 ring-inset ring-primary/40",
                      isSelected && !past && "bg-primary font-semibold text-primary-foreground shadow-sm",
                      isSelected && past && "bg-destructive/15 font-semibold text-destructive",
                      past && !isSelected && "cursor-not-allowed text-muted-foreground/25"
                    )}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Отмена
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || unchanged || selectedPast}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Сохраняю…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

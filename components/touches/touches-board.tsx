"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertCircle,
  BellOff,
  BellRing,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  MessageSquare,
  Sun,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { PhoneLink } from "@/components/leads/phone-link";
import { NextTouchDialog } from "@/components/leads/patient-card/next-touch-dialog";
import { WaitingBadge } from "@/components/leads/waiting-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NEXT_TOUCH_PRESETS, describeRelativeDay, presetDate, toNextTouchIso } from "@/lib/next-touch";
import { STAGE_STYLES, stageLabel } from "@/lib/status";
import { groupTouches, touchBucket, type TouchBucket } from "@/lib/touches";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Section {
  key: Exclude<TouchBucket, "later">;
  title: string;
  icon: LucideIcon;
  tone: "danger" | "primary" | "muted";
}

const SECTIONS: Section[] = [
  { key: "overdue", title: "Просрочено", icon: AlertCircle, tone: "danger" },
  { key: "today", title: "Сегодня", icon: Sun, tone: "primary" },
  { key: "tomorrow", title: "Завтра", icon: CalendarClock, tone: "muted" },
  { key: "week", title: "На этой неделе", icon: CalendarDays, tone: "muted" },
];

const TONE_STYLES: Record<Section["tone"], string> = {
  danger: "text-destructive",
  primary: "text-primary",
  muted: "text-muted-foreground",
};

type CloseKind = "noResponse" | "declined";
type PatchBody = Record<string, unknown>;

interface Toast {
  id: number;
  message: string;
  error?: boolean;
  undo?: () => void;
}

async function patchLead(leadId: string, body: PatchBody): Promise<void> {
  const res = await fetch(`/api/leads/${leadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("PATCH failed");
}

function closeBody(lead: Lead, kind: CloseKind): { apply: PatchBody; revert: PatchBody } {
  return kind === "noResponse"
    ? { apply: { noResponse: true }, revert: { noResponse: false } }
    : { apply: { stage: "declined" }, revert: { stage: lead.stage } };
}

function touchLabel(lead: Lead, now: Date): string {
  const bucket = touchBucket(lead.nextTouch, now);
  const date = new Date(lead.nextTouch);
  if (bucket === "overdue" || bucket === "today" || bucket === "tomorrow") {
    return describeRelativeDay(date, now);
  }
  return format(date, "EEE, d MMM", { locale: ru });
}

function leadsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "лид";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "лида";
  return "лидов";
}

export function TouchesBoard({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  const [pickerLead, setPickerLead] = useState<Lead | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  // «Сегодня» берём из браузера после монтирования: сервер живёт в UTC, и на
  // стыке суток группы расходились бы с тем, что видит координатор.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function showToast(next: Omit<Toast, "id">) {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), ...next });
    toastTimer.current = setTimeout(() => setToast(null), 8000);
  }

  /** Тост с кнопкой «Отменить»: откатывает все переданные изменения. */
  function offerUndo(message: string, reverts: { id: string; body: PatchBody }[]) {
    showToast({
      message,
      undo: async () => {
        const results = await Promise.allSettled(reverts.map((r) => patchLead(r.id, r.body)));
        router.refresh();
        showToast(
          results.some((r) => r.status === "rejected")
            ? { message: "Не всё удалось вернуть", error: true }
            : { message: "Возвращено как было" }
        );
      },
    });
  }

  /** Бросает при ошибке — диалог сам покажет её внутри себя. */
  async function commit(lead: Lead, date: Date) {
    await patchLead(lead.id, { nextTouch: toNextTouchIso(date) });
    router.refresh();
    offerUndo(`${lead.name}: касание ${format(date, "d MMMM", { locale: ru })}`, [
      { id: lead.id, body: { nextTouch: lead.nextTouch } },
    ]);
  }

  async function quickReschedule(lead: Lead, date: Date) {
    setBusyId(lead.id);
    try {
      await commit(lead, date);
    } catch {
      showToast({ message: "Не удалось перенести касание. Попробуйте ещё раз.", error: true });
    } finally {
      setBusyId(null);
    }
  }

  async function closeLead(lead: Lead, kind: CloseKind) {
    const { apply, revert } = closeBody(lead, kind);
    setBusyId(lead.id);
    try {
      await patchLead(lead.id, apply);
      router.refresh();
      offerUndo(
        kind === "noResponse"
          ? `${lead.name}: без ответа, убран из касаний`
          : `${lead.name}: отказ`,
        [{ id: lead.id, body: revert }]
      );
    } catch {
      showToast({ message: "Не удалось сохранить. Попробуйте ещё раз.", error: true });
    } finally {
      setBusyId(null);
    }
  }

  function exitSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSection(items: Lead[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = items.every((l) => next.has(l.id));
      for (const l of items) {
        if (all) next.delete(l.id);
        else next.add(l.id);
      }
      return next;
    });
  }

  async function bulkNoResponse() {
    const targets = leads.filter((l) => selected.has(l.id));
    if (targets.length === 0) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(
      targets.map((l) => patchLead(l.id, { noResponse: true }))
    );
    const done = targets.filter((_, i) => results[i].status === "fulfilled");
    const failed = targets.length - done.length;
    router.refresh();
    setBulkBusy(false);
    exitSelecting();
    if (done.length === 0) {
      showToast({ message: "Не удалось сохранить. Попробуйте ещё раз.", error: true });
      return;
    }
    offerUndo(
      `${done.length} ${leadsWord(done.length)}: без ответа, убраны из касаний` +
        (failed > 0 ? ` (не удалось: ${failed})` : ""),
      done.map((l) => ({ id: l.id, body: { noResponse: false } }))
    );
  }

  if (!now) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-5" aria-busy="true">
        <div className="mb-5 h-6 w-40 animate-pulse rounded bg-muted" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-2 h-20 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    );
  }

  const groups = groupTouches(leads, now);
  const needAttention = groups.overdue.length + groups.today.length;
  const later = groups.later;
  const hasAny = leads.length > 0;

  const rowProps = (lead: Lead, overdue: boolean) => ({
    lead,
    now,
    overdue,
    busy: busyId === lead.id,
    selecting,
    selected: selected.has(lead.id),
    onToggle: () => toggleOne(lead.id),
    onQuick: (date: Date) => quickReschedule(lead, date),
    onPick: () => setPickerLead(lead),
    onClose: (kind: CloseKind) => closeLead(lead, kind),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={cn("thin-scrollbar flex-1 overflow-y-auto", selecting && "pb-20")}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-5">
          <header className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <BellRing className="h-5 w-5 text-primary" />
                  Касания
                </h1>
                <p className="text-sm text-muted-foreground">
                  Кому написать или позвонить. Сначала те, кто ждёт ответа от нас.
                </p>
              </div>
              {hasAny && (
                <Button
                  type="button"
                  size="sm"
                  variant={selecting ? "secondary" : "outline"}
                  onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
                  className="shrink-0"
                >
                  {selecting ? "Готово" : "Выбрать"}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Просрочено" value={groups.overdue.length} tone="danger" />
              <Stat label="Сегодня" value={groups.today.length} tone="primary" />
              <Stat label="Завтра" value={groups.tomorrow.length} tone="muted" />
            </div>
          </header>

          {needAttention === 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-medium">Всё под контролем</p>
                <p className="text-xs text-muted-foreground">
                  На сегодня и раньше касаний не осталось.
                </p>
              </div>
            </div>
          )}

          {SECTIONS.map((section) => {
            const items = groups[section.key];
            if (items.length === 0) return null;
            const Icon = section.icon;
            const allSelected = items.every((l) => selected.has(l.id));
            return (
              <section key={section.key} aria-labelledby={`touches-${section.key}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2
                    id={`touches-${section.key}`}
                    className={cn(
                      "flex items-center gap-2 text-sm font-semibold",
                      TONE_STYLES[section.tone]
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {section.title}
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                      {items.length}
                    </span>
                  </h2>
                  {selecting && (
                    <button
                      type="button"
                      onClick={() => toggleSection(items)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {allSelected ? "Снять все" : "Выбрать все"}
                    </button>
                  )}
                </div>
                <ul className="flex flex-col gap-2">
                  {items.map((lead) => (
                    <TouchRow key={lead.id} {...rowProps(lead, section.key === "overdue")} />
                  ))}
                </ul>
              </section>
            );
          })}

          {later.length > 0 && (
            <details className="group rounded-lg border bg-card/50">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                Позже
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums">
                  {later.length}
                </span>
              </summary>
              <ul className="flex flex-col gap-2 p-3 pt-1">
                {later.map((lead) => (
                  <TouchRow key={lead.id} {...rowProps(lead, false)} />
                ))}
              </ul>
            </details>
          )}

          {!hasAny && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Активных лидов пока нет.
            </p>
          )}
        </div>
      </div>

      {pickerLead && (
        <NextTouchDialog
          open
          onOpenChange={(open) => !open && setPickerLead(null)}
          currentValue={pickerLead.nextTouch}
          patientName={pickerLead.name}
          onSave={(date) => commit(pickerLead, date)}
        />
      )}

      {selecting && (
        <div className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 shadow-lg animate-in fade-in-0 slide-in-from-bottom-2">
          <span className="text-sm tabular-nums" aria-live="polite">
            Выбрано: {selected.size}
          </span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={exitSelecting} disabled={bulkBusy}>
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={bulkNoResponse}
              disabled={selected.size === 0 || bulkBusy}
            >
              <BellOff className="h-3.5 w-3.5" />
              {bulkBusy ? "Сохраняю…" : "Нет ответа"}
            </Button>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg animate-in fade-in-0 slide-in-from-bottom-2",
            toast.error
              ? "border-destructive/40 bg-card text-destructive"
              : "border-border bg-card text-card-foreground"
          )}
        >
          <span className="min-w-0 truncate">{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                const undo = toast.undo;
                setToast(null);
                undo?.();
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Отменить
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: Section["tone"];
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div
        className={cn(
          "text-xl font-semibold leading-none tabular-nums",
          value > 0 ? TONE_STYLES[tone] : "text-muted-foreground"
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function TouchRow({
  lead,
  now,
  overdue,
  busy,
  selecting,
  selected,
  onToggle,
  onQuick,
  onPick,
  onClose,
}: {
  lead: Lead;
  now: Date;
  overdue: boolean;
  busy: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onQuick: (date: Date) => void;
  onPick: () => void;
  onClose: (kind: CloseKind) => void;
}) {
  return (
    <li
      onClick={selecting ? onToggle : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-3 transition-colors sm:flex-row sm:items-center sm:justify-between",
        overdue && "border-destructive/30",
        busy && "pointer-events-none opacity-60",
        selecting && "cursor-pointer select-none hover:bg-secondary/50",
        selecting && selected && "border-primary bg-primary/5"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {selecting && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Выбрать: ${lead.name}`}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {selecting ? (
              <span className="truncate font-medium">{lead.name}</span>
            ) : (
              <>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {lead.name}
                </Link>
                <PhoneLink phone={lead.phone} />
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                STAGE_STYLES[lead.stage]
              )}
            >
              {stageLabel(lead.stage)}
            </span>
            <WaitingBadge lead={lead} />
            {lead.diagnosis && (
              <span className="max-w-full truncate text-xs text-muted-foreground">
                {lead.diagnosis}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span
          className={cn(
            "text-xs font-medium",
            overdue ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {touchLabel(lead, now)}
        </span>
        {!selecting && (
          <div className="flex items-center gap-1.5">
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard/leads/${lead.id}`}>
                <MessageSquare className="h-3.5 w-3.5" />
                Открыть
              </Link>
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" disabled={busy}>
                  Перенести
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Следующее касание
                </DropdownMenuLabel>
                {NEXT_TOUCH_PRESETS.filter((p) => p.days > 0).map((p) => {
                  const date = presetDate(p.days, now);
                  return (
                    <DropdownMenuItem key={p.days} onSelect={() => onQuick(date)}>
                      <span>{p.label}</span>
                      <span className="ml-auto pl-3 text-xs text-muted-foreground">
                        {format(date, "EEE, d MMM", { locale: ru })}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuItem onSelect={onPick}>
                  <CalendarDays className="mr-2 h-4 w-4" />
                  Выбрать дату…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Больше не напоминать
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onClose("noResponse")}>
                  <BellOff className="mr-2 h-4 w-4" />
                  Нет ответа
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onClose("declined")}
                  className="text-destructive focus:text-destructive"
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Отказ
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </li>
  );
}

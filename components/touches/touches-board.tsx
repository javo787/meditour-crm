"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertCircle,
  BellRing,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  MessageSquare,
  Sun,
  Undo2,
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

interface Toast {
  id: number;
  message: string;
  error?: boolean;
  undo?: () => void;
}

async function patchNextTouch(leadId: string, iso: string): Promise<void> {
  const res = await fetch(`/api/leads/${leadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nextTouch: iso }),
  });
  if (!res.ok) throw new Error("PATCH failed");
}

function touchLabel(lead: Lead, now: Date): string {
  const bucket = touchBucket(lead.nextTouch, now);
  const date = new Date(lead.nextTouch);
  if (bucket === "overdue" || bucket === "today" || bucket === "tomorrow") {
    return describeRelativeDay(date, now);
  }
  return format(date, "EEE, d MMM", { locale: ru });
}

export function TouchesBoard({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  const [pickerLead, setPickerLead] = useState<Lead | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
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
    toastTimer.current = setTimeout(() => setToast(null), 7000);
  }

  /** Бросает при ошибке — диалог сам покажет её внутри себя. */
  async function commit(lead: Lead, date: Date) {
    const previous = lead.nextTouch;
    await patchNextTouch(lead.id, toNextTouchIso(date));
    router.refresh();
    showToast({
      message: `${lead.name}: касание ${format(date, "d MMMM", { locale: ru })}`,
      undo: async () => {
        try {
          await patchNextTouch(lead.id, previous);
          router.refresh();
          showToast({ message: "Возвращено как было" });
        } catch {
          showToast({ message: "Не удалось отменить", error: true });
        }
      },
    });
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="thin-scrollbar flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-5">
          <header className="flex flex-col gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <BellRing className="h-5 w-5 text-primary" />
                Касания
              </h1>
              <p className="text-sm text-muted-foreground">
                Кому написать или позвонить. Сначала те, кто ждёт ответа от нас.
              </p>
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
            return (
              <section key={section.key} aria-labelledby={`touches-${section.key}`}>
                <h2
                  id={`touches-${section.key}`}
                  className={cn(
                    "mb-2 flex items-center gap-2 text-sm font-semibold",
                    TONE_STYLES[section.tone]
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {section.title}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((lead) => (
                    <TouchRow
                      key={lead.id}
                      lead={lead}
                      now={now}
                      overdue={section.key === "overdue"}
                      busy={busyId === lead.id}
                      onQuick={(date) => quickReschedule(lead, date)}
                      onPick={() => setPickerLead(lead)}
                    />
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
                  <TouchRow
                    key={lead.id}
                    lead={lead}
                    now={now}
                    overdue={false}
                    busy={busyId === lead.id}
                    onQuick={(date) => quickReschedule(lead, date)}
                    onPick={() => setPickerLead(lead)}
                  />
                ))}
              </ul>
            </details>
          )}

          {leads.length === 0 && (
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
  onQuick,
  onPick,
}: {
  lead: Lead;
  now: Date;
  overdue: boolean;
  busy: boolean;
  onQuick: (date: Date) => void;
  onPick: () => void;
}) {
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-3 transition-opacity sm:flex-row sm:items-center sm:justify-between",
        overdue && "border-destructive/30",
        busy && "pointer-events-none opacity-60"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/dashboard/leads/${lead.id}`}
            className="truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {lead.name}
          </Link>
          <PhoneLink phone={lead.phone} />
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

      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span
          className={cn(
            "text-xs font-medium",
            overdue ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {touchLabel(lead, now)}
        </span>
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
            <DropdownMenuContent align="end" className="w-56">
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onPick}>
                <CalendarDays className="mr-2 h-4 w-4" />
                Выбрать дату…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

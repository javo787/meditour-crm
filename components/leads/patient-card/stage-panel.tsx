"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, isPast } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarDays } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toNextTouchIso } from "@/lib/next-touch";
import { STAGES } from "@/lib/status";
import { isActiveLead } from "@/lib/touches";
import type { Lead, Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

import { NextTouchDialog } from "./next-touch-dialog";

function MetaRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

export function StagePanel({ lead }: { lead: Lead }) {
  const [stage, setStage] = useState<Stage>(lead.stage);
  const [declinedReason, setDeclinedReason] = useState(lead.declinedReason ?? "");
  const [saving, setSaving] = useState(false);
  const [nextTouch, setNextTouch] = useState(lead.nextTouch);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noResponse, setNoResponse] = useState(Boolean(lead.noResponse));
  const router = useRouter();
  const nextTouchDate = new Date(nextTouch);
  const overdue = isActiveLead({ stage, noResponse }) && isPast(nextTouchDate);
  const sameYear = nextTouchDate.getFullYear() === new Date().getFullYear();

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleStageChange(value: string) {
    const next = value as Stage;
    setStage(next);
    await patch({ stage: next });
  }

  async function handleNextTouchSave(date: Date) {
    const iso = toNextTouchIso(date);
    const res = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nextTouch: iso }),
    });
    if (!res.ok) throw new Error("Не удалось сохранить дату");
    setNextTouch(iso);
    // Назначенная вручную дата возвращает лид в «Касания» (то же делает сервер).
    setNoResponse(false);
    // Канбан/таблица/KPI берут дату с сервера — обновляем их тоже.
    router.refresh();
  }

  async function toggleNoResponse() {
    const next = !noResponse;
    setNoResponse(next);
    await patch({ noResponse: next });
    router.refresh();
  }

  async function handleReasonBlur() {
    if (declinedReason !== (lead.declinedReason ?? "")) {
      await patch({ declinedReason });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Этап воронки</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Select value={stage} onValueChange={handleStageChange} disabled={saving}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {stage === "declined" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="declined-reason" className="text-xs text-muted-foreground">
              Причина отказа
            </Label>
            <Input
              id="declined-reason"
              value={declinedReason}
              onChange={(e) => setDeclinedReason(e.target.value)}
              onBlur={handleReasonBlur}
              placeholder="Например: дорого, выбрали другую клинику…"
            />
          </div>
        )}

        <Separator />

        <MetaRow label="Ответственный" value={lead.assignee} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Следующее касание</span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Изменить дату следующего касания"
            className="group -mr-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={cn("font-medium", overdue && "text-destructive")}>
              {format(nextTouchDate, sameYear ? "d MMMM" : "d MMMM yyyy", { locale: ru })}
            </span>
            <CalendarDays
              className={cn(
                "h-3.5 w-3.5 transition-colors group-hover:text-foreground",
                overdue ? "text-destructive" : "text-muted-foreground"
              )}
            />
          </button>
        </div>
        {stage !== "won" && stage !== "declined" && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="shrink-0 text-muted-foreground">Касания</span>
            <button
              type="button"
              onClick={toggleNoResponse}
              disabled={saving}
              className={cn(
                "-mr-1.5 rounded-md px-1.5 py-0.5 text-right transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                noResponse ? "font-medium text-muted-foreground" : "text-muted-foreground"
              )}
            >
              {noResponse ? "Без ответа · вернуть в касания" : "Нет ответа — убрать из касаний"}
            </button>
          </div>
        )}
        <MetaRow label="Источник" value={lead.source} />
        <MetaRow label="Пост/реклама" value={lead.campaign} />
        <MetaRow label="Город, страна" value={lead.homeLocation} />
      </CardContent>

      <NextTouchDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentValue={nextTouch}
        patientName={lead.name}
        onSave={handleNextTouchSave}
      />
    </Card>
  );
}

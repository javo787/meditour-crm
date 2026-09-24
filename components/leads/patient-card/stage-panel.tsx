"use client";

import { useState } from "react";
import { format, isPast } from "date-fns";
import { ru } from "date-fns/locale";

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
import { STAGES } from "@/lib/status";
import type { Lead, Stage } from "@/lib/types";

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
  const overdue = isPast(new Date(lead.nextTouch));

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
          <span className={overdue ? "font-medium text-destructive" : "font-medium"}>
            {format(new Date(lead.nextTouch), "d MMMM", { locale: ru })}
          </span>
        </div>
        <MetaRow label="Источник" value={lead.source} />
        <MetaRow label="Пост/реклама" value={lead.campaign} />
        <MetaRow label="Город, страна" value={lead.homeLocation} />
      </CardContent>
    </Card>
  );
}

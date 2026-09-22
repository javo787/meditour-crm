"use client";

import { useState } from "react";
import { format, isPast } from "date-fns";
import { ru } from "date-fns/locale";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function StagePanel({ lead }: { lead: Lead }) {
  const [stage, setStage] = useState<Stage>(lead.stage);
  const [saving, setSaving] = useState(false);
  const overdue = isPast(new Date(lead.nextTouch));

  async function handleChange(value: string) {
    const next = value as Stage;
    setStage(next);
    setSaving(true);
    try {
      await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: next }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Этап воронки</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Select value={stage} onValueChange={handleChange} disabled={saving}>
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
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Ответственный</span>
          <span className="font-medium">{lead.assignee}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Следующее касание</span>
          <span className={overdue ? "font-medium text-destructive" : "font-medium"}>
            {format(new Date(lead.nextTouch), "d MMMM", { locale: ru })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

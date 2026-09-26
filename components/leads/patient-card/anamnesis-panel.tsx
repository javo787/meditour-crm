"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead } from "@/lib/types";

export function AnamnesisPanel({ lead: initialLead }: { lead: Lead }) {
  const [lead, setLead] = useState(initialLead);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = lead.anamnesis;

  async function handleRefresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/anamnesis`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.lead) {
        setLead(data.lead);
      } else {
        setError(data?.error || "Не удалось обновить анамнез");
      }
    } catch {
      setError("Не удалось обновить анамнез — проверьте соединение");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Анамнез</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={busy}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Обновляем…" : "Обновить из переписки"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!a ? (
          <p className="text-muted-foreground">
            Ещё не собран — нажмите «Обновить из переписки», чтобы собрать данные из чата с пациентом
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Возраст</p>
                <p className="font-medium">{a.age ?? "—"}</p>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className="text-xs text-muted-foreground">Диагноз</p>
                <p className="font-medium">{lead.diagnosis}</p>
              </div>
              {lead.hospital && (
                <div>
                  <p className="text-xs text-muted-foreground">Клиника</p>
                  <p className="font-medium">{lead.hospital}</p>
                </div>
              )}
            </div>
            {a.proceduresDone && a.proceduresDone.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Проведено</p>
                <div className="flex flex-wrap gap-1.5">
                  {a.proceduresDone.map((p) => (
                    <span
                      key={p}
                      className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {a.summary && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Сводка от ИИ</p>
                <p className="leading-relaxed">{a.summary}</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

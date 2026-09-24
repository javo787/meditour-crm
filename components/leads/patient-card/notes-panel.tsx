"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

// Свободные заметки координатора — в реальной таблице (Meditur-Учёт_лидов.xlsx)
// это было единственное место для важного контекста уровня «ждёт ответа от
// брата» или «в семье уже 6 человек с циррозом» — то, что не влезает ни в
// один структурированный столбец.
export function NotesPanel({
  leadId,
  initialNotes,
}: {
  leadId: string;
  initialNotes?: string;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saved, setSaved] = useState(true);

  async function handleBlur() {
    if (saved) return;
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setSaved(true);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Заметки координатора</CardTitle>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3 w-3" />
            сохранено
          </span>
        )}
      </CardHeader>
      <CardContent>
        <Textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
          onBlur={handleBlur}
          placeholder="Например: ждёт ответа от родственника, обсудят в семье в октябре…"
          rows={4}
          className="text-sm"
        />
      </CardContent>
    </Card>
  );
}

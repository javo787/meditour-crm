"use client";

import { useState, type FormEvent } from "react";
import { Check, Copy, FileText, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CaseAssistantMessage } from "@/lib/types";

export function CaseAssistantPanel({
  leadId,
  initialMessages,
}: {
  leadId: string;
  initialMessages: CaseAssistantMessage[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/case-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (data?.messages) {
        setMessages((prev) => [...prev, ...data.messages]);
      }
      if (res.ok) {
        setDraft("");
      } else {
        setSendError(data?.error || "Не удалось сгенерировать документ");
      }
    } catch {
      setSendError("Не удалось отправить запрос — проверьте соединение");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Medical Opinion Request
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {messages.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            Уже вижу переписку с пациентом в WhatsApp и учту всё, что там
            написано текстом. Фото и голосовые из этого чата не вижу — они
            нигде не сохраняются, — так что если там пересылали документы
            или выписки, вставьте их текст сюда сами. Если в готовом
            запросе что-то не так, напишите здесь, что поправить, и пришлю
            новую версию.
          </p>
        ) : (
          <ScrollArea className="thin-scrollbar h-96 rounded-md border border-border bg-secondary/30 p-3">
            <div className="flex flex-col gap-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-1",
                    m.role === "user" ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[95%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card font-mono"
                    )}
                  >
                    {m.text}
                  </div>
                  <span className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                    {m.role === "assistant" && (
                      <button
                        type="button"
                        onClick={() => handleCopy(m.id, m.text)}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        {copiedId === m.id ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedId === m.id ? "Скопировано" : "Скопировать"}
                      </button>
                    )}
                    {format(new Date(m.at), "d MMM, HH:mm", { locale: ru })}
                  </span>
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  Формируем документ…
                </div>
              )}
            </div>
          </ScrollArea>
        )}
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Вставьте документы или уточнение…"
            className="min-h-[44px] flex-1 resize-none text-xs"
            rows={3}
          />
          <Button type="submit" size="icon" disabled={busy || !draft.trim()}>
            <Sparkles className="h-4 w-4" />
          </Button>
        </form>
        {sendError && <p className="text-xs text-destructive">{sendError}</p>}
      </CardContent>
    </Card>
  );
}

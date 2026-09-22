"use client";

import { useState, type FormEvent } from "react";
import { Bot, Send, User } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

export function ChatPanel({
  leadId,
  initialMessages,
  initialAiPaused,
}: {
  leadId: string;
  initialMessages: ChatMessage[];
  initialAiPaused: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [aiPaused, setAiPaused] = useState(initialAiPaused);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggleAi() {
    const next = !aiPaused;
    setAiPaused(next);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiPaused: next }),
      });
      if (res.ok) {
        const msgRes = await fetch(`/api/leads/${leadId}/messages`);
        if (msgRes.ok) {
          const data = await msgRes.json();
          setMessages(data.messages);
        }
      }
    } catch {
      setAiPaused(!next);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setDraft("");
    try {
      const res = await fetch(`/api/leads/${leadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-1 flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Переписка</CardTitle>
        <Button
          type="button"
          variant={aiPaused ? "outline" : "secondary"}
          size="sm"
          onClick={toggleAi}
          className="gap-1.5"
        >
          <Bot className="h-3.5 w-3.5" />
          {aiPaused ? "Возобновить ИИ" : "Остановить ИИ"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <ScrollArea className="thin-scrollbar h-72 rounded-md border border-border bg-secondary/30 p-3">
          <div className="flex flex-col gap-2.5">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex flex-col gap-0.5",
                  m.from === "patient" ? "items-start" : "items-end"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    m.from === "patient" && "bg-card",
                    m.from === "ai" && "bg-primary/10",
                    m.from === "coordinator" && "bg-primary text-primary-foreground"
                  )}
                >
                  {m.text}
                </div>
                <span className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                  {m.from === "ai" && <Bot className="h-3 w-3" />}
                  {m.from === "coordinator" && <User className="h-3 w-3" />}
                  {format(new Date(m.at), "d MMM, HH:mm", { locale: ru })}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={aiPaused ? "Сообщение от координатора…" : "ИИ ведёт диалог — можно вмешаться…"}
            className="min-h-[44px] flex-1 resize-none"
            rows={1}
          />
          <Button type="submit" size="icon" disabled={busy || !draft.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

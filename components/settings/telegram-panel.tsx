"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";

type Outcome =
  | { kind: "sent"; sampleName: string | null }
  | { kind: "not-configured" }
  | { kind: "failed"; error: string }
  | { kind: "network" };

// Подсказки по самым частым ошибкам Telegram.
function hintFor(error: string): string {
  if (/chat not found|can't initiate|bot was blocked/i.test(error)) {
    return "Откройте бота в Telegram и нажмите Start, затем проверьте TELEGRAM_CHAT_ID.";
  }
  if (/unauthorized|not found/i.test(error)) return "Проверьте TELEGRAM_BOT_TOKEN.";
  return "";
}

export function TelegramPanel() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function sendTest() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/settings/telegram-test", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) setOutcome({ kind: "network" });
      else if (data.configured === false) setOutcome({ kind: "not-configured" });
      else if (data.ok) setOutcome({ kind: "sent", sampleName: data.sampleName ?? null });
      else setOutcome({ kind: "failed", error: String(data.error ?? "неизвестная ошибка") });
    } catch {
      setOutcome({ kind: "network" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      icon={Send}
      title="Уведомления в Telegram"
      description="Бот пишет, когда ИИ передал диалог координатору или лид давно без ответа. В сообщении есть кнопка «Перейти в WhatsApp» — она открывает чат этого лида."
      action={
        <Button size="sm" variant="outline" disabled={busy} onClick={sendTest}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
          Отправить тест
        </Button>
      }
    >
      {outcome === null && (
        <p className="text-sm text-muted-foreground">
          Нажмите «Отправить тест»: в Telegram придёт сообщение с кнопкой, которая ведёт в WhatsApp-чат самого свежего лида.
        </p>
      )}
      {outcome?.kind === "sent" && (
        <p className="text-sm">
          Отправлено. Проверьте Telegram
          {outcome.sampleName ? `: кнопка «Перейти в WhatsApp» должна открыть чат с «${outcome.sampleName}».` : "."}
        </p>
      )}
      {outcome?.kind === "not-configured" && (
        <div className="flex flex-col gap-1 text-sm">
          <p>Бот ещё не настроен. Добавьте на Render в Environment две переменные и перезапустите сервис:</p>
          <p className="font-mono text-xs">TELEGRAM_BOT_TOKEN — токен от @BotFather</p>
          <p className="font-mono text-xs">TELEGRAM_CHAT_ID — ваш числовой ID (несколько — через запятую)</p>
        </div>
      )}
      {outcome?.kind === "failed" && (
        <p className="text-sm text-destructive">
          Telegram не принял сообщение: {outcome.error}. {hintFor(outcome.error)}
        </p>
      )}
      {outcome?.kind === "network" && (
        <p className="text-sm text-destructive">Не удалось связаться с сервером. Попробуйте ещё раз.</p>
      )}
    </SettingsCard>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StatusResponse {
  ai: boolean;
  whatsapp: boolean;
  lastInboundAt: string | null;
  failedDeliveries24h: number;
  lastWebhookAt: string | null;
  checkedAt: string;
}

/** Сколько часов без сигналов от WhatsApp считается «давно». */
const STALE_AFTER_HOURS = 3;

function ago(iso: string | null, empty: string): string {
  return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ru }) : empty;
}

function evaluate(status: StatusResponse) {
  const hours = status.lastWebhookAt
    ? (Date.now() - new Date(status.lastWebhookAt).getTime()) / 3_600_000
    : null;
  const signalStale = hours === null || hours > STALE_AFTER_HOURS;

  const issues: string[] = [];
  if (!status.ai) issues.push("ИИ-ассистент не отвечает");
  if (!status.whatsapp) issues.push("WhatsApp не подключён");
  if (status.failedDeliveries24h > 0) {
    issues.push(`Недоставленных ответов за сутки: ${status.failedDeliveries24h}`);
  }
  // Канал «подключён», но сигналов давно нет — самая коварная ситуация:
  // всё зелёное, а сообщения пациентов до CRM не доходят.
  if (signalStale && status.ai && status.whatsapp) {
    issues.push("От WhatsApp давно нет сигналов — новые сообщения могут не доходить до CRM");
  }
  return { issues, signalStale };
}

function ServiceRow({
  label,
  hint,
  online,
}: {
  label: string;
  hint?: string;
  online: boolean | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {online === null ? (
        <span className="h-5 w-20 animate-pulse rounded bg-muted" aria-label="Проверяем…" />
      ) : (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 text-sm font-medium",
            online ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
          )}
        >
          <span
            className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-500" : "bg-destructive")}
            aria-hidden="true"
          />
          {online ? "Работает" : "Не работает"}
        </span>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "ok";
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "ok" && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function PlatformStatusPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/settings/status");
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (data) setStatus(data);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const result = status ? evaluate(status) : null;

  return (
    <SettingsCard
      icon={Activity}
      title="Состояние системы"
      description="Всё ли в порядке с приёмом и отправкой сообщений"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={check}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Проверить
        </Button>
      }
    >
      {result && status && (
        <div
          role="status"
          className={cn(
            "flex items-start gap-3 rounded-lg border p-4",
            result.issues.length === 0
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-destructive/30 bg-destructive/10"
          )}
        >
          {result.issues.length === 0 ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {result.issues.length === 0 ? "Все системы работают" : "Требует внимания"}
            </p>
            {result.issues.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Проверено в {new Date(status.checkedAt).toLocaleTimeString("ru-RU")}
              </p>
            ) : (
              <>
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  {result.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Если не проходит само — сообщите администратору платформы.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Не удалось выполнить проверку. Проверьте соединение и нажмите «Проверить».
        </p>
      )}

      <div className="flex flex-col gap-2">
        <ServiceRow label="ИИ-ассистент" online={status ? status.ai : null} />
        <ServiceRow
          label="WhatsApp"
          hint="Канал подключён. Доходят ли сообщения, видно ниже."
          online={status ? status.whatsapp : null}
        />
      </div>

      {status && result && (
        <div className="flex flex-col gap-2.5 border-t pt-4">
          <DetailRow
            label="Последний сигнал от WhatsApp"
            value={ago(status.lastWebhookAt, "никогда")}
            tone={result.signalStale ? "danger" : "ok"}
          />
          <DetailRow
            label="Последнее сообщение от пациента"
            value={ago(status.lastInboundAt, "ещё не было")}
          />
          <DetailRow
            label="Недоставленных ответов за 24 ч"
            value={String(status.failedDeliveries24h)}
            tone={status.failedDeliveries24h > 0 ? "danger" : undefined}
          />
        </div>
      )}
    </SettingsCard>
  );
}

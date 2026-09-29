"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatusResponse {
  ai: boolean;
  whatsapp: boolean;
  lastInboundAt: string | null;
  failedDeliveries24h: number;
  lastWebhookAt: string | null;
  checkedAt: string;
}

function StatusRow({ label, online }: { label: string; online: boolean | null }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
      <span className="text-sm font-medium">{label}</span>
      {online === null ? (
        <span className="text-xs text-muted-foreground">Проверяем…</span>
      ) : online ? (
        <span className="flex items-center gap-1.5 text-sm text-emerald-600">
          <CheckCircle2 className="h-4 w-4" />
          Работает
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-sm text-destructive">
          <XCircle className="h-4 w-4" />
          Не работает
        </span>
      )}
    </div>
  );
}

export function PlatformStatusPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/status");
      const data = await res.json().catch(() => null);
      if (data) setStatus(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Статус платформы</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={check}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Проверить
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {status &&
          (() => {
            const hoursSinceWebhook = status.lastWebhookAt
              ? (Date.now() - new Date(status.lastWebhookAt).getTime()) / 3_600_000
              : null;
            const stale = hoursSinceWebhook === null || hoursSinceWebhook > 3;
            return (
              <div className="rounded-md border border-border px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Evolution вызывал наш вебхук</span>
                  <span className={`text-sm font-medium ${stale ? "text-destructive" : "text-emerald-600"}`}>
                    {status.lastWebhookAt
                      ? formatDistanceToNow(new Date(status.lastWebhookAt), { addSuffix: true, locale: ru })
                      : "никогда"}
                  </span>
                </div>
                {stale && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Если это давно, а WhatsApp и ИИ ниже показывают «Работает» — проблема не в CRM: WhatsApp
                    просто не передаёт новые сообщения в шлюз. Это чинится на стороне шлюза/сессии, не здесь.
                  </p>
                )}
              </div>
            );
          })()}
        <StatusRow label="ИИ-ассистент" online={status ? status.ai : null} />
        <StatusRow label="WhatsApp" online={status ? status.whatsapp : null} />
        {status && (
          <>
            <p className="px-1 text-xs text-muted-foreground">
              «WhatsApp: Работает» означает только, что канал не отключён — не то, что сообщения
              реально доходят до пациентов. Смотрите строки выше и ниже.
            </p>
            <div className="flex items-center justify-between px-1 text-xs">
              <span className="text-muted-foreground">Последнее сообщение от пациента</span>
              <span className="font-medium">
                {status.lastInboundAt
                  ? formatDistanceToNow(new Date(status.lastInboundAt), { addSuffix: true, locale: ru })
                  : "ещё не было"}
              </span>
            </div>
            <div className="flex items-center justify-between px-1 text-xs">
              <span className="text-muted-foreground">Недоставленных ответов за 24ч</span>
              <span className={`font-medium ${status.failedDeliveries24h > 0 ? "text-destructive" : ""}`}>
                {status.failedDeliveries24h}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Обновлено: {new Date(status.checkedAt).toLocaleTimeString("ru-RU")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

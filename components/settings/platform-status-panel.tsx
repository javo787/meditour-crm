"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatusResponse {
  ai: boolean;
  whatsapp: boolean;
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
        <StatusRow label="ИИ-ассистент" online={status ? status.ai : null} />
        <StatusRow label="WhatsApp" online={status ? status.whatsapp : null} />
        {status && (
          <p className="mt-1 text-xs text-muted-foreground">
            Обновлено: {new Date(status.checkedAt).toLocaleTimeString("ru-RU")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

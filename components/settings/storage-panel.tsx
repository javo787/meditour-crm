"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StorageStats {
  totalBytes: number;
  collections: Array<{ name: string; sizeBytes: number; count: number }>;
}

const LABELS: Record<string, string> = {
  Leads: "Лиды",
  Messages: "Переписка",
  MediaAssets: "Фото и голосовые",
  CaseAssistantMessages: "Medical Opinion Request",
};

// Тариф MongoDB Atlas M0 (бесплатный) — 512 МБ. Если тариф другой, поменяйте
// только эту константу.
const MONGO_LIMIT_BYTES = 512 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function StoragePanel() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState("30");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/storage");
      const data = await res.json().catch(() => null);
      if (data) setStats(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCleanup() {
    const days = threshold === "0" ? undefined : Number(threshold);
    const confirmText = days
      ? `Удалить фото и голосовые старше ${days} дней? Текст переписки останется, отменить нельзя.`
      : "Удалить ВСЕ фото и голосовые из базы? Текст переписки останется, отменить нельзя.";
    if (!window.confirm(confirmText)) return;

    setCleaning(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(days ? { olderThanDays: days } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Не удалось удалить");
        return;
      }
      await load();
    } catch {
      setError("Не удалось удалить — проверьте соединение");
    } finally {
      setCleaning(false);
    }
  }

  const mediaStats = stats?.collections.find((c) => c.name === "MediaAssets");
  const usedPct = stats ? Math.min(100, (stats.totalBytes / MONGO_LIMIT_BYTES) * 100) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Хранилище</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {stats ? (
          <>
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>{formatSize(stats.totalBytes)} из 512 МБ</span>
                <span className="text-muted-foreground">{usedPct.toFixed(0)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full ${usedPct > 85 ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {stats.collections.map((c) => (
                <div key={c.name} className="flex items-center justify-between text-sm">
                  <span>{LABELS[c.name] ?? c.name}</span>
                  <span className="text-muted-foreground">
                    {formatSize(c.sizeBytes)} · {c.count}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Загрузка…</p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Select value={threshold} onValueChange={setThreshold}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">старше 7 дней</SelectItem>
              <SelectItem value="30">старше 30 дней</SelectItem>
              <SelectItem value="90">старше 90 дней</SelectItem>
              <SelectItem value="0">всё медиа</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={cleaning || !mediaStats?.count}
            className="gap-1.5"
            onClick={handleCleanup}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {cleaning ? "Удаляем…" : "Удалить"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Удаляются только сами файлы фото/голосовых — текст переписки и пометка «(+фото)» остаются.
        </p>
      </CardContent>
    </Card>
  );
}

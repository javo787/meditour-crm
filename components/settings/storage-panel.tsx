"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDrive, RefreshCw, Trash2 } from "lucide-react";

import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

// Лимит места по тарифу, МБ. Если тариф изменится — поменяйте только это число.
const STORAGE_LIMIT_MB = 500;
const STORAGE_LIMIT_BYTES = STORAGE_LIMIT_MB * 1024 * 1024;

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
      : "Удалить ВСЕ фото и голосовые? Текст переписки останется, отменить нельзя.";
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
  const usedPct = stats ? Math.min(100, (stats.totalBytes / STORAGE_LIMIT_BYTES) * 100) : 0;
  const freeBytes = stats ? Math.max(0, STORAGE_LIMIT_BYTES - stats.totalBytes) : 0;
  const barTone = usedPct > 85 ? "bg-destructive" : usedPct > 70 ? "bg-amber-500" : "bg-primary";

  return (
    <SettingsCard
      icon={HardDrive}
      title="Хранилище"
      description="Сколько места занимают данные CRM"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Обновить
        </Button>
      }
    >
      {stats ? (
        <>
          <div>
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <span className="text-2xl font-semibold tabular-nums">
                  {formatSize(stats.totalBytes)}
                </span>
                <span className="ml-1.5 text-sm text-muted-foreground">
                  из {STORAGE_LIMIT_MB} МБ
                </span>
              </div>
              <span className="text-sm font-medium tabular-nums text-muted-foreground">
                {usedPct < 1 && stats.totalBytes > 0 ? "<1" : usedPct.toFixed(0)}%
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(usedPct)}
              aria-label="Занято места"
            >
              <div
                className={cn("h-full rounded-full transition-all", barTone)}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Свободно: {formatSize(freeBytes)}
            </p>
          </div>

          <div className="flex flex-col gap-2.5 border-t pt-4">
            {stats.collections.map((c) => (
              <div key={c.name} className="flex items-center justify-between gap-3 text-sm">
                <span>{LABELS[c.name] ?? c.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatSize(c.sizeBytes)} · {c.count}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="h-8 w-40 animate-pulse rounded bg-muted" />
          <div className="h-2 w-full animate-pulse rounded-full bg-muted" />
        </div>
      )}

      <div className="flex flex-col gap-2 border-t pt-4">
        <div>
          <p className="text-sm font-medium">Освободить место</p>
          <p className="text-xs text-muted-foreground">
            Удаляются только сами файлы фото и голосовых. Текст переписки и пометка «(+фото)»
            остаются.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={threshold} onValueChange={setThreshold}>
            <SelectTrigger className="w-44" aria-label="Какие файлы удалить">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">старше 7 дней</SelectItem>
              <SelectItem value="30">старше 30 дней</SelectItem>
              <SelectItem value="90">старше 90 дней</SelectItem>
              <SelectItem value="0">все файлы</SelectItem>
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
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

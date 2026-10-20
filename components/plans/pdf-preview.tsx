"use client";

import { cn } from "@/lib/utils";

export interface PdfPreviewProps {
  planId: string;
  version: number; // адрес содержит версию: после каждого успешного сохранения iframe перезагружается
  hasContent: boolean; // без содержимого PDF не собрать — показываем заглушку
  className?: string;
}

// Предпросмотр PDF справа от редактора. PDF собирается на сервере при каждом открытии и нигде не сохраняется.
export function PdfPreview({ planId, version, hasContent, className }: PdfPreviewProps) {
  if (!hasContent) {
    return (
      <div
        className={cn(
          "flex min-h-[240px] items-center justify-center rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        Предпросмотр появится после разбора письма или ручного заполнения плана
      </div>
    );
  }
  return (
    <iframe
      src={`/api/plans/${encodeURIComponent(planId)}/pdf?v=${version}`}
      title="Предпросмотр PDF"
      className={cn("h-[70vh] min-h-[420px] w-full rounded-md border border-border bg-card", className)}
    />
  );
}

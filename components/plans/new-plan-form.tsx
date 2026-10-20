"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canSubmitPlan, isDocxName, sourceCounter } from "@/lib/plans/ui";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEAD_SEARCH_DELAY_MS = 300;
const LEAD_RESULTS_LIMIT = 8;

// Форма нового плана: письмо текстом или файл .docx, необязательная привязка к пациенту CRM.
// Отправка — POST /api/plans: JSON { sourceText, leadId? } или multipart (file, leadId?). Текст письма не логируется.
export function NewPlanForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<Lead[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counter = sourceCounter(text.length);
  const canSubmit = canSubmitPlan({ text, hasFile: file !== null, busy: submitting });
  // Результаты показываются только для непустого запроса (без setState в эффекте).
  const shownResults = leadQuery.trim() ? leadResults : [];

  // Поиск пациента: через 300 мс после последнего символа; ответ на устаревший запрос отбрасывается.
  useEffect(() => {
    const q = leadQuery.trim();
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/leads?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { leads: [] }))
        .then((data: { leads?: Lead[] }) => setLeadResults((data.leads ?? []).slice(0, LEAD_RESULTS_LIMIT)))
        .catch(() => {
          if (!controller.signal.aborted) setLeadResults([]);
        });
    }, LEAD_SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [leadQuery]);

  function pickFile(picked: File | undefined) {
    if (!picked) return;
    if (!isDocxName(picked.name)) {
      setError("Нужен файл в формате .docx");
      return;
    }
    setError(null);
    setFile(picked);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    let res: Response;
    try {
      res = file
        ? await fetch("/api/plans", { method: "POST", body: buildFormData(file, lead?.id) })
        : await fetch("/api/plans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceText: text, leadId: lead?.id }),
          });
    } catch {
      setSubmitting(false);
      setError("Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.");
      return;
    }
    const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res.ok || !data?.id) {
      setSubmitting(false);
      setError(data?.error ?? "Не удалось создать план. Попробуйте ещё раз.");
      return;
    }
    // После успеха кнопка остаётся заблокированной до перехода на страницу плана.
    router.push(`/dashboard/plans/${data.id}`);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="space-y-1.5">
        <Label htmlFor="plan-source">Текст письма</Label>
        <Textarea
          id="plan-source"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={file !== null || submitting}
          placeholder="Вставьте письмо целиком"
          className="min-h-[16rem]"
        />
        <p className={cn("text-xs", counter.over ? "font-medium text-destructive" : "text-muted-foreground")}>
          {counter.label}
          {counter.over ? " · сократите письмо или разделите его на части" : ""}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Или файл .docx</p>
        <div
          onDragOver={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            if (!submitting) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragOver(false);
            if (!submitting) pickFile(e.dataTransfer.files[0]);
          }}
          className={cn(
            "flex flex-col gap-2 rounded-md border border-dashed border-border p-4 sm:flex-row sm:items-center sm:justify-between",
            dragOver && "border-primary bg-secondary",
          )}
        >
          <span className={cn("truncate text-sm", !file && "text-muted-foreground")}>
            {file ? file.name : "Перетащите сюда файл .docx или выберите его"}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
              disabled={submitting}
            >
              <FileUp className="h-4 w-4" />
              Выбрать .docx
            </Button>
            {file ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setFile(null)} disabled={submitting}>
                Убрать файл
              </Button>
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="plan-lead">Пациент в CRM (необязательно)</Label>
        {lead ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <span>
              {lead.name} · {lead.phone}
            </span>
            <Button type="button" variant="ghost" size="icon" aria-label="Убрать пациента" onClick={() => setLead(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="plan-lead"
                className="pl-8"
                placeholder="Имя или телефон"
                value={leadQuery}
                onChange={(e) => setLeadQuery(e.target.value)}
                disabled={submitting}
              />
            </div>
            {shownResults.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {shownResults.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-secondary"
                      onClick={() => {
                        setLead(item);
                        setLeadQuery("");
                      }}
                    >
                      {item.name} · {item.phone}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" onClick={submit} disabled={!canSubmit}>
          {submitting ? "Отправляем…" : "Сформировать"}
        </Button>
      </div>
    </div>
  );
}

function buildFormData(picked: File, leadId?: string): FormData {
  const body = new FormData();
  body.append("file", picked);
  if (leadId) body.append("leadId", leadId);
  return body;
}

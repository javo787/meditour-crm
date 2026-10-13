"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Images,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { languageName, looksLikeRealName, transliterate } from "@/lib/documents";
import type { DocumentCategory, DocumentStatus, PatientDocument } from "@/lib/types";

const STATUS_LABEL: Record<DocumentStatus, string> = {
  new: "не разобран",
  pending: "в очереди",
  processing: "читаю…",
  done: "готово",
  failed: "ошибка",
};

const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  report: "Документ (с переводом)",
  imaging: "Снимок (без перевода)",
  other: "Прочее",
};

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Фото с телефона — 4000×3000 и 5+ МБ. Для чтения документа хватает ~2200 px:
// загрузка по мобильному интернету быстрее, а модель получает меньше пикселей.
async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || /heic|heif/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = Math.max(bitmap.width, bitmap.height);
    if (maxSide <= 2200 && file.size <= 1_500_000) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, 2200 / maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function DocumentsPanel({
  leadId,
  leadName,
  initialDocuments,
}: {
  leadId: string;
  leadName: string;
  initialDocuments: PatientDocument[];
}) {
  const [docs, setDocs] = useState(initialDocuments);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(looksLikeRealName(leadName) ? transliterate(leadName) : "");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<"" | "Male" | "Female">("");
  const fileInput = useRef<HTMLInputElement>(null);

  const inProgress = docs.some((d) => d.status === "pending" || d.status === "processing");
  const included = docs.filter((d) => d.status === "done" && d.include && d.category !== "other");
  const unreviewed = included.filter((d) => !d.reviewed).length;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}/documents`, { cache: "no-store" });
      if (res.ok) setDocs((await res.json()).documents);
    } catch {
      // Нет связи — оставляем то, что уже на экране; следующий опрос повторит.
    }
  }, [leadId]);

  // Пока что-то разбирается — обновляем список раз в 3 секунды. Разбор идёт
  // на сервере, страницу можно закрыть и вернуться позже.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [inProgress, refresh]);

  async function uploadFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setNotice(null);
    const problems: string[] = [];
    let added = 0;
    let duplicates = 0;

    for (let i = 0; i < files.length; i++) {
      setBusy(`Загружаю ${i + 1} из ${files.length}…`);
      try {
        const form = new FormData();
        form.append("files", await downscaleImage(files[i]));
        const res = await fetch(`/api/leads/${leadId}/documents`, { method: "POST", body: form });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          problems.push(`${files[i].name}: ${data?.error ?? "ошибка загрузки"}`);
          continue;
        }
        added += data.documents.length;
        duplicates += data.duplicates;
        for (const r of data.rejected ?? []) problems.push(`${r.name}: ${r.reason}`);
      } catch {
        problems.push(`${files[i].name}: нет связи с сервером`);
      }
    }

    setBusy(null);
    if (fileInput.current) fileInput.current.value = "";
    const parts = [`Добавлено: ${added}`];
    if (duplicates > 0) parts.push(`уже были: ${duplicates}`);
    setNotice([parts.join(", "), ...problems].join("\n"));
    await refresh();
  }

  async function importFromChat() {
    setBusy("Беру фото из переписки…");
    setNotice(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/documents/import-chat`, { method: "POST" });
      const data = await res.json().catch(() => null);
      setNotice(
        res.ok
          ? data.added > 0
            ? `Добавлено фото из переписки: ${data.added}. Сейчас они разбираются.`
            : "Новых фото в переписке нет."
          : data?.error ?? "Не удалось взять фото из переписки"
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function patchDoc(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/leads/${leadId}/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setNotice("Не удалось сохранить изменение");
      return;
    }
    const { document: updated } = await res.json();
    setDocs((prev) => prev.map((d) => (d.id === id ? updated : d)));
  }

  async function deleteDoc(id: string) {
    if (!window.confirm("Удалить документ вместе с переводом?")) return;
    const res = await fetch(`/api/leads/${leadId}/documents/${id}`, { method: "DELETE" });
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== id));
    else setNotice("Не удалось удалить документ");
  }

  async function downloadPdf(force = false): Promise<void> {
    setBusy("Собираю PDF…");
    setNotice(null);
    try {
      const qs = new URLSearchParams();
      if (name.trim()) qs.set("name", name.trim());
      if (dob.trim()) qs.set("dob", dob.trim());
      if (gender) qs.set("gender", gender);
      if (force) qs.set("force", "1");
      const res = await fetch(`/api/leads/${leadId}/dossier?${qs}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 409 && data?.code === "unreviewed") {
          setBusy(null);
          if (window.confirm(`${data.error}. Скачать PDF всё равно?`)) return downloadPdf(true);
          return;
        }
        setNotice(data?.error ?? "Не удалось собрать PDF");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `Dossier_${(name.trim() || "patient").replace(/[^A-Za-z0-9]+/g, "_")}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setNotice("Нет связи с сервером");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Документы пациента</CardTitle>
        <CardDescription>
          Фото и PDF → перевод на английский → один PDF для Medical Request. Снимки МРТ/КТ/рентген не переводятся.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => uploadFiles(e.target.files)}
          />
          <Button size="sm" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            Добавить файлы
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={importFromChat}>
            <Images className="mr-1.5 h-4 w-4" />
            Фото из переписки
          </Button>
        </div>
        {busy && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {busy}
          </p>
        )}
        {notice && <p className="whitespace-pre-line text-xs text-muted-foreground">{notice}</p>}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {docs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Пока пусто. Добавьте фото или PDF с телефона либо возьмите фото, которые пациент уже прислал в WhatsApp.
          </p>
        )}

        {docs.map((doc) => (
          <DocumentRow key={doc.id} doc={doc} leadId={leadId} onPatch={patchDoc} onDelete={deleteDoc} />
        ))}

        {docs.length > 0 && (
          <div className="mt-1 flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium">PDF-досье</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Имя латиницей (как в паспорте)
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahimov Izatullo" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Дата рождения (необязательно)
                <Input value={dob} onChange={(e) => setDob(e.target.value)} placeholder="19 Apr 1988" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Пол (необязательно)
                <select className={selectClass} value={gender} onChange={(e) => setGender(e.target.value as "" | "Male" | "Female")}>
                  <option value="">—</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={busy !== null || inProgress || included.length === 0} onClick={() => downloadPdf()}>
                <Download className="mr-1.5 h-4 w-4" />
                Скачать PDF
              </Button>
              <span className="text-xs text-muted-foreground">
                {inProgress
                  ? "Идёт разбор — PDF станет доступен после него."
                  : included.length === 0
                  ? "Нет готовых документов для PDF."
                  : `В PDF: ${included.length}${unreviewed > 0 ? ` · не проверено: ${unreviewed}` : " · всё проверено"}`}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentRow({
  doc,
  leadId,
  onPatch,
  onDelete,
}: {
  doc: PatientDocument;
  leadId: string;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(doc.title ?? "");
  const [date, setDate] = useState(doc.docDate ?? "");
  const [translation, setTranslation] = useState(doc.translationEn ?? "");

  // Когда разбор закончился и пришли поля — подтягиваем их в черновики.
  useEffect(() => setTitle(doc.title ?? ""), [doc.title]);
  useEffect(() => setDate(doc.docDate ?? ""), [doc.docDate]);
  useEffect(() => setTranslation(doc.translationEn ?? ""), [doc.translationEn]);

  const fileUrl = `/api/leads/${leadId}/documents/${doc.id}/file`;
  const isDone = doc.status === "done";
  const isImage = doc.mimeType.startsWith("image/") && !/heic|heif/.test(doc.mimeType);
  const busyStatus = doc.status === "pending" || doc.status === "processing";

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start gap-3">
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
        >
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={doc.filename} className="h-full w-full object-cover" />
          ) : (
            <FileText className="h-6 w-6 text-muted-foreground" />
          )}
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{doc.title || doc.filename}</span>
            <Badge variant={doc.status === "failed" ? "destructive" : isDone ? "secondary" : "outline"}>
              {busyStatus && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {STATUS_LABEL[doc.status]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {isDone
              ? `${CATEGORY_LABEL[doc.category ?? "other"]} · ${doc.docDate ?? "без даты"} · ${languageName(doc.sourceLanguage) ?? "язык не определён"}`
              : doc.filename}
          </p>
          {doc.error && <p className="text-xs text-destructive">{doc.error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isDone && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen((v) => !v)} title="Показать перевод">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(doc.id)} title="Удалить">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {doc.warnings && doc.warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {doc.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {(doc.status === "new" || doc.status === "failed") && (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => onPatch(doc.id, { queue: true })}>
          {doc.status === "new" ? <Play className="mr-1.5 h-4 w-4" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          {doc.status === "new" ? "Разобрать" : "Повторить"}
        </Button>
      )}

      {isDone && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <select
            className={selectClass}
            value={doc.category ?? "other"}
            onChange={(e) => onPatch(doc.id, { category: e.target.value, include: e.target.value !== "other" })}
          >
            {(Object.keys(CATEGORY_LABEL) as DocumentCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={doc.include} onChange={(e) => onPatch(doc.id, { include: e.target.checked })} />В PDF
          </label>
          {doc.category !== "other" && (
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={doc.reviewed} onChange={(e) => onPatch(doc.id, { reviewed: e.target.checked })} />
              Проверено
            </label>
          )}
          <Button size="sm" variant="ghost" onClick={() => onPatch(doc.id, { queue: true })} title="Прочитать заново">
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Заново
          </Button>
        </div>
      )}

      {isDone && open && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px]">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== (doc.title ?? "") && onPatch(doc.id, { title })}
              placeholder="Название"
            />
            <Input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onBlur={() => date !== (doc.docDate ?? "") && onPatch(doc.id, { docDate: date })}
              placeholder="12 Mar 2026"
            />
          </div>
          {doc.category === "report" ? (
            <>
              <Textarea
                value={translation}
                onChange={(e) => setTranslation(e.target.value)}
                onBlur={() => translation !== (doc.translationEn ?? "") && onPatch(doc.id, { translationEn: translation })}
                rows={10}
                className="text-sm"
              />
              {doc.originalText && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Текст оригинала (расшифровка)</summary>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">{doc.originalText}</pre>
                </details>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {doc.category === "imaging"
                ? "Снимок идёт в PDF только строкой в списке «приложено оригиналом» — отправьте сам снимок отдельным фото."
                : "Этот файл не попадёт в PDF."}{" "}
              Если определено неверно, поменяйте категорию и нажмите «Заново».
            </p>
          )}
        </div>
      )}
    </div>
  );
}

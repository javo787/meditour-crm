"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  Copy,
  FlaskConical,
  ImagePlus,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Square,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  SIM_LANGUAGE_LABELS,
  transcriptToText,
  type SimLanguage,
  type SimTurn,
} from "@/lib/simulator";
import { SIM_PERSONAS, SIM_QUICK_PHRASES, findPersona } from "@/lib/simulator-scenarios";
import { cn } from "@/lib/utils";

interface Attachment {
  dataUrl: string;
  base64: string;
  mimeType: string;
}

interface AiMeta {
  language: SimLanguage | null;
  bubbles: number;
  latencyMs: number;
}

type SimItem =
  | { id: string; kind: "msg"; from: "patient" | "ai"; text: string; image?: Attachment; hadImage?: boolean; meta?: AiMeta }
  | { id: string; kind: "note"; tone: "info" | "warn" | "error"; text: string };

type Mode = "manual" | "auto";

const STORAGE_KEY = "meditour:simulator:v1";
const TURN_OPTIONS = ["4", "6", "8", "10"];

let counter = 0;
const uid = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Текст, под которым реплика уходит в историю для ИИ — как в боевом режиме. */
function historyText(m: Extract<SimItem, { kind: "msg" }>): string {
  if (m.from === "patient" && (m.image || m.hadImage)) {
    return `${m.text || "📎 [изображение без подписи]"} (+фото)`;
  }
  return m.text;
}

function toHistory(items: SimItem[]): SimTurn[] {
  return items
    .filter((i): i is Extract<SimItem, { kind: "msg" }> => i.kind === "msg")
    .map((m) => ({ from: m.from, text: historyText(m) }));
}

/** Уменьшаем фото перед отправкой: ИИ хватает 1280 px, а трафик и время — меньше. */
async function fileToAttachment(file: File): Promise<Attachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode"));
    el.src = dataUrl;
  });
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL("image/jpeg", 0.82);
  return { dataUrl: out, base64: out.split(",")[1] ?? "", mimeType: "image/jpeg" };
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: (await res.json().catch(() => null)) as T | null };
}

interface ReplyResponse {
  messages: string[];
  handoff: boolean;
  language: SimLanguage | null;
  suppressed: "empty" | "duplicate" | null;
  latencyMs: number;
  error?: string;
}

export function Simulator() {
  const [items, setItems] = useState<SimItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<Mode>("manual");
  const [personaId, setPersonaId] = useState(SIM_PERSONAS[0].id);
  const [language, setLanguage] = useState<SimLanguage>(SIM_PERSONAS[0].language);
  const [turns, setTurns] = useState("6");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restored, setRestored] = useState(false);

  const itemsRef = useRef<SimItem[]>([]);
  const pausedRef = useRef(false);
  const stopRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const persona = findPersona(personaId);

  const push = useCallback((...next: SimItem[]) => {
    itemsRef.current = [...itemsRef.current, ...next];
    setItems(itemsRef.current);
  }, []);

  const note = useCallback(
    (text: string, tone: "info" | "warn" | "error" = "info") =>
      push({ id: uid(), kind: "note", tone, text }),
    [push]
  );

  const setPausedBoth = (value: boolean) => {
    pausedRef.current = value;
    setPaused(value);
  };

  // Диалог переживает уход на другую страницу и обновление (без самих фото).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          items: SimItem[];
          paused: boolean;
          mode: Mode;
          personaId: string;
          language: SimLanguage;
          turns: string;
        };
        itemsRef.current = saved.items ?? [];
        setItems(itemsRef.current);
        setPausedBoth(Boolean(saved.paused));
        setMode(saved.mode ?? "manual");
        setPersonaId(saved.personaId ?? SIM_PERSONAS[0].id);
        setLanguage(saved.language ?? "ru");
        setTurns(saved.turns ?? "6");
      }
    } catch {
      // повреждённое сохранение — начинаем с чистого листа
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      const light = items.map((i) =>
        i.kind === "msg" && i.image
          ? { ...i, image: undefined, hadImage: true }
          : i
      );
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ items: light, paused, mode, personaId, language, turns })
      );
    } catch {
      // переполнено хранилище — не критично
    }
  }, [items, paused, mode, personaId, language, turns, restored]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, busy]);

  /** Запрос ответа ИИ. Возвращает true, если диалог можно продолжать. */
  async function requestAiReply(
    history: SimTurn[],
    message: { text: string; image?: Attachment }
  ): Promise<boolean> {
    setBusy(true);
    try {
      const { ok, data } = await postJson<ReplyResponse>("/api/simulator/reply", {
        history,
        message: {
          text: message.text,
          image: message.image
            ? { base64: message.image.base64, mimeType: message.image.mimeType }
            : undefined,
        },
      });
      if (!ok || !data) {
        note(data?.error ?? "ИИ не ответил. Попробуйте ещё раз.", "error");
        return false;
      }

      if (data.messages.length === 0) {
        // В боевом режиме в этом случае ИИ ставится на паузу, диалог — координатору.
        setPausedBoth(true);
        note(
          data.suppressed === "duplicate"
            ? "ИИ мог только повторить уже сказанное — ответ не отправлен. В боевом режиме диалог ушёл бы координатору."
            : "ИИ не сформировал ответ. В боевом режиме диалог ушёл бы координатору.",
          "warn"
        );
        return false;
      }

      const meta: AiMeta = {
        language: data.language,
        bubbles: data.messages.length,
        latencyMs: data.latencyMs,
      };
      push(
        ...data.messages.map<SimItem>((text, i) => ({
          id: uid(),
          kind: "msg",
          from: "ai",
          text,
          meta: i === data.messages.length - 1 ? meta : undefined,
        }))
      );

      if (data.handoff) {
        setPausedBoth(true);
        note("ИИ передал диалог координатору и встал на паузу.", "info");
        return false;
      }
      return true;
    } catch {
      note("Нет соединения. Попробуйте ещё раз.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendManual() {
    const text = draft.trim();
    if ((!text && !attachment) || busy || running) return;

    const history = toHistory(itemsRef.current);
    const image = attachment ?? undefined;
    push({ id: uid(), kind: "msg", from: "patient", text, image });
    setDraft("");
    setAttachment(null);

    if (pausedRef.current) {
      note(
        "ИИ на паузе — в боевом режиме ответил бы координатор. Нажмите «Возобновить ИИ», чтобы продолжить тест.",
        "info"
      );
      return;
    }
    await requestAiReply(history, { text, image });
  }

  async function runAuto() {
    if (busy || running) return;
    stopRef.current = false;
    setRunning(true);
    const total = Number(turns);
    try {
      for (let i = 0; i < total; i++) {
        if (stopRef.current) break;
        if (pausedRef.current) {
          note("ИИ на паузе — автопациент остановлен.", "info");
          break;
        }

        const history = toHistory(itemsRef.current);
        let text: string;
        if (history.length === 0 && persona.opening) {
          text = persona.opening;
        } else {
          setBusy(true);
          const { ok, data } = await postJson<{ text: string; end: boolean; error?: string }>(
            "/api/simulator/patient",
            { persona: persona.description, language, transcript: history }
          ).finally(() => setBusy(false));
          if (!ok || !data) {
            note(data?.error ?? "Автопациент не ответил.", "error");
            break;
          }
          if (data.end || !data.text) {
            note("Автопациент завершил диалог.", "info");
            break;
          }
          text = data.text;
        }
        if (stopRef.current) break;

        push({ id: uid(), kind: "msg", from: "patient", text });
        const goOn = await requestAiReply(history, { text });
        if (!goOn) break;
        if (i === total - 1) note(`Прогон завершён: ${total} реплик пациента.`, "info");
      }
    } finally {
      setRunning(false);
    }
  }

  function stopAuto() {
    stopRef.current = true;
  }

  function reset() {
    if (itemsRef.current.length > 0 && !window.confirm("Очистить диалог и начать заново?")) return;
    stopRef.current = true;
    itemsRef.current = [];
    setItems([]);
    setPausedBoth(false);
    setDraft("");
    setAttachment(null);
  }

  async function copyTranscript() {
    const text = transcriptToText(toHistory(itemsRef.current));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      note("Не удалось скопировать — выделите текст вручную.", "warn");
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      setAttachment(await fileToAttachment(file));
    } catch {
      note("Не удалось прочитать фото.", "error");
    }
  }

  // Статистика прогона — чтобы сразу видеть скорость и язык ответов.
  const aiReplies = items.filter(
    (i): i is Extract<SimItem, { kind: "msg" }> => i.kind === "msg" && i.from === "ai" && Boolean(i.meta)
  );
  const avgLatency =
    aiReplies.length > 0
      ? aiReplies.reduce((s, m) => s + (m.meta?.latencyMs ?? 0), 0) / aiReplies.length / 1000
      : null;
  const languages = Array.from(
    new Set(aiReplies.map((m) => m.meta?.language).filter((l): l is SimLanguage => Boolean(l)))
  );
  const patientCount = items.filter((i) => i.kind === "msg" && i.from === "patient").length;
  const locked = busy || running;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Шапка */}
      <div className="border-b px-4 py-3 sm:px-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <Link
            href="/dashboard/settings#ai-test"
            className="-ml-1 inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
            Настройки
          </Link>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <FlaskConical className="h-5 w-5 text-primary" />
                Тест ИИ
              </h1>
              <p className="text-sm text-muted-foreground">
                Песочница: сообщения не уходят в WhatsApp и не сохраняются в CRM.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyTranscript}
                disabled={items.length === 0}
                className="gap-1.5"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Скопировано" : "Копировать"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reset}
                disabled={items.length === 0 && !running}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Сбросить
              </Button>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Режим теста"
            className="flex gap-1 rounded-lg bg-muted p-1 sm:w-fit"
          >
            {(
              [
                ["manual", "Вручную"],
                ["auto", "Автопациент"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                disabled={running}
                onClick={() => setMode(id)}
                className={cn(
                  "flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:flex-none",
                  mode === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "auto" && (
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <Select
                  value={personaId}
                  onValueChange={(id) => {
                    setPersonaId(id);
                    setLanguage(findPersona(id).language);
                  }}
                  disabled={running}
                >
                  <SelectTrigger aria-label="Сценарий пациента">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIM_PERSONAS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={language}
                  onValueChange={(v) => setLanguage(v as SimLanguage)}
                  disabled={running}
                >
                  <SelectTrigger className="sm:w-36" aria-label="Язык пациента">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SIM_LANGUAGE_LABELS) as SimLanguage[]).map((l) => (
                      <SelectItem key={l} value={l}>
                        {SIM_LANGUAGE_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={turns} onValueChange={setTurns} disabled={running}>
                  <SelectTrigger className="sm:w-32" aria-label="Число реплик пациента">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TURN_OPTIONS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t} реплик
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Проверяет:</span> {persona.focus}.{" "}
                {persona.description}
              </p>
              <div className="flex items-center gap-2">
                {running ? (
                  <Button type="button" variant="destructive" size="sm" onClick={stopAuto} className="gap-1.5">
                    <Square className="h-3.5 w-3.5" />
                    Остановить
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={runAuto} disabled={busy} className="gap-1.5">
                    <Play className="h-3.5 w-3.5" />
                    {items.length > 0 ? "Продолжить прогон" : "Запустить"}
                  </Button>
                )}
                {running && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Идёт прогон…
                  </span>
                )}
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Реплик пациента: <b className="font-medium tabular-nums text-foreground">{patientCount}</b>
              </span>
              <span>
                Ответов ИИ: <b className="font-medium tabular-nums text-foreground">{aiReplies.length}</b>
              </span>
              {avgLatency !== null && (
                <span>
                  Среднее время ответа:{" "}
                  <b className="font-medium tabular-nums text-foreground">{avgLatency.toFixed(1)} с</b>
                </span>
              )}
              {languages.length > 0 && (
                <span>
                  Языки ответов:{" "}
                  <b className="font-medium text-foreground">{languages.join(", ")}</b>
                </span>
              )}
              {paused && <span className="font-medium text-amber-600 dark:text-amber-400">ИИ на паузе</span>}
            </div>
          )}
        </div>
      </div>

      {/* Переписка */}
      <div ref={scrollRef} className="thin-scrollbar flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <Bot className="h-8 w-8" />
              <p className="text-sm">
                {mode === "manual"
                  ? "Напишите сообщение от лица пациента — ИИ ответит так же, как в WhatsApp."
                  : "Выберите сценарий и нажмите «Запустить» — второй ИИ сыграет пациента."}
              </p>
            </div>
          )}

          {items.map((item) =>
            item.kind === "note" ? (
              <div
                key={item.id}
                role={item.tone === "error" ? "alert" : "status"}
                className={cn(
                  "mx-auto flex max-w-[90%] items-start gap-2 rounded-lg px-3 py-1.5 text-center text-xs",
                  item.tone === "error" && "bg-destructive/10 text-destructive",
                  item.tone === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                  item.tone === "info" && "bg-secondary text-muted-foreground"
                )}
              >
                {item.tone !== "info" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span>{item.text}</span>
              </div>
            ) : (
              <div
                key={item.id}
                className={cn("flex gap-2", item.from === "ai" ? "flex-row-reverse" : "flex-row")}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    item.from === "ai" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                  )}
                  aria-hidden="true"
                >
                  {item.from === "ai" ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                </span>
                <div className={cn("flex max-w-[80%] flex-col gap-1", item.from === "ai" ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "rounded-2xl px-3.5 py-2 text-sm",
                      item.from === "ai"
                        ? "rounded-tr-sm bg-primary/15"
                        : "rounded-tl-sm bg-secondary"
                    )}
                  >
                    {item.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image.dataUrl}
                        alt="Фото от пациента"
                        className="mb-1.5 max-h-48 rounded-lg"
                      />
                    )}
                    {item.hadImage && !item.image && (
                      <p className="mb-1 text-xs text-muted-foreground">📎 фото</p>
                    )}
                    {item.text && <p className="whitespace-pre-wrap break-words">{item.text}</p>}
                  </div>
                  {item.meta && (
                    <p className="px-1 text-[11px] text-muted-foreground">
                      {[
                        item.meta.language,
                        `${item.meta.bubbles} ${item.meta.bubbles === 1 ? "сообщение" : "сообщ."}`,
                        `${(item.meta.latencyMs / 1000).toFixed(1)} с`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            )
          )}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {running ? "Печатает…" : "ИИ печатает…"}
            </div>
          )}
        </div>
      </div>

      {/* Ввод */}
      <div className="border-t px-4 py-3 sm:px-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {paused && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <span>ИИ на паузе — как после передачи координатору.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => {
                  setPausedBoth(false);
                  note("ИИ возобновлён.", "info");
                }}
              >
                Возобновить ИИ
              </Button>
            </div>
          )}

          {mode === "manual" && (
            <>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {SIM_QUICK_PHRASES.map((phrase) => (
                  <button
                    key={phrase}
                    type="button"
                    onClick={() => setDraft(phrase)}
                    disabled={locked}
                    className="shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {phrase}
                  </button>
                ))}
              </div>

              {attachment && (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={attachment.dataUrl} alt="Прикреплённое фото" className="h-14 rounded-md border" />
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    aria-label="Убрать фото"
                    className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => fileRef.current?.click()}
                  disabled={locked}
                  aria-label="Прикрепить фото"
                  className="shrink-0"
                >
                  <ImagePlus className="h-4 w-4" />
                </Button>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // На телефоне Enter — перенос строки, на компьютере — отправка.
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      window.matchMedia("(pointer: fine)").matches
                    ) {
                      e.preventDefault();
                      sendManual();
                    }
                  }}
                  placeholder="Сообщение от лица пациента…"
                  rows={1}
                  className="max-h-32 min-h-[40px] resize-none"
                  disabled={locked}
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={sendManual}
                  disabled={locked || (!draft.trim() && !attachment)}
                  aria-label="Отправить"
                  className="shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AutosaveQueue, type AutosaveState, type SaveOutcome } from "@/lib/plans/autosave";
import { amountNumbers, clinicLabel, sortRowsByAmount } from "@/lib/plans/format";
import {
  MAX,
  PLAN_LIMITS,
  type PlanClinic,
  type PlanContent,
  type PlanCostGroup,
  type PlanCostRow,
  type PlanGender,
  type PlanOptions,
  type PlanStayRow,
  type PlanWarning,
  type TreatmentPlan,
} from "@/lib/plans/schema";
import { sectionOfPath, statusLabel } from "@/lib/plans/ui";
import { cn } from "@/lib/utils";

import {
  LEVEL_TEXT_CLASS,
  ListEditor,
  PLAN_SECTION_TITLES,
  Section,
  TextAreaField,
  TextField,
  revealSection,
} from "./fields";
import { PdfPreview } from "./pdf-preview";
import { ReviewDialog, type ReviewConfirmations } from "./review-dialog";
import { WarningsPanel } from "./warnings-panel";

// Редактор плана (§8–§9): загрузка, генерация с опросом, ошибка генерации, редактор с автосохранением,
// превью PDF и отметка «Проверено». Данные берёт сам через API. Текст письма и содержимое плана не логируются.

const POLL_MS = 2000; // опрос статуса генерации
const JSON_HEADERS = { "Content-Type": "application/json" };
const NETWORK_TEXT = "Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.";
const GENERIC_TEXT = "Не удалось выполнить действие. Попробуйте ещё раз.";
const CONFLICT_TEXT = "План изменён другим пользователем — обновите страницу";
const SAVE_FIRST_TEXT = "Не удалось сохранить последние правки. Дождитесь сохранения и попробуйте снова.";

// Что уходит в PATCH: всё содержимое и параметры плана (§8).
interface EditPayload {
  content: PlanContent;
  options: PlanOptions;
}

// Тело ответа API: при успехе plan, при ошибке error и code.
interface ApiBody {
  plan?: TreatmentPlan;
  error?: string;
  code?: string;
}

interface ApiResult {
  status: number;
  data: ApiBody | null;
}

type TitledItem = PlanContent["tactic"]["items"][number];

// Всё, что нужно разделам редактора: содержимое, блокировка во время генерации и обработчики правок.
interface EditorContext {
  content: PlanContent;
  options: PlanOptions;
  locked: boolean;
  warnings: PlanWarning[];
  setContent: (next: PlanContent) => void;
  setOptions: (next: PlanOptions) => void;
}

const GENDER_OPTIONS: ReadonlyArray<{ value: PlanGender; label: string }> = [
  { value: "unknown", label: "Не указан" },
  { value: "male", label: "Мужской" },
  { value: "female", label: "Женский" },
];

const HEADING_OPTIONS: ReadonlyArray<{ value: PlanOptions["diagnosisHeading"]; label: string }> = [
  { value: "confirmed", label: "ПОДТВЕРЖДЁННЫЙ ДИАГНОЗ" },
  { value: "by-documents", label: "ДИАГНОЗ ПО ПРЕДОСТАВЛЕННЫМ ДОКУМЕНТАМ" },
];

// Предупреждения, привязанные к этому пути поля (точное совпадение).
function atPath(warnings: PlanWarning[], path: string): PlanWarning[] {
  return warnings.filter((w) => w.path === path);
}

// Предупреждения раздела редактора (раздел определяет sectionOfPath).
function inSection(warnings: PlanWarning[], key: string): PlanWarning[] {
  return warnings.filter((w) => sectionOfPath(w.path) === key);
}

// Есть ли правки, которые ещё не подтверждены сервером.
function hasUnsaved(state: AutosaveState): boolean {
  return state.status !== "idle" && state.status !== "saved";
}

function saveText(state: AutosaveState): string {
  switch (state.status) {
    case "dirty":
      return "Не сохранено";
    case "saving":
      return "Сохраняю…";
    case "saved":
      return "Сохранено";
    case "conflict":
      return "Конфликт версий";
    case "error":
      return state.retrying ? "Не удалось сохранить — повторю" : "Не удалось сохранить";
    default:
      return "";
  }
}

async function readJson(res: Response): Promise<ApiBody | null> {
  return (await res.json().catch(() => null)) as ApiBody | null;
}

async function sendJson(url: string, method: "POST" | "PATCH", body: unknown): Promise<ApiResult | null> {
  try {
    const res = await fetch(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
    return { status: res.status, data: await readJson(res) };
  } catch {
    return null;
  }
}

async function fetchPlan(planId: string): Promise<{ ok: true; plan: TreatmentPlan } | { ok: false; missing: boolean }> {
  try {
    const res = await fetch(`/api/plans/${encodeURIComponent(planId)}`, { cache: "no-store" });
    if (res.status === 404) return { ok: false, missing: true };
    const data = await readJson(res);
    if (!res.ok || !data?.plan) return { ok: false, missing: false };
    return { ok: true, plan: data.plan };
  } catch {
    return { ok: false, missing: false };
  }
}

// PATCH черновика для очереди автосохранения. План из ответа нужен только для статуса, предупреждений и версии.
async function patchDraft(
  planId: string,
  payload: EditPayload,
  version: number,
): Promise<{ outcome: SaveOutcome; plan?: TreatmentPlan }> {
  const result = await sendJson(`/api/plans/${encodeURIComponent(planId)}`, "PATCH", { version, ...payload });
  if (!result) return { outcome: { ok: false, reason: "network" } };
  const { status, data } = result;
  if (status === 200 && data?.plan) return { outcome: { ok: true, version: data.plan.version }, plan: data.plan };
  if (status === 409) {
    return { outcome: { ok: false, reason: data?.code === "generating" ? "generating" : "conflict" } };
  }
  if (status === 400 || status === 404) {
    return { outcome: { ok: false, reason: "invalid", message: data?.error ?? "Не удалось сохранить" } };
  }
  return { outcome: { ok: false, reason: "network" } };
}

export function PlanEditor({ planId }: { planId: string }) {
  // Состояние привязано к id плана: при переходе на другой план редактор создаётся заново.
  return <PlanWorkspace key={planId} planId={planId} />;
}

function PlanWorkspace({ planId }: { planId: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<TreatmentPlan | null>(null);
  const [loadError, setLoadError] = useState<"missing" | "failed" | null>(null);
  const [saveState, setSaveState] = useState<AutosaveState>({ status: "idle" });
  const [conflictNotice, setConflictNotice] = useState(false); // конфликт, найденный при «Проверено»
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"generate" | "manual" | "delete" | null>(null);
  const [tab, setTab] = useState<"editor" | "pdf">("editor"); // на узком экране: редактор или PDF
  const [sourceOpen, setSourceOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Обработчикам и таймерам нужна последняя версия плана и состояние очереди, а не значения из момента создания замыкания.
  const docRef = useRef<TreatmentPlan | null>(null);
  const queueRef = useRef<AutosaveQueue<EditPayload> | null>(null);
  const saveStateRef = useRef<AutosaveState>({ status: "idle" });

  // Единственная запись плана: и для отрисовки, и для обработчиков через ref.
  const publish = useCallback((next: TreatmentPlan) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  // Ответ сервера на сохранение или «Проверено»: обновляем статус, предупреждения и версию, содержимое не трогаем,
  // чтобы не затереть то, что человек успел набрать.
  const mergeServerMeta = useCallback(
    (plan: TreatmentPlan) => {
      const cur = docRef.current;
      if (!cur) return;
      publish({ ...cur, status: plan.status, warnings: plan.warnings, version: plan.version, review: plan.review });
    },
    [publish],
  );

  // 409 «идёт генерация» приходит, когда план запустили в другой вкладке: берём состояние генерации, чтобы поля
  // заблокировались и пошёл опрос, а не повторяли сохранение вслепую.
  const syncGeneration = useCallback(async () => {
    const result = await fetchPlan(planId);
    const cur = docRef.current;
    if (result.ok && cur && result.plan.generation.state === "running") {
      publish({ ...cur, generation: result.plan.generation });
    }
  }, [planId, publish]);

  const saveDraft = useCallback(
    async (payload: EditPayload, version: number): Promise<SaveOutcome> => {
      const result = await patchDraft(planId, payload, version);
      if (result.plan) mergeServerMeta(result.plan);
      if (!result.plan && result.outcome.ok === false && result.outcome.reason === "generating") void syncGeneration();
      return result.outcome;
    },
    [planId, mergeServerMeta, syncGeneration],
  );

  // Принять план с сервера целиком (загрузка, конец генерации, обновление после конфликта) и сбросить очередь на его версию.
  const adopt = useCallback(
    (plan: TreatmentPlan) => {
      publish(plan);
      setConflictNotice(false);
      if (queueRef.current) {
        queueRef.current.reset(plan.version);
        return;
      }
      queueRef.current = new AutosaveQueue<EditPayload>({
        initialVersion: plan.version,
        save: saveDraft,
        onState: (state) => {
          saveStateRef.current = state;
          setSaveState(state);
        },
      });
    },
    [publish, saveDraft],
  );

  const loadPlan = useCallback(async () => {
    const result = await fetchPlan(planId);
    if (!result.ok) {
      if (docRef.current) setActionError("Не удалось обновить план. Попробуйте ещё раз.");
      else setLoadError(result.missing ? "missing" : "failed");
      return;
    }
    setLoadError(null);
    adopt(result.plan);
  }, [planId, adopt]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  // Уход со страницы: отправить отложенные правки и только потом остановить очередь.
  useEffect(
    () => () => {
      const queue = queueRef.current;
      queueRef.current = null;
      if (queue) void queue.flush().finally(() => queue.dispose());
    },
    [],
  );

  const generating = doc?.generation.state === "running";

  // Пока модель читает письмо, опрашиваем статус. Когда генерация закончилась, берём план целиком.
  useEffect(() => {
    if (!generating) return;
    let active = true;
    const timer = setInterval(() => {
      void fetchPlan(planId).then((result) => {
        if (active && result.ok && result.plan.generation.state !== "running") adopt(result.plan);
      });
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [generating, planId, adopt]);

  // Закрытие вкладки или обновление страницы: предупреждаем, пока есть несохранённые правки.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsaved(saveStateRef.current)) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Единая точка правки: изменение сразу видно в форме, сохранение уходит через очередь. Правка после «Проверено» возвращает «Черновик».
  function commitEdit(next: { content?: PlanContent; options?: PlanOptions }) {
    const cur = docRef.current;
    if (!cur?.content || cur.generation.state === "running") return;
    const content = next.content ?? cur.content;
    const options = next.options ?? cur.options;
    publish({ ...cur, content, options, status: cur.status === "reviewed" ? "draft" : cur.status });
    queueRef.current?.schedule({ content, options });
  }

  // Отправляет отложенные правки и ждёт ответа. false — сохранить не удалось (конфликт или сеть).
  async function settleSaves(): Promise<boolean> {
    await queueRef.current?.flush();
    const status = saveStateRef.current.status;
    return status === "idle" || status === "saved";
  }

  // «Сформировать заново» и «Повторить» (без manual) и «Заполнить вручную» (manual).
  async function generate(manual: boolean) {
    const cur = docRef.current;
    if (!cur) return;
    if (!manual && cur.content && !window.confirm("Сформировать план заново из письма? Текущий план будет заменён результатом модели.")) {
      return;
    }
    setActionError(null);
    setBusy(manual ? "manual" : "generate");
    if (!(await settleSaves())) {
      setBusy(null);
      setActionError(SAVE_FIRST_TEXT);
      return;
    }
    const url = `/api/plans/${encodeURIComponent(planId)}/generate`;
    let result = await sendJson(url, "POST", manual ? { manual: true } : {});
    if (result?.status === 409 && result.data?.code === "has-edits") {
      if (!window.confirm("В плане есть правки. Перегенерация заменит их результатом модели. Продолжить?")) {
        setBusy(null);
        return;
      }
      result = await sendJson(url, "POST", { overwrite: true });
    }
    setBusy(null);
    if (!result) {
      setActionError(NETWORK_TEXT);
      return;
    }
    if (result.status === 202) {
      const latest = docRef.current;
      if (latest) publish({ ...latest, generation: { ...latest.generation, state: "running" } });
      return;
    }
    if (result.status === 200 || result.status === 409) {
      // Сервер уже в другом состоянии (заполнен вручную, идёт генерация): берём его.
      await loadPlan();
      if (result.status === 409) setActionError(result.data?.error ?? GENERIC_TEXT);
      return;
    }
    setActionError(result.data?.error ?? GENERIC_TEXT);
  }

  async function submitReview(confirmations: ReviewConfirmations) {
    const queue = queueRef.current;
    if (!docRef.current || !queue) return;
    setReviewBusy(true);
    setReviewError(null);
    if (!(await settleSaves())) {
      setReviewBusy(false);
      setReviewError(SAVE_FIRST_TEXT);
      return;
    }
    const keys = (Object.keys(confirmations) as Array<keyof ReviewConfirmations>).filter((key) => confirmations[key]);
    const result = await sendJson(`/api/plans/${encodeURIComponent(planId)}/review`, "POST", {
      version: queue.version,
      confirmations: keys,
    });
    setReviewBusy(false);
    if (result?.status === 200 && result.data?.plan) {
      // Ответ — тот же план без правок: статус, предупреждения и версия обновляются, содержимое остаётся как было.
      mergeServerMeta(result.data.plan);
      queue.reset(result.data.plan.version);
      setReviewOpen(false);
      return;
    }
    if (result?.data?.code === "conflict") setConflictNotice(true);
    setReviewError(result ? (result.data?.error ?? GENERIC_TEXT) : NETWORK_TEXT);
  }

  async function reloadFromServer() {
    if (hasUnsaved(saveStateRef.current) && !window.confirm("Несохранённые правки в этом окне будут потеряны. Обновить план?")) {
      return;
    }
    await loadPlan();
  }

  async function deletePlanNow() {
    if (!window.confirm("Удалить план? Восстановить его будет нельзя.")) return;
    setActionError(null);
    setBusy("delete");
    let deleted = false;
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}`, { method: "DELETE" });
      deleted = res.ok || res.status === 404;
    } catch {
      deleted = false;
    }
    if (!deleted) {
      setBusy(null);
      setActionError("Не удалось удалить план. Попробуйте ещё раз.");
      return;
    }
    // Удалённый план больше не сохраняем: отложенная правка не должна уйти в пустоту.
    queueRef.current?.dispose();
    router.push("/dashboard/plans");
  }

  function jumpToSection(key: string) {
    setTab("editor");
    // На телефоне колонка редактора была скрыта: прокручиваем после того, как она появилась.
    window.setTimeout(() => revealSection(key), 0);
  }

  if (!doc) {
    if (loadError === "missing") {
      return (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="font-medium">План не найден</p>
          <p className="text-sm text-muted-foreground">Возможно, его удалили.</p>
          <Link href="/dashboard/plans" className={buttonVariants({ variant: "outline", size: "sm" })}>
            К списку планов
          </Link>
        </div>
      );
    }
    if (loadError === "failed") {
      return (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            Не удалось загрузить план. Проверьте связь.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setLoadError(null);
              void loadPlan();
            }}
          >
            Повторить
          </Button>
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground">Загружаю план…</p>;
  }

  const content = doc.content;
  const hasContent = content !== undefined;
  const conflict = saveState.status === "conflict" || conflictNotice;
  const ctx: EditorContext | null =
    content === undefined
      ? null
      : {
          content,
          options: doc.options,
          locked: generating,
          warnings: doc.warnings,
          setContent: (next) => commitEdit({ content: next }),
          setOptions: (next) => commitEdit({ options: next }),
        };

  let body: ReactNode;
  if (ctx === null) {
    body = (
      <GenerationCard
        generating={generating}
        failed={doc.generation.state === "failed"}
        error={doc.generation.error}
        busy={busy !== null}
        onRetry={() => void generate(false)}
        onManual={() => void generate(true)}
      />
    );
  } else {
    body = (
      <>
        {generating ? (
          <p className="rounded-md border border-border bg-card p-3 text-sm">Читаю письмо… Поля заблокированы до окончания.</p>
        ) : null}
        {doc.generation.state === "failed" && !generating ? (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/50 p-3 text-sm">
            <p className="font-medium text-destructive">Перегенерация не удалась</p>
            {doc.generation.error ? <p className="text-muted-foreground">{doc.generation.error}</p> : null}
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void generate(false)}>
              Повторить
            </Button>
          </div>
        ) : null}
        <GeneralSection warnings={doc.warnings} />
        <PatientSection ctx={ctx} />
        <OverviewSection ctx={ctx} />
        <DiagnosisSection ctx={ctx} />
        <IndiaSection ctx={ctx} />
        <TacticSection ctx={ctx} />
        <DocumentsSection ctx={ctx} />
        <ClinicsSection ctx={ctx} />
        <ApproachSection ctx={ctx} />
        <CostsSection ctx={ctx} />
        <StaySection ctx={ctx} />
        <IncludedSection ctx={ctx} />
        <NextStepsSection ctx={ctx} />
        <SettingsSection ctx={ctx} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold">{content?.patient.name || "Без имени"}</h2>
            <p className="text-sm text-muted-foreground">
              {statusLabel(doc.status, doc.generation.state)}
              {saveText(saveState) && !generating ? ` · ${saveText(saveState)}` : ""}
            </p>
            {saveState.status === "error" && !saveState.retrying ? (
              <p className="text-xs text-destructive">{saveState.message}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {hasContent ? (
              <a
                href={`/api/plans/${encodeURIComponent(planId)}/pdf?download=1`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Скачать PDF
              </a>
            ) : (
              <Button size="sm" variant="outline" disabled>
                Скачать PDF
              </Button>
            )}
            <Button
              size="sm"
              disabled={!hasContent || generating || busy !== null || doc.status === "reviewed"}
              onClick={() => {
                setReviewError(null);
                setReviewOpen(true);
              }}
            >
              Отметить проверенным
            </Button>
            <Button size="sm" variant="outline" disabled={generating || busy !== null} onClick={() => void generate(false)}>
              Сформировать заново
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSourceOpen(true)}>
              Письмо
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={generating || busy !== null}
              onClick={() => void deletePlanNow()}
            >
              Удалить
            </Button>
          </div>
        </div>
        {conflict ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/50 p-3">
            <div className="text-sm">
              <p className="font-medium text-destructive">{CONFLICT_TEXT}</p>
              <p className="text-xs text-muted-foreground">Несохранённые правки в этом окне будут потеряны.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void reloadFromServer()}>
              Обновить
            </Button>
          </div>
        ) : null}
        {actionError ? (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
        <WarningsPanel warnings={doc.warnings} onJump={jumpToSection} />
      </section>

      <div role="tablist" aria-label="Режим просмотра" className="grid grid-cols-2 gap-2 lg:hidden">
        <TabButton active={tab === "editor"} onClick={() => setTab("editor")}>
          Редактор
        </TabButton>
        <TabButton active={tab === "pdf"} onClick={() => setTab("pdf")}>
          PDF
        </TabButton>
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
        <div className={cn("min-w-0 space-y-3", tab === "pdf" && "hidden lg:block")}>{body}</div>
        <div className={cn("min-w-0 lg:sticky lg:top-4", tab === "editor" && "hidden lg:block")}>
          <PdfPreview planId={planId} version={doc.version} hasContent={hasContent} />
        </div>
      </div>

      <ReviewDialog
        open={reviewOpen}
        warnings={doc.warnings}
        busy={reviewBusy}
        error={reviewError ?? undefined}
        onConfirm={(confirmations) => void submitReview(confirmations)}
        onClose={() => {
          if (reviewBusy) return;
          setReviewOpen(false);
          setReviewError(null);
        }}
      />

      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Письмо</DialogTitle>
            <DialogDescription>
              {doc.source.filename ? `Текст извлечён из файла ${doc.source.filename}` : "Текст письма, как его вставили"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto px-6 pb-6">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{doc.source.text}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "h-9 rounded-md border text-sm font-medium",
        active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background",
      )}
    >
      {children}
    </button>
  );
}

// Вместо разделов, пока в плане нет содержимого: ход генерации или ошибка с «Повторить» и «Заполнить вручную».
function GenerationCard({
  generating,
  failed,
  error,
  busy,
  onRetry,
  onManual,
}: {
  generating: boolean;
  failed: boolean;
  error?: string;
  busy: boolean;
  onRetry: () => void;
  onManual: () => void;
}) {
  if (generating) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <p className="font-medium">Читаю письмо…</p>
        <p className="text-sm text-muted-foreground">Обычно это занимает до минуты. Страница обновится сама.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <p className="font-medium">{failed ? "Не удалось разобрать письмо" : "План ещё не сформирован"}</p>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={onRetry}>
          Повторить
        </Button>
        <Button variant="outline" disabled={busy} onClick={onManual}>
          Заполнить вручную
        </Button>
      </div>
    </div>
  );
}

// Выбор из списка (пол, заголовок диагноза). Нативный select открывается системным списком и на телефоне.
interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  warning?: PlanWarning[];
  disabled?: boolean;
}

function SelectField<T extends string>({ label, value, options, onChange, warning = [], disabled }: SelectFieldProps<T>) {
  const id = useId();
  const hasError = warning.some((w) => w.level === "error");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={hasError ? true : undefined}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          "flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          hasError ? "border-destructive" : "border-input",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {warning.map((w, i) => (
        <p key={`${w.code}-${i}`} className={cn("text-xs font-medium", LEVEL_TEXT_CLASS[w.level])}>
          {w.message}
        </p>
      ))}
    </div>
  );
}

// Предупреждения без раздела (путь не указан или неизвестен): отдельный раздел, чтобы панель сверху имела куда прокрутить.
function GeneralSection({ warnings }: { warnings: PlanWarning[] }) {
  const items = inSection(warnings, "general");
  if (items.length === 0) return null;
  return (
    <Section id="general" title={PLAN_SECTION_TITLES.general} warnings={items} defaultOpen>
      <ul className="space-y-2 text-sm">
        {items.map((w, i) => (
          <li key={`${w.code}-${i}`} className={LEVEL_TEXT_CLASS[w.level]}>
            {w.message}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PatientSection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  const { patient, profile } = content;
  return (
    <Section id="patient" title={PLAN_SECTION_TITLES.patient} warnings={inSection(warnings, "patient")} defaultOpen>
      <TextField
        label="ФИО пациента"
        value={patient.name}
        maxLength={PLAN_LIMITS.patientName}
        warning={atPath(warnings, "patient.name")}
        disabled={locked}
        onChange={(name) => setContent({ ...content, patient: { ...patient, name } })}
      />
      <SelectField
        label="Пол"
        value={patient.gender}
        options={GENDER_OPTIONS}
        warning={atPath(warnings, "patient.gender")}
        disabled={locked}
        onChange={(gender) => setContent({ ...content, patient: { ...patient, gender } })}
      />
      <TextField
        label="Специальность"
        value={profile.specialty}
        maxLength={MAX.profile}
        warning={atPath(warnings, "profile.specialty")}
        disabled={locked}
        onChange={(specialty) => setContent({ ...content, profile: { ...profile, specialty } })}
      />
      <TextField
        label="Состояние"
        value={profile.condition}
        maxLength={MAX.profile}
        warning={atPath(warnings, "profile.condition")}
        disabled={locked}
        onChange={(condition) => setContent({ ...content, profile: { ...profile, condition } })}
      />
    </Section>
  );
}

function OverviewSection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  return (
    <Section id="overview" title={PLAN_SECTION_TITLES.overview} warnings={inSection(warnings, "overview")}>
      <ListEditor<string>
        items={content.overview}
        onChange={(overview) => setContent({ ...content, overview })}
        createItem={() => ""}
        renderItem={(item, index, update) => (
          <TextAreaField
            label={`Пункт ${index + 1}`}
            value={item}
            maxLength={PLAN_LIMITS.overviewItem}
            warning={atPath(warnings, `overview[${index}]`)}
            disabled={locked}
            onChange={update}
          />
        )}
        addLabel="Добавить пункт"
        max={MAX.overviewItems}
        disabled={locked}
        emptyText="Пунктов нет"
      />
    </Section>
  );
}

function DiagnosisSection({ ctx }: { ctx: EditorContext }) {
  const { content, options, locked, warnings, setContent, setOptions } = ctx;
  const { diagnosis } = content;
  return (
    <Section id="diagnosis" title={PLAN_SECTION_TITLES.diagnosis} warnings={inSection(warnings, "diagnosis")}>
      <SelectField
        label="Заголовок диагноза"
        value={options.diagnosisHeading}
        options={HEADING_OPTIONS}
        warning={atPath(warnings, "options.diagnosisHeading")}
        disabled={locked}
        onChange={(diagnosisHeading) => setOptions({ ...options, diagnosisHeading })}
      />
      <TextAreaField
        label="Диагноз"
        value={diagnosis.text}
        maxLength={PLAN_LIMITS.cell}
        warning={atPath(warnings, "diagnosis.text")}
        disabled={locked}
        onChange={(text) => setContent({ ...content, diagnosis: { ...diagnosis, text } })}
      />
      <TextAreaField
        label="Состояние"
        value={diagnosis.state}
        maxLength={PLAN_LIMITS.cell}
        warning={atPath(warnings, "diagnosis.state")}
        disabled={locked}
        onChange={(state) => setContent({ ...content, diagnosis: { ...diagnosis, state } })}
      />
      <TextAreaField
        label="Тактика"
        value={diagnosis.tactic}
        maxLength={PLAN_LIMITS.cell}
        warning={atPath(warnings, "diagnosis.tactic")}
        disabled={locked}
        onChange={(tactic) => setContent({ ...content, diagnosis: { ...diagnosis, tactic } })}
      />
      <TextAreaField
        label="Статус"
        value={diagnosis.status}
        maxLength={PLAN_LIMITS.cell}
        warning={atPath(warnings, "diagnosis.status")}
        disabled={locked}
        onChange={(status) => setContent({ ...content, diagnosis: { ...diagnosis, status } })}
      />
    </Section>
  );
}

function IndiaSection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  return (
    <Section id="indiaSteps" title={PLAN_SECTION_TITLES.indiaSteps} warnings={inSection(warnings, "indiaSteps")}>
      <ListEditor<string>
        items={content.indiaSteps}
        onChange={(indiaSteps) => setContent({ ...content, indiaSteps })}
        createItem={() => ""}
        renderItem={(item, index, update) => (
          <TextAreaField
            label={`Шаг ${index + 1}`}
            value={item}
            maxLength={MAX.indiaStep}
            warning={atPath(warnings, `indiaSteps[${index}]`)}
            disabled={locked}
            onChange={update}
          />
        )}
        addLabel="Добавить шаг"
        max={MAX.indiaSteps}
        disabled={locked}
        emptyText="Шагов нет"
      />
    </Section>
  );
}

function TacticSection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  const { tactic } = content;
  return (
    <Section id="tactic" title={PLAN_SECTION_TITLES.tactic} warnings={inSection(warnings, "tactic")}>
      <TextAreaField
        label="Вступление"
        value={tactic.intro}
        maxLength={PLAN_LIMITS.paragraph}
        warning={atPath(warnings, "tactic.intro")}
        disabled={locked}
        onChange={(intro) => setContent({ ...content, tactic: { ...tactic, intro } })}
      />
      <TitledItemsEditor
        items={tactic.items}
        onChange={(items) => setContent({ ...content, tactic: { ...tactic, items } })}
        warnings={warnings}
        pathPrefix="tactic.items"
        locked={locked}
        addLabel="Добавить пункт"
        max={MAX.tacticItems}
      />
      <TextAreaField
        label="Оговорка о тактике"
        value={content.fixed.tacticDisclaimer}
        maxLength={MAX.note}
        warning={atPath(warnings, "fixed.tacticDisclaimer")}
        disabled={locked}
        onChange={(tacticDisclaimer) => setContent({ ...content, fixed: { ...content.fixed, tacticDisclaimer } })}
      />
    </Section>
  );
}

function DocumentsSection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  const { documents } = content;
  return (
    <Section id="documents" title={PLAN_SECTION_TITLES.documents} warnings={inSection(warnings, "documents")}>
      <TextField
        label="Заголовок раздела"
        value={documents.title}
        maxLength={MAX.heading}
        warning={atPath(warnings, "documents.title")}
        disabled={locked}
        onChange={(title) => setContent({ ...content, documents: { ...documents, title } })}
      />
      <ListEditor<string>
        items={documents.items}
        onChange={(items) => setContent({ ...content, documents: { ...documents, items } })}
        createItem={() => ""}
        renderItem={(item, index, update) => (
          <TextField
            label={`Документ ${index + 1}`}
            value={item}
            maxLength={PLAN_LIMITS.cell}
            warning={atPath(warnings, `documents.items[${index}]`)}
            disabled={locked}
            onChange={update}
          />
        )}
        addLabel="Добавить документ"
        max={MAX.documentItems}
        disabled={locked}
        emptyText="Документов нет"
      />
    </Section>
  );
}

function ClinicsSection({ ctx }: { ctx: EditorContext }) {
  const { content, options, locked, warnings, setContent, setOptions } = ctx;
  const { clinics, costs } = content;
  return (
    <Section id="clinics" title={PLAN_SECTION_TITLES.clinics} warnings={inSection(warnings, "clinics")}>
      <CheckboxField
        label="Проверил по сайтам клиник"
        checked={options.clinicsVerifiedOnSites}
        warning={atPath(warnings, "options.clinicsVerifiedOnSites")}
        disabled={locked}
        onChange={(clinicsVerifiedOnSites) => setOptions({ ...options, clinicsVerifiedOnSites })}
      />
      {options.clinicsVerifiedOnSites ? (
        <NativeInputField
          label="Месяц проверки"
          type="month"
          value={options.clinicsVerifiedMonth}
          warning={atPath(warnings, "options.clinicsVerifiedMonth")}
          disabled={locked}
          onChange={(clinicsVerifiedMonth) => setOptions({ ...options, clinicsVerifiedMonth })}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Порядок клиник</p>
        <Button
          variant="outline"
          size="sm"
          disabled={locked || clinics.length < 2}
          onClick={() => setContent({ ...content, clinics: clinicsByPrice(clinics, costs.groups) })}
        >
          Цены по возрастанию
        </Button>
      </div>
      <ListEditor<PlanClinic>
        items={clinics}
        onChange={(next) => setContent({ ...content, clinics: next })}
        createItem={() => ({
          id: nextClinicId(clinics),
          name: "",
          shortName: "",
          city: "",
          area: "",
          doctor: "",
          why: "",
        })}
        renderItem={(clinic, index, update) => (
          <>
            <p className="text-sm font-medium">Клиника {index + 1}</p>
            <TextField
              label="Название"
              value={clinic.name}
              maxLength={MAX.clinicName}
              warning={atPath(warnings, `clinics[${index}].name`)}
              disabled={locked}
              onChange={(name) => update({ ...clinic, name })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Короткое название"
                value={clinic.shortName}
                maxLength={MAX.clinicShortName}
                warning={atPath(warnings, `clinics[${index}].shortName`)}
                disabled={locked}
                onChange={(shortName) => update({ ...clinic, shortName })}
              />
              <TextField
                label="Город"
                value={clinic.city}
                maxLength={MAX.city}
                warning={atPath(warnings, `clinics[${index}].city`)}
                disabled={locked}
                onChange={(city) => update({ ...clinic, city })}
              />
              <TextField
                label="Район"
                value={clinic.area}
                maxLength={MAX.area}
                warning={atPath(warnings, `clinics[${index}].area`)}
                disabled={locked}
                onChange={(area) => update({ ...clinic, area })}
              />
            </div>
            <TextField
              label="Врач"
              value={clinic.doctor}
              maxLength={PLAN_LIMITS.cell}
              warning={atPath(warnings, `clinics[${index}].doctor`)}
              disabled={locked}
              onChange={(doctor) => update({ ...clinic, doctor })}
            />
            <TextAreaField
              label="Почему эта клиника"
              value={clinic.why}
              maxLength={PLAN_LIMITS.cell}
              warning={atPath(warnings, `clinics[${index}].why`)}
              disabled={locked}
              onChange={(why) => update({ ...clinic, why })}
            />
          </>
        )}
        addLabel="Добавить клинику"
        max={MAX.clinics}
        disabled={locked}
        emptyText="Клиник нет"
      />
    </Section>
  );
}

function ApproachSection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  const { approach } = content;
  return (
    <Section id="approach" title={PLAN_SECTION_TITLES.approach} warnings={inSection(warnings, "approach")}>
      <TextField
        label="Заголовок раздела"
        value={approach.title}
        maxLength={MAX.heading}
        warning={atPath(warnings, "approach.title")}
        disabled={locked}
        onChange={(title) => setContent({ ...content, approach: { ...approach, title } })}
      />
      <ListEditor<string>
        items={approach.paragraphs}
        onChange={(paragraphs) => setContent({ ...content, approach: { ...approach, paragraphs } })}
        createItem={() => ""}
        renderItem={(item, index, update) => (
          <TextAreaField
            label={`Абзац ${index + 1}`}
            value={item}
            maxLength={PLAN_LIMITS.paragraph}
            warning={atPath(warnings, `approach.paragraphs[${index}]`)}
            disabled={locked}
            onChange={update}
          />
        )}
        addLabel="Добавить абзац"
        max={MAX.approachParagraphs}
        disabled={locked}
        emptyText="Абзацев нет"
      />
      <TitledItemsEditor
        items={approach.items}
        onChange={(items) => setContent({ ...content, approach: { ...approach, items } })}
        warnings={warnings}
        pathPrefix="approach.items"
        locked={locked}
        addLabel="Добавить пункт"
        max={MAX.tacticItems}
      />
      <TextAreaField
        label="Примечание"
        value={approach.note}
        maxLength={MAX.note}
        warning={atPath(warnings, "approach.note")}
        disabled={locked}
        onChange={(note) => setContent({ ...content, approach: { ...approach, note } })}
      />
    </Section>
  );
}

function CostsSection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  const { costs, clinics } = content;
  const clinicOptions = [
    { value: "", label: "Клиника не выбрана" },
    ...clinics.map((clinic) => ({ value: clinic.id, label: clinicLabel(clinic) })),
  ];
  return (
    <Section id="costs" title={PLAN_SECTION_TITLES.costs} warnings={inSection(warnings, "costs")}>
      <ListEditor<PlanCostGroup>
        items={costs.groups}
        onChange={(groups) => setContent({ ...content, costs: { ...costs, groups } })}
        createItem={() => ({ title: "", note: "", rows: [] })}
        renderItem={(group, gi, updateGroup) => (
          <>
            <p className="text-sm font-medium">Группа {gi + 1}</p>
            <TextField
              label="Заголовок группы"
              value={group.title}
              maxLength={MAX.groupTitle}
              warning={atPath(warnings, `costs.groups[${gi}].title`)}
              disabled={locked}
              onChange={(title) => updateGroup({ ...group, title })}
            />
            <TextAreaField
              label="Примечание к группе"
              value={group.note}
              maxLength={MAX.note}
              warning={atPath(warnings, `costs.groups[${gi}].note`)}
              disabled={locked}
              onChange={(note) => updateGroup({ ...group, note })}
            />
            <ListEditor<PlanCostRow>
              items={group.rows}
              onChange={(rows) => updateGroup({ ...group, rows })}
              createItem={() => ({ label: "", clinicId: "", amount: "", evidence: "" })}
              renderItem={(row, ri, updateRow) => {
                const base = `costs.groups[${gi}].rows[${ri}]`;
                // Строка может ссылаться на клинику, которой уже нет в списке: показываем это, а не первый пункт.
                const known = row.clinicId === "" || clinics.some((clinic) => clinic.id === row.clinicId);
                const options = known
                  ? clinicOptions
                  : [...clinicOptions, { value: row.clinicId, label: "Клиника удалена из списка" }];
                return (
                  <>
                    <TextField
                      label="Услуга"
                      value={row.label}
                      maxLength={PLAN_LIMITS.cell}
                      warning={atPath(warnings, `${base}.label`)}
                      disabled={locked}
                      onChange={(label) => updateRow({ ...row, label })}
                    />
                    <SelectField
                      label="Клиника"
                      value={row.clinicId}
                      options={options}
                      warning={atPath(warnings, `${base}.clinicId`)}
                      disabled={locked}
                      onChange={(clinicId) => updateRow({ ...row, clinicId })}
                    />
                    <TextField
                      label="Сумма"
                      value={row.amount}
                      maxLength={MAX.amount}
                      hint={row.evidence ? `Из письма: ${row.evidence}` : undefined}
                      warning={atPath(warnings, `${base}.amount`)}
                      disabled={locked}
                      onChange={(amount) => updateRow({ ...row, amount })}
                    />
                  </>
                );
              }}
              addLabel="Добавить строку"
              max={MAX.rows}
              disabled={locked}
              emptyText="Строк нет"
            />
          </>
        )}
        addLabel="Добавить группу"
        max={MAX.groups}
        disabled={locked}
        emptyText="Групп нет"
      />
      <TextAreaField
        label="Сноска к стоимости"
        value={costs.footnote}
        maxLength={MAX.note}
        hint={`По умолчанию: ${content.fixed.costFootnote}`}
        warning={atPath(warnings, "costs.footnote")}
        disabled={locked}
        onChange={(footnote) => setContent({ ...content, costs: { ...costs, footnote } })}
      />
    </Section>
  );
}

function StaySection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  const { flights } = content.fixed;
  const { stay } = content;
  const setFlights = (next: PlanContent["fixed"]["flights"]) =>
    setContent({ ...content, fixed: { ...content.fixed, flights: next } });
  const flightsOff = locked || !flights.enabled;
  return (
    <Section id="stay" title={PLAN_SECTION_TITLES.stay} warnings={inSection(warnings, "stay")}>
      <CheckboxField
        label="Показывать блок рейса"
        checked={flights.enabled}
        warning={atPath(warnings, "fixed.flights.enabled")}
        disabled={locked}
        onChange={(enabled) => setFlights({ ...flights, enabled })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Откуда"
          value={flights.from}
          maxLength={MAX.place}
          warning={atPath(warnings, "fixed.flights.from")}
          disabled={flightsOff}
          onChange={(from) => setFlights({ ...flights, from })}
        />
        <TextField
          label="Куда"
          value={flights.to}
          maxLength={MAX.place}
          warning={atPath(warnings, "fixed.flights.to")}
          disabled={flightsOff}
          onChange={(to) => setFlights({ ...flights, to })}
        />
      </div>
      <TextAreaField
        label="Текст о рейсе"
        value={flights.text}
        maxLength={MAX.note}
        warning={atPath(warnings, "fixed.flights.text")}
        disabled={flightsOff}
        onChange={(text) => setFlights({ ...flights, text })}
      />
      <NativeInputField
        label="Дата проверки рейса"
        type="date"
        value={flights.checkedOn}
        warning={atPath(warnings, "fixed.flights.checkedOn")}
        disabled={flightsOff}
        onChange={(checkedOn) => setFlights({ ...flights, checkedOn })}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">Строки пребывания</p>
        <ListEditor<PlanStayRow>
          items={stay.rows}
          onChange={(rows) => setContent({ ...content, stay: { ...stay, rows } })}
          createItem={() => ({ label: "", value: "", total: false })}
          renderItem={(row, index, update) => (
            <>
              <TextField
                label="Название"
                value={row.label}
                maxLength={PLAN_LIMITS.cell}
                warning={atPath(warnings, `stay.rows[${index}].label`)}
                disabled={locked}
                onChange={(label) => update({ ...row, label })}
              />
              <TextField
                label="Значение"
                value={row.value}
                maxLength={PLAN_LIMITS.cell}
                warning={atPath(warnings, `stay.rows[${index}].value`)}
                disabled={locked}
                onChange={(value) => update({ ...row, value })}
              />
              <CheckboxField
                label="Строка итога"
                checked={row.total}
                warning={atPath(warnings, `stay.rows[${index}].total`)}
                disabled={locked}
                onChange={(total) => update({ ...row, total })}
              />
            </>
          )}
          addLabel="Добавить строку"
          max={MAX.stayRows}
          disabled={locked}
          emptyText="Строк нет"
        />
      </div>
      <TextAreaField
        label="Примечание"
        value={stay.note}
        maxLength={MAX.note}
        warning={atPath(warnings, "stay.note")}
        disabled={locked}
        onChange={(note) => setContent({ ...content, stay: { ...stay, note } })}
      />
    </Section>
  );
}

function IncludedSection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  const { fixed } = content;
  return (
    <Section id="included" title={PLAN_SECTION_TITLES.included} warnings={inSection(warnings, "included")}>
      <div className="space-y-2">
        <p className="text-sm font-medium">Включено</p>
        <ListEditor<string>
          items={content.included}
          onChange={(included) => setContent({ ...content, included })}
          createItem={() => ""}
          renderItem={(item, index, update) => (
            <TextField
              label={`Пункт ${index + 1}`}
              value={item}
              maxLength={PLAN_LIMITS.cell}
              warning={atPath(warnings, `included[${index}]`)}
              disabled={locked}
              onChange={update}
            />
          )}
          addLabel="Добавить пункт"
          max={MAX.included}
          disabled={locked}
          emptyText="Пунктов нет"
        />
      </div>
      <TextAreaField
        label="Не включено"
        value={content.notIncluded}
        maxLength={MAX.note}
        warning={atPath(warnings, "notIncluded")}
        disabled={locked}
        onChange={(notIncluded) => setContent({ ...content, notIncluded })}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">Поддержка Meditur</p>
        <ListEditor<string>
          items={fixed.support}
          onChange={(support) => setContent({ ...content, fixed: { ...fixed, support } })}
          createItem={() => ""}
          renderItem={(item, index, update) => (
            <TextField
              label={`Пункт ${index + 1}`}
              value={item}
              maxLength={PLAN_LIMITS.cell}
              warning={atPath(warnings, `fixed.support[${index}]`)}
              disabled={locked}
              onChange={update}
            />
          )}
          addLabel="Добавить пункт"
          max={MAX.support}
          disabled={locked}
          emptyText="Пунктов нет"
        />
      </div>
    </Section>
  );
}

function NextStepsSection({ ctx }: { ctx: EditorContext }) {
  const { content, locked, warnings, setContent } = ctx;
  const { fixed } = content;
  return (
    <Section id="nextSteps" title={PLAN_SECTION_TITLES.nextSteps} warnings={inSection(warnings, "nextSteps")}>
      <ListEditor<string>
        items={fixed.nextSteps}
        onChange={(nextSteps) => setContent({ ...content, fixed: { ...fixed, nextSteps } })}
        createItem={() => ""}
        renderItem={(item, index, update) => (
          <TextField
            label={`Шаг ${index + 1}`}
            value={item}
            maxLength={MAX.nextStep}
            warning={atPath(warnings, `fixed.nextSteps[${index}]`)}
            disabled={locked}
            onChange={update}
          />
        )}
        addLabel="Добавить шаг"
        max={MAX.nextSteps}
        disabled={locked}
        emptyText="Шагов нет"
      />
    </Section>
  );
}

function SettingsSection({ ctx }: { ctx: EditorContext }) {
  const { options, locked, warnings, setOptions } = ctx;
  return (
    <Section id="settings" title={PLAN_SECTION_TITLES.settings} warnings={inSection(warnings, "settings")}>
      <NativeInputField
        label="Дата плана"
        type="date"
        value={options.date}
        warning={atPath(warnings, "options.date")}
        disabled={locked}
        onChange={(date) => setOptions({ ...options, date })}
      />
      <CheckboxField
        label="Номера страниц в PDF"
        checked={options.showPageNumbers}
        warning={atPath(warnings, "options.showPageNumbers")}
        disabled={locked}
        onChange={(showPageNumbers) => setOptions({ ...options, showPageNumbers })}
      />
    </Section>
  );
}

// Пары «название / текст»: тактика и подход.
interface TitledItemsEditorProps {
  items: TitledItem[];
  onChange: (items: TitledItem[]) => void;
  warnings: PlanWarning[];
  pathPrefix: string; // путь списка в содержимом, например «tactic.items»
  locked: boolean;
  addLabel: string;
  max: number;
}

function TitledItemsEditor({ items, onChange, warnings, pathPrefix, locked, addLabel, max }: TitledItemsEditorProps) {
  return (
    <ListEditor<TitledItem>
      items={items}
      onChange={onChange}
      createItem={() => ({ title: "", text: "" })}
      renderItem={(item, index, update) => (
        <>
          <p className="text-sm font-medium">Пункт {index + 1}</p>
          <TextField
            label="Название"
            value={item.title}
            maxLength={MAX.itemTitle}
            warning={atPath(warnings, `${pathPrefix}[${index}].title`)}
            disabled={locked}
            onChange={(title) => update({ ...item, title })}
          />
          <TextAreaField
            label="Текст"
            value={item.text}
            maxLength={MAX.itemText}
            warning={atPath(warnings, `${pathPrefix}[${index}].text`)}
            disabled={locked}
            onChange={(text) => update({ ...item, text })}
          />
        </>
      )}
      addLabel={addLabel}
      max={max}
      disabled={locked}
      emptyText="Пунктов нет"
    />
  );
}

// Новый id клиники: c{n} с первым свободным n. Строки стоимости ссылаются на клинику по этому id.
function nextClinicId(clinics: PlanClinic[]): string {
  const used = new Set(clinics.map((clinic) => clinic.id));
  let n = clinics.length + 1;
  while (used.has(`c${n}`)) n += 1;
  return `c${n}`;
}

// Клиники по возрастанию самой дешёвой строки стоимости. Клиники без цены — в конце; порядок равных сохраняется.
function clinicsByPrice(clinics: PlanClinic[], groups: PlanCostGroup[]): PlanClinic[] {
  const rows = groups.flatMap((group) => group.rows);
  const keyed = clinics.map((clinic) => {
    let cheapest = "";
    let cheapestValue = Infinity;
    for (const row of rows) {
      if (row.clinicId !== clinic.id) continue;
      const value = amountNumbers(row.amount)[0] ?? Infinity;
      if (value < cheapestValue) {
        cheapest = row.amount;
        cheapestValue = value;
      }
    }
    return { clinic, amount: cheapest };
  });
  return sortRowsByAmount(keyed).map((item) => item.clinic);
}

// Флажок с подписью; предупреждения выводятся под ним.
function CheckboxField({
  label,
  checked,
  onChange,
  warning = [],
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  warning?: PlanWarning[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary disabled:opacity-50"
        />
        <Label htmlFor={id} className="cursor-pointer font-normal leading-snug">
          {label}
        </Label>
      </div>
      <WarningLines warnings={warning} />
    </div>
  );
}

// Поле даты или месяца: нативный выбор.
function NativeInputField({
  label,
  type,
  value,
  onChange,
  warning = [],
  disabled,
}: {
  label: string;
  type: "date" | "month";
  value: string;
  onChange: (value: string) => void;
  warning?: PlanWarning[];
  disabled?: boolean;
}) {
  const id = useId();
  const hasError = warning.some((w) => w.level === "error");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        aria-invalid={hasError ? true : undefined}
        className={cn(hasError && "border-destructive")}
        onChange={(e) => onChange(e.target.value)}
      />
      <WarningLines warnings={warning} />
    </div>
  );
}

// Строки предупреждений под полем, цвет по уровню.
function WarningLines({ warnings }: { warnings: PlanWarning[] }) {
  return (
    <>
      {warnings.map((w, i) => (
        <p key={`${w.code}-${i}`} className={cn("text-xs font-medium", LEVEL_TEXT_CLASS[w.level])}>
          {w.message}
        </p>
      ))}
    </>
  );
}

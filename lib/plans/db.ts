// Слой данных раздела «Планы»: коллекция TreatmentPlans поверх MongoDB Atlas.
// Записи, которые меняют content, options или leadId, идут с фильтром по version (несовпадение = conflict, а не
// перезапись). Фоновая генерация пишет результат или ошибку только в свой запуск (тот же startedAt).
// Зависшая генерация (старше 5 минут) считается проваленной; сохранение и «Заполнить вручную» переводят её в failed.
import { ObjectId, type Filter, type UpdateFilter } from "mongodb";

import { getDb } from "@/lib/mongodb";
import { newPlanContent, newPlanOptions } from "./defaults";
import type {
  PlanContent,
  PlanGeneration,
  PlanListItem,
  PlanOptions,
  PlanReview,
  PlanStatus,
  PlanWarning,
  TreatmentPlan,
} from "./schema";
import { sha256Hex } from "./source";

export const STALE_GENERATION_MS = 5 * 60 * 1000;
export const STALE_GENERATION_ERROR = "Генерация не завершилась — повторите";

// Документ коллекции TreatmentPlans. Даты — ISO-строки, как в остальных коллекциях.
interface TreatmentPlanDoc {
  _id: ObjectId;
  leadId?: ObjectId | null;
  version: number;
  status: PlanStatus;
  source: { text: string; kind: "paste" | "docx"; filename?: string; sha256: string };
  content?: PlanContent;
  aiDraft?: PlanContent;
  options: PlanOptions;
  warnings: PlanWarning[];
  generation: PlanGeneration;
  review?: PlanReview;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Генерация «зависла»: запущена больше 5 минут назад. Для записи без startedAt это не определяется.
export function effectiveGeneration(g: PlanGeneration, now: Date = new Date()): PlanGeneration {
  const stale = g.state === "running" && g.startedAt !== undefined && Date.parse(g.startedAt) < now.getTime() - STALE_GENERATION_MS;
  return stale ? { ...g, state: "failed", error: STALE_GENERATION_ERROR } : g;
}

async function plans() {
  const db = await getDb();
  return db.collection<TreatmentPlanDoc>("TreatmentPlans");
}

// Id из адресной строки: только 24 hex-символа. Иначе запись не ищем.
function toObjectId(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

// Условие «генерация не идёт»: не запущена или запущена раньше, чем 5 минут назад.
function idleOrStale(now: Date): Filter<TreatmentPlanDoc> {
  const cutoff = new Date(now.getTime() - STALE_GENERATION_MS).toISOString();
  return {
    $or: [{ "generation.state": { $ne: "running" } }, { "generation.startedAt": { $lt: cutoff } }],
  };
}

function toPlan(doc: TreatmentPlanDoc): TreatmentPlan {
  return {
    id: doc._id.toString(),
    leadId: doc.leadId ? doc.leadId.toString() : null,
    version: doc.version,
    status: doc.status,
    source: doc.source,
    content: doc.content,
    aiDraft: doc.aiDraft,
    options: doc.options,
    warnings: doc.warnings,
    generation: doc.generation,
    review: doc.review,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function createPlan(input: {
  sourceText: string;
  sourceKind: "paste" | "docx";
  filename?: string;
  leadId?: string;
  createdBy: string;
  now?: Date;
}): Promise<TreatmentPlan> {
  const now = input.now ?? new Date();
  const iso = now.toISOString();
  const doc: TreatmentPlanDoc = {
    _id: new ObjectId(),
    leadId: input.leadId ? new ObjectId(input.leadId) : null,
    version: 1,
    status: "empty",
    source: {
      text: input.sourceText,
      kind: input.sourceKind,
      ...(input.filename ? { filename: input.filename } : {}),
      sha256: sha256Hex(input.sourceText),
    },
    options: newPlanOptions(now),
    warnings: [],
    generation: { state: "idle" },
    createdBy: input.createdBy,
    createdAt: iso,
    updatedAt: iso,
  };
  await (await plans()).insertOne(doc);
  return toPlan(doc);
}

export async function getPlan(id: string): Promise<TreatmentPlan | null> {
  const oid = toObjectId(id);
  if (!oid) return null;
  const doc = await (await plans()).findOne({ _id: oid });
  return doc ? toPlan(doc) : null;
}

// Список без текста письма (source). Ошибки и состояние генерации считаются здесь же.
export async function listPlans(limit = 100, now: Date = new Date()): Promise<PlanListItem[]> {
  const docs = await (await plans())
    .find(
      {},
      {
        projection: {
          _id: 1,
          leadId: 1,
          status: 1,
          createdBy: 1,
          createdAt: 1,
          updatedAt: 1,
          warnings: 1,
          generation: 1,
          "content.patient.name": 1,
        },
      },
    )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((doc) => ({
    id: doc._id.toString(),
    patientName: doc.content?.patient.name ?? "",
    status: doc.status,
    leadId: doc.leadId ? doc.leadId.toString() : null,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    errorCount: doc.warnings.filter((w) => w.level === "error").length,
    generationState: effectiveGeneration(doc.generation, now).state,
  }));
}

export async function deletePlan(id: string): Promise<boolean> {
  const oid = toObjectId(id);
  if (!oid) return false;
  const res = await (await plans()).deleteOne({ _id: oid });
  return res.deletedCount > 0;
}

// Атомарно занимает генерацию: только если она не идёт (или зависла). null — другая генерация уже идёт.
export async function claimGeneration(id: string, now: Date = new Date()): Promise<TreatmentPlan | null> {
  const oid = toObjectId(id);
  if (!oid) return null;
  const doc = await (await plans()).findOneAndUpdate(
    { _id: oid, ...idleOrStale(now) },
    { $set: { generation: { state: "running", startedAt: now.toISOString() } } },
    { returnDocument: "after" },
  );
  return doc ? toPlan(doc) : null;
}

// Результат генерации записывается, только если запуск с этим startedAt всё ещё текущий. false — поздний ответ, отброшен.
export async function completeGeneration(
  id: string,
  startedAt: string,
  p: { content: PlanContent; promptVersion: string; attempts: number; ms: number; model?: string; warnings: PlanWarning[] },
): Promise<boolean> {
  const oid = toObjectId(id);
  if (!oid) return false;
  const res = await (await plans()).updateOne(
    { _id: oid, "generation.state": "running", "generation.startedAt": startedAt },
    {
      $set: {
        content: p.content,
        aiDraft: p.content,
        status: "draft",
        warnings: p.warnings,
        generation: {
          state: "done",
          startedAt,
          ...(p.model ? { model: p.model } : {}),
          promptVersion: p.promptVersion,
          ms: p.ms,
          attempts: p.attempts,
        },
        updatedAt: new Date().toISOString(),
      },
      $unset: { review: "" },
      $inc: { version: 1 },
    },
  );
  return res.matchedCount > 0;
}

// Ошибка генерации записывается с тем же условием, что и результат. false — запуск уже не текущий.
export async function failGeneration(id: string, startedAt: string, error: string, attempts: number): Promise<boolean> {
  const oid = toObjectId(id);
  if (!oid) return false;
  const res = await (await plans()).updateOne(
    { _id: oid, "generation.state": "running", "generation.startedAt": startedAt },
    {
      $set: {
        "generation.state": "failed",
        "generation.error": error,
        "generation.attempts": attempts,
        updatedAt: new Date().toISOString(),
      },
    },
  );
  return res.matchedCount > 0;
}

// «Заполнить вручную»: пустой план становится черновиком с пустым содержимым. null — план не пустой или генерация идёт.
export async function startManualPlan(id: string, now: Date = new Date()): Promise<TreatmentPlan | null> {
  const oid = toObjectId(id);
  if (!oid) return null;
  const doc = await (await plans()).findOneAndUpdate(
    { _id: oid, status: "empty", ...idleOrStale(now) },
    {
      $set: {
        content: newPlanContent(),
        status: "draft",
        generation: { state: "idle" },
        updatedAt: now.toISOString(),
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  );
  return doc ? toPlan(doc) : null;
}

export type SavePlanResult =
  | { ok: true; plan: TreatmentPlan }
  | { ok: false; reason: "not-found" | "conflict" | "generating" };

// Сохранение правок. Порядок проверок: нет плана -> идёт генерация -> другая версия -> запись с фильтром по version.
// Правка содержимого или параметров возвращает проверенный план в черновик (leadId в PDF не печатается, поэтому не считается).
export async function savePlan(
  id: string,
  patch: { version: number; content?: PlanContent; options?: PlanOptions; leadId?: string | null; warnings: PlanWarning[] },
  now: Date = new Date(),
): Promise<SavePlanResult> {
  const oid = toObjectId(id);
  if (!oid) return { ok: false, reason: "not-found" };
  const coll = await plans();
  const doc = await coll.findOne({ _id: oid });
  if (!doc) return { ok: false, reason: "not-found" };
  const generation = effectiveGeneration(doc.generation, now);
  if (generation.state === "running") return { ok: false, reason: "generating" };
  if (doc.version !== patch.version) return { ok: false, reason: "conflict" };

  const set: Partial<TreatmentPlanDoc> = { warnings: patch.warnings, updatedAt: now.toISOString() };
  if (patch.content !== undefined) set.content = patch.content;
  if (patch.options !== undefined) set.options = patch.options;
  if (patch.leadId !== undefined) set.leadId = patch.leadId === null ? null : new ObjectId(patch.leadId);
  // Зависшая генерация переводится в failed в этой же записи (в ней же, а не отдельным запросом).
  if (doc.generation.state === "running") set.generation = generation;

  const editsContent = patch.content !== undefined || patch.options !== undefined;
  const unsetReview = doc.status === "reviewed" && editsContent;
  if (unsetReview) set.status = "draft";
  else if (doc.status === "empty" && patch.content !== undefined) set.status = "draft";

  const update: UpdateFilter<TreatmentPlanDoc> = { $set: set, $inc: { version: 1 } };
  if (unsetReview) update.$unset = { review: "" };

  // Фильтр по version и по отсутствию идущей генерации: генерация, начатая после чтения, не даёт перезаписать правки.
  const res = await coll.updateOne({ _id: oid, version: patch.version, ...idleOrStale(now) }, update);
  if (res.matchedCount === 0) return { ok: false, reason: "conflict" };

  const saved = await coll.findOne({ _id: oid });
  if (!saved) return { ok: false, reason: "not-found" };
  return { ok: true, plan: toPlan(saved) };
}

// «Отметить проверенным». Фильтр: черновик, содержимое есть и версия та, которую человек видел на экране.
export async function markReviewed(
  id: string,
  p: { version: number; by: string; confirmations: string[]; changedFields: number; warnings: PlanWarning[]; now?: Date },
): Promise<TreatmentPlan | null> {
  const oid = toObjectId(id);
  if (!oid) return null;
  const now = p.now ?? new Date();
  const doc = await (await plans()).findOneAndUpdate(
    { _id: oid, status: "draft", version: p.version, content: { $exists: true } },
    {
      $set: {
        status: "reviewed",
        review: { by: p.by, at: now.toISOString(), changedFields: p.changedFields, confirmations: p.confirmations },
        warnings: p.warnings,
        updatedAt: now.toISOString(),
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  );
  return doc ? toPlan(doc) : null;
}

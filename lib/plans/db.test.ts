import { ObjectId } from "mongodb";

import { getDb } from "@/lib/mongodb";
import { newPlanOptions } from "./defaults";
import {
  STALE_GENERATION_ERROR,
  claimGeneration,
  completeGeneration,
  createPlan,
  deletePlan,
  effectiveGeneration,
  failGeneration,
  getPlan,
  listPlans,
  markReviewed,
  savePlan,
  startManualPlan,
} from "./db";
import { fictionalContent } from "./test-fixtures";

jest.mock("@/lib/mongodb", () => ({ getDb: jest.fn() }));

const insertOne = jest.fn();
const findOne = jest.fn();
const toArray = jest.fn();
const limit = jest.fn();
const sort = jest.fn();
const find = jest.fn();
const updateOne = jest.fn();
const findOneAndUpdate = jest.fn();
const deleteOne = jest.fn();

const collection = { insertOne, findOne, find, updateOne, findOneAndUpdate, deleteOne };

const NOW = new Date("2026-10-09T05:00:00Z");
const ID = "665f1c2e9b1d4a0012ab34cd";
const WHO = "Тестовый координатор";

// Документ плана так, как он лежит в коллекции TreatmentPlans (вымышленные данные).
function docWith(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(ID),
    version: 1,
    status: "draft",
    source: { text: "letter", kind: "paste", sha256: "a".repeat(64) },
    options: newPlanOptions(NOW),
    warnings: [],
    generation: { state: "idle" },
    createdBy: WHO,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  find.mockReturnValue({ sort });
  sort.mockReturnValue({ limit });
  limit.mockReturnValue({ toArray });
  (getDb as jest.Mock).mockResolvedValue({ collection: () => collection });
});

describe("TreatmentPlans data layer", () => {
  it("createPlan inserts an empty plan with a hash of the letter", async () => {
    const plan = await createPlan({ sourceText: "letter text".padEnd(40, "."), sourceKind: "paste", createdBy: WHO, now: NOW });
    const doc = insertOne.mock.calls[0][0];
    expect(doc).toMatchObject({ status: "empty", version: 1, generation: { state: "idle" }, createdBy: WHO, warnings: [] });
    expect(doc.source.sha256).toHaveLength(64);
    expect(plan.id).toEqual(expect.any(String));
    expect(plan).toMatchObject({ status: "empty", version: 1, leadId: null });
  });

  it("getPlan returns null for a malformed id without touching the database", async () => {
    expect(await getPlan("not-an-id")).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it("listPlans excludes the letter text and reports errors and the effective generation state", async () => {
    toArray.mockResolvedValueOnce([
      docWith({
        content: { patient: { name: "Testov Test" } },
        warnings: [{ level: "error" }, { level: "warn" }],
        generation: { state: "running", startedAt: "2026-10-09T04:50:00.000Z" },
      }),
    ]);
    const [item] = await listPlans(100, NOW);
    expect(find.mock.calls[0][1].projection.source).toBeUndefined();
    expect(limit).toHaveBeenCalledWith(100);
    expect(item).toMatchObject({ patientName: "Testov Test", errorCount: 1, generationState: "failed" });
  });

  it("effectiveGeneration turns a 6-minute-old running job into failed and keeps a 2-minute-old one", () => {
    expect(effectiveGeneration({ state: "running", startedAt: "2026-10-09T04:54:00.000Z" }, NOW).state).toBe("failed");
    expect(effectiveGeneration({ state: "running", startedAt: "2026-10-09T04:58:00.000Z" }, NOW).state).toBe("running");
  });

  it("claimGeneration claims only idle, failed or stale jobs", async () => {
    findOneAndUpdate.mockResolvedValueOnce(docWith({ generation: { state: "running", startedAt: NOW.toISOString() } }));
    const plan = await claimGeneration(ID, NOW);
    expect(findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      $or: [{ "generation.state": { $ne: "running" } }, { "generation.startedAt": { $lt: "2026-10-09T04:55:00.000Z" } }],
    });
    expect(findOneAndUpdate.mock.calls[0][2]).toMatchObject({ returnDocument: "after" });
    expect(plan?.generation.startedAt).toBe(NOW.toISOString());
    findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await claimGeneration(ID, NOW)).toBeNull();
  });

  // Review Focus №4: поздний ответ модели
  it("completeGeneration writes only for the generation that is still current", async () => {
    updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    const ok = await completeGeneration(ID, "2026-10-09T05:00:00.000Z", { content: fictionalContent(), promptVersion: "v", attempts: 1, ms: 5, warnings: [] });
    expect(ok).toBe(true);
    expect(updateOne.mock.calls[0][0]).toMatchObject({ "generation.state": "running", "generation.startedAt": "2026-10-09T05:00:00.000Z" });
    expect(updateOne.mock.calls[0][1]).toMatchObject({ $set: { status: "draft", generation: { state: "done" } }, $unset: { review: "" }, $inc: { version: 1 } });
    updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    expect(await completeGeneration(ID, "2026-10-09T04:00:00.000Z", { content: fictionalContent(), promptVersion: "v", attempts: 1, ms: 5, warnings: [] })).toBe(false);
  });

  it("failGeneration uses the same guard", async () => {
    updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    expect(await failGeneration(ID, "2026-10-09T04:00:00.000Z", "ошибка", 2)).toBe(false);
    expect(updateOne.mock.calls[0][0]).toMatchObject({ "generation.state": "running", "generation.startedAt": "2026-10-09T04:00:00.000Z" });
    expect(updateOne.mock.calls[0][1].$set).toMatchObject({ "generation.state": "failed", "generation.attempts": 2 });
  });

  it("startManualPlan works only for an empty plan without a fresh generation", async () => {
    findOneAndUpdate.mockResolvedValueOnce(docWith({ status: "draft" }));
    expect(await startManualPlan(ID, NOW)).not.toBeNull();
    expect(findOneAndUpdate.mock.calls[0][0]).toMatchObject({ status: "empty" });
    expect(findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ status: "draft", generation: { state: "idle" } });
    findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await startManualPlan(ID, NOW)).toBeNull();
  });

  // Review Focus №4
  it("savePlan: not-found, conflict on a stale version, generating while running — and no write in any of them", async () => {
    findOne.mockResolvedValueOnce(null);
    expect(await savePlan(ID, { version: 1, warnings: [] }, NOW)).toEqual({ ok: false, reason: "not-found" });
    findOne.mockResolvedValueOnce(docWith({ version: 5 }));
    expect(await savePlan(ID, { version: 4, warnings: [] }, NOW)).toEqual({ ok: false, reason: "conflict" });
    findOne.mockResolvedValueOnce(docWith({ version: 5, generation: { state: "running", startedAt: NOW.toISOString() } }));
    expect(await savePlan(ID, { version: 5, warnings: [] }, NOW)).toEqual({ ok: false, reason: "generating" });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("savePlan writes with a version filter and sends a reviewed plan back to draft", async () => {
    findOne.mockResolvedValueOnce(docWith({ version: 5, status: "reviewed", review: { by: WHO } }));
    updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    findOne.mockResolvedValueOnce(docWith({ version: 6, status: "draft" }));
    const r = await savePlan(ID, { version: 5, content: fictionalContent(), warnings: [] }, NOW);
    expect(updateOne.mock.calls[0][0]).toMatchObject({ version: 5 });
    expect(updateOne.mock.calls[0][1]).toMatchObject({ $set: { status: "draft" }, $unset: { review: "" }, $inc: { version: 1 } });
    expect(r).toMatchObject({ ok: true, plan: { version: 6, status: "draft" } });
  });

  it("savePlan reports conflict when another save wins the race (matchedCount 0)", async () => {
    findOne.mockResolvedValueOnce(docWith({ version: 5 }));
    updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    expect(await savePlan(ID, { version: 5, options: newPlanOptions(NOW), warnings: [] }, NOW)).toEqual({ ok: false, reason: "conflict" });
  });

  it("savePlan write is guarded against a generation that starts after the read", async () => {
    findOne.mockResolvedValueOnce(docWith({ version: 5 }));
    updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    expect(await savePlan(ID, { version: 5, content: fictionalContent(), warnings: [] }, NOW)).toEqual({ ok: false, reason: "conflict" });
    expect(updateOne.mock.calls[0][0]).toMatchObject({
      version: 5,
      $or: [{ "generation.state": { $ne: "running" } }, { "generation.startedAt": { $lt: "2026-10-09T04:55:00.000Z" } }],
    });
  });

  it("savePlan turns a stale running generation into failed in the same write", async () => {
    findOne.mockResolvedValueOnce(docWith({ version: 5, generation: { state: "running", startedAt: "2026-10-09T04:00:00.000Z" } }));
    updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    findOne.mockResolvedValueOnce(docWith({ version: 6 }));
    await savePlan(ID, { version: 5, content: fictionalContent(), warnings: [] }, NOW);
    expect(updateOne.mock.calls[0][1].$set.generation).toMatchObject({ state: "failed", error: STALE_GENERATION_ERROR });
  });

  it("markReviewed filters on status draft and the version the person saw", async () => {
    findOneAndUpdate.mockResolvedValueOnce(docWith({ status: "reviewed" }));
    await markReviewed(ID, { version: 7, by: WHO, confirmations: ["amounts", "clinics", "patient"], changedFields: 3, warnings: [], now: NOW });
    expect(findOneAndUpdate.mock.calls[0][0]).toMatchObject({ status: "draft", version: 7 });
    expect(findOneAndUpdate.mock.calls[0][1]).toMatchObject({ $set: { status: "reviewed", review: { by: WHO, changedFields: 3 } }, $inc: { version: 1 } });
    findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await markReviewed(ID, { version: 6, by: WHO, confirmations: [], changedFields: 0, warnings: [] })).toBeNull();
  });

  it("deletePlan reports whether something was deleted", async () => {
    deleteOne.mockResolvedValueOnce({ deletedCount: 1 });
    expect(await deletePlan(ID)).toBe(true);
    deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    expect(await deletePlan(ID)).toBe(false);
  });
});

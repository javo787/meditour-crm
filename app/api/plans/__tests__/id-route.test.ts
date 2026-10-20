import { testApiHandler } from "next-test-api-route-handler";

import { getLead } from "@/lib/db";
import { newPlanOptions } from "@/lib/plans/defaults";
import { deletePlan, getPlan, savePlan } from "@/lib/plans/db";
import type { TreatmentPlan } from "@/lib/plans/schema";
import { FICTIONAL_LETTER, fictionalContent } from "@/lib/plans/test-fixtures";
import { DELETE, GET, PATCH } from "../[id]/route";

jest.mock("@/lib/mongodb", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/db", () => ({ getLead: jest.fn() }));
// Проверки и эффективное состояние генерации остаются настоящими; подменяются только обращения к базе.
jest.mock("@/lib/plans/db", () => ({
  ...jest.requireActual("@/lib/plans/db"),
  getPlan: jest.fn(),
  savePlan: jest.fn(),
  deletePlan: jest.fn(),
}));

const lead = getLead as jest.Mock;
const getOne = getPlan as jest.Mock;
const save = savePlan as jest.Mock;
const remove = deletePlan as jest.Mock;

const ID = "665f1c2e9b1d4a0012ab34cd";
const LEAD_ID = "665f1c2e9b1d4a0012ab34ce";
const WHO = "Тестовый координатор";
const NOW = new Date("2026-10-09T05:00:00Z");

// Сохранённый план (вымышленные данные из тестовых фикстур).
const planWith = (over: Partial<TreatmentPlan> = {}): TreatmentPlan => ({
  id: ID,
  leadId: null,
  version: 3,
  status: "draft",
  source: { text: FICTIONAL_LETTER, kind: "paste", sha256: "x".repeat(64) },
  content: fictionalContent(),
  options: newPlanOptions(NOW),
  warnings: [],
  generation: { state: "done" },
  createdBy: WHO,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...over,
});

type Reply = { status: number; body: Record<string, unknown> | null };

// Один запрос к /api/plans/[id] указанным методом.
async function call(method: "GET" | "PATCH" | "DELETE", init: RequestInit = {}): Promise<Reply> {
  const out: Reply = { status: 0, body: null };
  await testApiHandler({
    appHandler: { GET, PATCH, DELETE },
    params: { id: ID },
    url: `/api/plans/${ID}`,
    test: async ({ fetch }) => {
      const res = await fetch({ method, ...init });
      out.status = res.status;
      out.body = res.status === 204 ? null : await res.json();
    },
  });
  return out;
}

const patch = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  jest.resetAllMocks();
  getOne.mockResolvedValue(planWith());
});

describe("GET /api/plans/[id]", () => {
  it("GET → 404 for an unknown id; otherwise the plan with source.text, the effective generation and the lead", async () => {
    getOne.mockResolvedValueOnce(null);
    expect(await call("GET")).toMatchObject({ status: 404 });

    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    getOne.mockResolvedValueOnce(planWith({ leadId: LEAD_ID, generation: { state: "running", startedAt: stale } }));
    lead.mockResolvedValueOnce({ id: LEAD_ID, name: "Тестов Тест" });
    const reply = await call("GET");
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      plan: { generation: { state: "failed" }, source: { text: FICTIONAL_LETTER } },
      lead: { id: LEAD_ID, name: "Тестов Тест" },
    });
    expect(lead).toHaveBeenCalledWith(LEAD_ID);
  });
});

describe("PATCH /api/plans/[id]", () => {
  // Review Focus №4
  it("PATCH: a stale version → 409 conflict, a running generation → 409 generating, 404 when missing", async () => {
    save.mockResolvedValueOnce({ ok: false, reason: "conflict" });
    expect(await call("PATCH", patch({ version: 2, options: newPlanOptions(NOW) }))).toEqual({
      status: 409,
      body: { error: expect.any(String), code: "conflict" },
    });

    save.mockResolvedValueOnce({ ok: false, reason: "generating" });
    expect(await call("PATCH", patch({ version: 3, options: newPlanOptions(NOW) }))).toEqual({
      status: 409,
      body: { error: expect.any(String), code: "generating" },
    });

    save.mockResolvedValueOnce({ ok: false, reason: "not-found" });
    expect(await call("PATCH", patch({ version: 3, options: newPlanOptions(NOW) }))).toMatchObject({ status: 404 });

    getOne.mockResolvedValueOnce(null);
    expect(await call("PATCH", patch({ version: 3, options: newPlanOptions(NOW) }))).toMatchObject({ status: 404 });
  });

  it("PATCH recomputes warnings from the stored letter and the CRM name before saving", async () => {
    getOne.mockResolvedValueOnce(planWith({ leadId: LEAD_ID }));
    lead.mockResolvedValueOnce({ id: LEAD_ID, name: "Иванов Иван" });
    save.mockResolvedValueOnce({ ok: true, plan: planWith({ version: 4 }) });
    const reply = await call("PATCH", patch({ version: 3, options: newPlanOptions(NOW) }));
    expect(reply.status).toBe(200);
    const [, saved] = save.mock.calls[0];
    expect(saved.warnings.map((w: { code: string }) => w.code)).toContain("name-mismatch");
    expect(lead).toHaveBeenCalledWith(LEAD_ID);
  });

  it("PATCH merges: sending only options keeps the stored content for the checks", async () => {
    save.mockResolvedValueOnce({ ok: true, plan: planWith({ version: 4 }) });
    await call("PATCH", patch({ version: 3, options: newPlanOptions(NOW) }));
    const [, saved] = save.mock.calls[0];
    expect(saved).toHaveProperty("options");
    expect(saved).not.toHaveProperty("content");
    // Предупреждения посчитаны по сохранённому содержимому: без него проверки вернули бы пустой список.
    expect(saved.warnings.map((w: { code: string }) => w.code)).toContain("clinics-unverified");
  });

  it("PATCH after review returns the plan with status draft", async () => {
    save.mockResolvedValueOnce({ ok: true, plan: planWith({ status: "draft", version: 8 }) });
    const reply = await call("PATCH", patch({ version: 7, content: fictionalContent() }));
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ plan: { status: "draft", version: 8 } });
  });

  it("PATCH with an unknown leadId → 404 lead-not-found and nothing is saved", async () => {
    lead.mockResolvedValueOnce(undefined);
    const reply = await call("PATCH", patch({ version: 3, leadId: LEAD_ID }));
    expect(reply).toEqual({ status: 404, body: { error: expect.any(String), code: "lead-not-found" } });
    expect(save).not.toHaveBeenCalled();
  });

  it("PATCH rejects bad bodies with 400: no version, no fields, cell over 300 characters, bad date", async () => {
    const longWhy = fictionalContent();
    longWhy.clinics[0].why = "а".repeat(301);
    const cases: RequestInit[] = [
      patch({ content: fictionalContent() }),
      patch({ version: 1 }),
      patch({ version: 3, content: longWhy }),
      patch({ version: 3, options: { ...newPlanOptions(NOW), date: "09.10.2026" } }),
    ];
    for (const init of cases) {
      expect((await call("PATCH", init)).status).toBe(400);
    }
    const withPath = await call("PATCH", cases[2]);
    // Путь — от корня тела запроса: поле внутри content.
    expect(withPath.body).toMatchObject({ code: "invalid", path: "content.clinics.0.why" });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/plans/[id]", () => {
  it("DELETE → 204, then 404 when nothing was deleted", async () => {
    remove.mockResolvedValueOnce(true);
    expect(await call("DELETE")).toEqual({ status: 204, body: null });
    remove.mockResolvedValueOnce(false);
    expect(await call("DELETE")).toMatchObject({ status: 404 });
  });
});

import { testApiHandler } from "next-test-api-route-handler";

import { getActorName } from "@/lib/plans/actor";
import { newPlanOptions } from "@/lib/plans/defaults";
import { getPlan, markReviewed, startManualPlan } from "@/lib/plans/db";
import { evaluatePlan } from "@/lib/plans/evaluate";
import { buildPlanPdf } from "@/lib/plans/pdf";
import { kickPlanGeneration } from "@/lib/plans/runner";
import type { PlanWarning, TreatmentPlan } from "@/lib/plans/schema";
import { FICTIONAL_LETTER, fictionalContent } from "@/lib/plans/test-fixtures";
import { POST as generatePost } from "../[id]/generate/route";
import { GET as pdfGet } from "../[id]/pdf/route";
import { POST as reviewPost } from "../[id]/review/route";

jest.mock("@/lib/mongodb", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/db", () => ({ getLead: jest.fn() }));
jest.mock("@/lib/plans/actor", () => ({ getActorName: jest.fn() }));
// Проверки и эффективное состояние генерации остаются настоящими; подменяются только обращения к базе и внешним частям.
jest.mock("@/lib/plans/db", () => ({
  ...jest.requireActual("@/lib/plans/db"),
  getPlan: jest.fn(),
  startManualPlan: jest.fn(),
  markReviewed: jest.fn(),
}));
jest.mock("@/lib/plans/evaluate", () => ({
  ...jest.requireActual("@/lib/plans/evaluate"),
  evaluatePlan: jest.fn(),
}));
jest.mock("@/lib/plans/runner", () => ({
  ...jest.requireActual("@/lib/plans/runner"),
  kickPlanGeneration: jest.fn(),
}));
jest.mock("@/lib/plans/pdf", () => ({
  ...jest.requireActual("@/lib/plans/pdf"),
  buildPlanPdf: jest.fn(),
}));

const getOne = getPlan as jest.Mock;
const manual = startManualPlan as jest.Mock;
const review = markReviewed as jest.Mock;
const evaluate = evaluatePlan as jest.Mock;
const kick = kickPlanGeneration as jest.Mock;
const actor = getActorName as jest.Mock;
const buildPdf = buildPlanPdf as jest.Mock;

const ID = "665f1c2e9b1d4a0012ab34cd";
const WHO = "Тестовый координатор";
const NOW = new Date("2026-10-09T05:00:00Z");
const FRESH = () => new Date(Date.now() - 60 * 1000).toISOString();

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

// Копия содержимого с одним изменённым полем: «правка координатора» относительно черновика модели.
const editedCopy = (base: ReturnType<typeof fictionalContent>) => ({ ...base, notIncluded: "Другой текст о невключённом" });

type Reply = { status: number; body: Record<string, unknown> | null };

// Один POST с JSON-телом к маршруту с параметром id.
async function postJson(route: "generate" | "review", body: unknown): Promise<Reply> {
  const out: Reply = { status: 0, body: null };
  await testApiHandler({
    appHandler: { POST: route === "generate" ? generatePost : reviewPost },
    params: { id: ID },
    url: `/api/plans/${ID}/${route}`,
    test: async ({ fetch }) => {
      const res = await fetch({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      out.status = res.status;
      out.body = await res.json();
    },
  });
  return out;
}

type PdfReply = {
  status: number;
  contentType: string | null;
  disposition: string | null;
  cacheControl: string | null;
  text: string;
  body: Record<string, unknown> | null;
};

// Один GET к PDF: заголовки и тело (для ошибок тело — JSON).
async function getPdf(query = ""): Promise<PdfReply> {
  const out: PdfReply = { status: 0, contentType: null, disposition: null, cacheControl: null, text: "", body: null };
  await testApiHandler({
    appHandler: { GET: pdfGet },
    params: { id: ID },
    url: `/api/plans/${ID}/pdf${query}`,
    test: async ({ fetch }) => {
      const res = await fetch({ method: "GET" });
      out.status = res.status;
      out.contentType = res.headers.get("content-type");
      out.disposition = res.headers.get("content-disposition");
      out.cacheControl = res.headers.get("cache-control");
      const text = await res.text();
      out.text = text;
      out.body = res.headers.get("content-type")?.startsWith("application/json") ? JSON.parse(text) : null;
    },
  });
  return out;
}

beforeEach(() => {
  jest.resetAllMocks();
  getOne.mockResolvedValue(planWith());
  actor.mockResolvedValue(WHO);
});

describe("POST /api/plans/[id]/generate", () => {
  it("generate: manual fill, running guard, has-edits guard, overwrite", async () => {
    // Заполнение вручную: пустой план становится черновиком.
    getOne.mockResolvedValueOnce(planWith({ status: "empty", content: undefined, generation: { state: "idle" } }));
    manual.mockResolvedValueOnce(planWith({ status: "draft", version: 4, content: fictionalContent() }));
    expect(await postJson("generate", { manual: true })).toEqual({ status: 200, body: { state: "manual" } });
    expect(manual).toHaveBeenCalledWith(ID);
    expect(kick).not.toHaveBeenCalled();

    // Заполнение вручную на непустом плане: startManualPlan вернул null — 409 not-empty.
    getOne.mockResolvedValueOnce(planWith({ status: "draft" }));
    manual.mockResolvedValueOnce(null);
    expect(await postJson("generate", { manual: true })).toEqual({
      status: 409,
      body: { error: expect.any(String), code: "not-empty" },
    });

    // Свежая генерация идёт: 409 running, запуск не повторяется.
    getOne.mockResolvedValueOnce(planWith({ generation: { state: "running", startedAt: FRESH() } }));
    expect(await postJson("generate", {})).toEqual({ status: 409, body: { error: expect.any(String), code: "running" } });
    expect(kick).not.toHaveBeenCalled();

    // Есть правки координатора (content отличается от черновика модели): без overwrite — 409 has-edits.
    const content = fictionalContent();
    getOne.mockResolvedValueOnce(planWith({ content: editedCopy(content), aiDraft: content }));
    expect(await postJson("generate", {})).toEqual({
      status: 409,
      body: { error: expect.any(String), code: "has-edits" },
    });
    expect(kick).not.toHaveBeenCalled();

    // С overwrite:true правки заменяются: 202 и запуск генерации для этого плана.
    getOne.mockResolvedValueOnce(planWith({ content: editedCopy(content), aiDraft: content }));
    expect(await postJson("generate", { overwrite: true })).toEqual({ status: 202, body: { state: "running" } });
    expect(kick).toHaveBeenCalledWith(ID);
    kick.mockClear();

    // Правок нет (content совпадает с черновиком модели): без overwrite — 202.
    getOne.mockResolvedValueOnce(planWith({ content: fictionalContent(), aiDraft: fictionalContent() }));
    expect(await postJson("generate", {})).toEqual({ status: 202, body: { state: "running" } });
    expect(kick).toHaveBeenCalledWith(ID);
  });

  it("generate: an unknown id → 404 and nothing is started", async () => {
    getOne.mockResolvedValueOnce(null);
    expect(await postJson("generate", {})).toEqual({ status: 404, body: { error: expect.any(String) } });
    expect(kick).not.toHaveBeenCalled();
    expect(manual).not.toHaveBeenCalled();
  });
});

describe("POST /api/plans/[id]/review", () => {
  it("review: needs exactly the three confirmations (400 otherwise)", async () => {
    expect(await postJson("review", { version: 3, confirmations: ["amounts", "clinics"] })).toEqual({
      status: 400,
      body: { error: expect.any(String), code: "confirmations" },
    });
    expect(await postJson("review", { version: 3, confirmations: ["amounts", "clinics", "patient", "x"] })).toEqual({
      status: 400,
      body: { error: expect.any(String), code: "confirmations" },
    });
    // Повтор одного ключа вместо третьего тоже не проходит.
    expect(await postJson("review", { version: 3, confirmations: ["amounts", "amounts", "patient"] })).toEqual({
      status: 400,
      body: { error: expect.any(String), code: "confirmations" },
    });
    expect(review).not.toHaveBeenCalled();
  });

  // Review Focus №4
  it("review: the version the person saw must still be the current one", async () => {
    getOne.mockResolvedValueOnce(planWith({ version: 7 }));
    expect(
      await postJson("review", { version: 6, confirmations: ["amounts", "clinics", "patient"] }),
    ).toEqual({ status: 409, body: { error: expect.any(String), code: "conflict" } });
    expect(review).not.toHaveBeenCalled();
  });

  it("review: error warnings block it, and they are recomputed, not read from storage", async () => {
    // В базе сохранены пустые предупреждения, а пересчёт находит ошибку и информационное замечание.
    getOne.mockResolvedValueOnce(planWith({ version: 7, warnings: [] }));
    const computed: PlanWarning[] = [
      { code: "money-missing", level: "error", message: "В письме есть сумма 6800 USD, а в плане её нет" },
      { code: "long-cell", level: "info", message: "Слишком длинный текст в ячейке" },
    ];
    evaluate.mockResolvedValueOnce(computed);
    const reply = await postJson("review", { version: 7, confirmations: ["amounts", "clinics", "patient"] });
    expect(reply).toEqual({
      status: 409,
      body: {
        error: expect.any(String),
        code: "blocked",
        warnings: [{ code: "money-missing", level: "error", message: expect.any(String) }],
      },
    });
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ sourceText: FICTIONAL_LETTER }));
    expect(review).not.toHaveBeenCalled();
  });

  it("review: success stores who confirmed and how many fields were changed", async () => {
    // Два поля отличаются от черновика модели: notIncluded и condition.
    const draft = fictionalContent();
    const content = fictionalContent();
    content.notIncluded = "Другой текст о невключённом";
    content.profile.condition = "камни в мочеточнике";
    getOne.mockResolvedValueOnce(planWith({ version: 7, content, aiDraft: draft }));
    const warnings: PlanWarning[] = [{ code: "clinics-unverified", level: "warn", message: "Клиники не проверены" }];
    evaluate.mockResolvedValueOnce(warnings);
    review.mockResolvedValueOnce(planWith({ version: 8, status: "reviewed" }));

    const reply = await postJson("review", { version: 7, confirmations: ["amounts", "clinics", "patient"] });

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ plan: { status: "reviewed", version: 8 } });
    expect(review).toHaveBeenCalledWith(ID, {
      version: 7,
      by: WHO,
      changedFields: 2,
      confirmations: ["amounts", "clinics", "patient"],
      warnings,
    });
  });

  it("review: the plan changed between the check and the write → 409 conflict", async () => {
    evaluate.mockResolvedValueOnce([]);
    review.mockResolvedValueOnce(null);
    expect(await postJson("review", { version: 3, confirmations: ["amounts", "clinics", "patient"] })).toEqual({
      status: 409,
      body: { error: expect.any(String), code: "conflict" },
    });
  });

  it("review: not a draft, or a generation in progress → 409", async () => {
    const three = { version: 3, confirmations: ["amounts", "clinics", "patient"] };

    getOne.mockResolvedValueOnce(planWith({ status: "reviewed" }));
    expect(await postJson("review", three)).toEqual({ status: 409, body: { error: expect.any(String), code: "not-draft" } });

    getOne.mockResolvedValueOnce(planWith({ status: "empty", content: undefined }));
    expect(await postJson("review", three)).toEqual({ status: 409, body: { error: expect.any(String), code: "not-draft" } });

    getOne.mockResolvedValueOnce(planWith({ generation: { state: "running", startedAt: FRESH() } }));
    expect(await postJson("review", three)).toEqual({ status: 409, body: { error: expect.any(String), code: "running" } });

    expect(review).not.toHaveBeenCalled();
  });
});

describe("GET /api/plans/[id]/pdf", () => {
  it("pdf: the DRAFT suffix for drafts, none for reviewed; download=1 switches to attachment; no-store", async () => {
    buildPdf.mockResolvedValue(Buffer.from("%PDF-test"));

    const draft = planWith({ status: "draft" });
    getOne.mockResolvedValueOnce(draft);
    const inlineDraft = await getPdf();
    expect(inlineDraft).toMatchObject({
      status: 200,
      contentType: "application/pdf",
      cacheControl: "no-store",
      disposition: 'inline; filename="Plan_Testov_Test_2026-10-09_DRAFT.pdf"',
      text: "%PDF-test",
    });
    expect(buildPdf).toHaveBeenCalledWith({ content: draft.content, options: draft.options, status: "draft" });

    getOne.mockResolvedValueOnce(planWith({ status: "reviewed" }));
    const reviewed = await getPdf();
    expect(reviewed.disposition).toBe('inline; filename="Plan_Testov_Test_2026-10-09.pdf"');

    getOne.mockResolvedValueOnce(planWith({ status: "draft" }));
    const download = await getPdf("?download=1");
    expect(download.disposition).toBe('attachment; filename="Plan_Testov_Test_2026-10-09_DRAFT.pdf"');
    expect(download.cacheControl).toBe("no-store");
  });

  it("pdf: a plan without content → 409 no-content, an unknown id → 404", async () => {
    getOne.mockResolvedValueOnce(planWith({ status: "empty", content: undefined }));
    expect(await getPdf()).toMatchObject({ status: 409, body: { error: expect.any(String), code: "no-content" } });

    getOne.mockResolvedValueOnce(null);
    expect(await getPdf()).toMatchObject({ status: 404 });

    expect(buildPdf).not.toHaveBeenCalled();
  });
});

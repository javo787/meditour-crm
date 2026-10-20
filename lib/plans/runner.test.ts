import { getLead } from "@/lib/db";
import { newPlanOptions } from "./defaults";
import { claimGeneration, completeGeneration, failGeneration } from "./db";
import { GENERATION_TIMEOUT_MS, kickPlanGeneration, runPlanGeneration } from "./runner";
import { PlanGenerationError, generatePlanDraft } from "./generate";
import type { PlanWarning, TreatmentPlan } from "./schema";
import { FICTIONAL_LETTER, fictionalDraft } from "./test-fixtures";

jest.mock("@/lib/mongodb", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/db", () => ({ getLead: jest.fn() }));
jest.mock("@/lib/plans/db", () => ({
  ...jest.requireActual("@/lib/plans/db"),
  claimGeneration: jest.fn(),
  completeGeneration: jest.fn(),
  failGeneration: jest.fn(),
}));
jest.mock("@/lib/plans/generate", () => ({
  ...jest.requireActual("@/lib/plans/generate"),
  generatePlanDraft: jest.fn(),
}));
// Один общий логгер на все createLogger(): тихо и можно проверить, что попало в журнал.
jest.mock("@/lib/logger", () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return { createLogger: () => logger, newRequestId: () => "req-test" };
});

const mockedGetLead = getLead as jest.Mock;
const claim = claimGeneration as jest.Mock;
const complete = completeGeneration as jest.Mock;
const fail = failGeneration as jest.Mock;
const generate = generatePlanDraft as jest.Mock;
const logger = (jest.requireMock("@/lib/logger") as { createLogger: () => Record<"info" | "warn" | "error", jest.Mock> }).createLogger();

const ID = "665f1c2e9b1d4a0012ab34cd";
const NOW = new Date("2026-10-09T05:00:00Z");
const STARTED = "2026-10-09T05:00:00.000Z";
const WHO = "Тестовый координатор";

// План в состоянии «генерация идёт» (вымышленное письмо из тестовых фикстур).
const claimedPlan = (over: Partial<TreatmentPlan> = {}) =>
  ({
    id: ID,
    leadId: null,
    version: 2,
    status: "empty",
    options: newPlanOptions(NOW),
    warnings: [],
    source: { text: FICTIONAL_LETTER, kind: "paste", sha256: "x" },
    generation: { state: "running", startedAt: STARTED },
    createdBy: WHO,
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as TreatmentPlan;

beforeEach(() => {
  jest.clearAllMocks();
  claim.mockResolvedValue(claimedPlan());
  generate.mockResolvedValue({ draft: fictionalDraft(), model: "gemini-test", promptVersion: "v1", attempts: 1, ms: 10 });
  complete.mockResolvedValue(true);
  fail.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("runPlanGeneration", () => {
  it("success: completes with warnings and takes the CRM spelling of a matching name", async () => {
    claim.mockResolvedValueOnce(claimedPlan({ leadId: "665f1c2e9b1d4a0012ab34ce" }));
    mockedGetLead.mockResolvedValue({ id: "l1", name: "Тестов Тест" });
    await runPlanGeneration(ID);
    const [, startedAt, payload] = complete.mock.calls[0];
    expect(startedAt).toBe(STARTED);
    expect(payload.content.patient.name).toBe("Тестов Тест");
    expect(payload.attempts).toBe(1);
    expect(payload.model).toBe("gemini-test");
    const codes = payload.warnings.map((w: PlanWarning) => w.code);
    expect(codes).not.toContain("name-mismatch");
    expect(codes).not.toContain("patient-name-translit");
    expect(fail).not.toHaveBeenCalled();
  });

  it("a mismatching lead keeps the letter's name and the stored warnings contain name-mismatch", async () => {
    claim.mockResolvedValueOnce(claimedPlan({ leadId: "665f1c2e9b1d4a0012ab34ce" }));
    mockedGetLead.mockResolvedValue({ id: "l1", name: "Иванов Иван" });
    await runPlanGeneration(ID);
    const payload = complete.mock.calls[0][2];
    expect(payload.content.patient.name).toBe("Testov Test");
    expect(payload.warnings.map((w: PlanWarning) => w.code)).toContain("name-mismatch");
  });

  it("claim refused → the model is not called", async () => {
    claim.mockResolvedValueOnce(null);
    await runPlanGeneration(ID);
    expect(generate).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("generator failure → failGeneration with the message and attempts; unknown errors get a generic text", async () => {
    generate.mockRejectedValueOnce(new Error("Gemini API вернул 500: секрет"));
    await runPlanGeneration(ID);
    expect(fail).toHaveBeenCalledWith(ID, STARTED, "Не удалось получить ответ модели. Повторите попытку.", expect.any(Number));
    // В журнале не должно быть текста ошибки модели (там может оказаться что угодно).
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("секрет");

    generate.mockRejectedValueOnce(new PlanGenerationError("Модель вернула ответ, который не удалось разобрать", 2));
    await runPlanGeneration(ID);
    expect(fail).toHaveBeenLastCalledWith(ID, STARTED, "Модель вернула ответ, который не удалось разобрать", 2);
  });

  // Review Focus №4: поздний ответ модели
  it("a late result that completeGeneration refuses is dropped without an error", async () => {
    complete.mockResolvedValueOnce(false);
    await expect(runPlanGeneration(ID)).resolves.toBeUndefined();
    expect(fail).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("результат отброшен"), expect.anything());
  });

  it("a hung model call fails after the timeout", async () => {
    jest.useFakeTimers();
    generate.mockReturnValueOnce(new Promise(() => {}));
    const run = runPlanGeneration(ID);
    await jest.advanceTimersByTimeAsync(GENERATION_TIMEOUT_MS + 1);
    await run;
    expect(fail).toHaveBeenCalledWith(ID, STARTED, "Модель не ответила за 4 минуты", expect.any(Number));
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("kickPlanGeneration", () => {
  it("returns immediately and never throws; a failure is only logged", async () => {
    claim.mockRejectedValueOnce(new Error("db down"));
    expect(() => kickPlanGeneration(ID)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.anything());
  });
});

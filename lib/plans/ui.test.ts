import {
  canSubmitPlan,
  formatPlanDateTime,
  isDocxName,
  sectionOfPath,
  sourceCounter,
  statusLabel,
  warningCounts,
} from "./ui";
import type { PlanWarning } from "./schema";

describe("statusLabel", () => {
  it("statusLabel", () => {
    expect(statusLabel("empty", "idle")).toBe("Нет черновика");
    expect(statusLabel("empty", "running")).toBe("Читаю письмо…");
    expect(statusLabel("empty", "failed")).toBe("Не удалось разобрать");
    expect(statusLabel("draft", "done")).toBe("Черновик");
    expect(statusLabel("reviewed", "done")).toBe("Проверено");
  });

  it("черновик и проверенный план не зависят от состояния генерации", () => {
    expect(statusLabel("draft", "running")).toBe("Черновик");
    expect(statusLabel("draft", "failed")).toBe("Черновик");
    expect(statusLabel("reviewed", "running")).toBe("Проверено");
  });
});

describe("warningCounts", () => {
  it("warningCounts", () => {
    const w = [
      { code: "a", level: "error", message: "" },
      { code: "b", level: "warn", message: "" },
      { code: "c", level: "warn", message: "" },
    ] as PlanWarning[];
    expect(warningCounts(w)).toEqual({ error: 1, warn: 2, info: 0 });
  });

  it("пустой список и info", () => {
    expect(warningCounts([])).toEqual({ error: 0, warn: 0, info: 0 });
    const w: PlanWarning[] = [
      { code: "x", level: "info", message: "" },
      { code: "y", level: "error", message: "" },
      { code: "z", level: "error", message: "" },
    ];
    expect(warningCounts(w)).toEqual({ error: 2, warn: 0, info: 1 });
  });
});

describe("sectionOfPath", () => {
  it.each([
    ["costs.groups[0].rows[1].amount", "costs"],
    ["patient.name", "patient"],
    ["profile.condition", "patient"],
    ["notIncluded", "included"],
    ["fixed.support[1]", "included"],
    ["tactic.items[0].text", "tactic"],
    ["fixed.tacticDisclaimer", "tactic"],
    ["options.clinicsVerifiedMonth", "clinics"],
    ["options.clinicsVerifiedOnSites", "clinics"],
    ["fixed.flights.checkedOn", "stay"],
    ["fixed.costFootnote", "costs"],
    ["fixed.nextSteps[2]", "nextSteps"],
    ["options.date", "settings"],
    ["options.showPageNumbers", "settings"],
    ["options.diagnosisHeading", "diagnosis"],
    ["clinics", "clinics"],
    ["stay", "stay"],
    ["overview[0]", "overview"],
    ["indiaSteps[1].text", "indiaSteps"],
    ["documents", "documents"],
    ["approach", "approach"],
    ["diagnosis.text", "diagnosis"],
    [undefined, "general"],
    ["", "general"],
    ["somethingElse", "general"],
    ["options.unknownKey", "general"],
    ["fixed.unknownKey", "general"],
    ["constructor", "general"],
    ["toString", "general"],
  ])("sectionOfPath(%j) → %j", (path, section) => {
    expect(sectionOfPath(path)).toBe(section);
  });
});

describe("sourceCounter", () => {
  it("показывает длину как вставлено, с пробелами в тысячах", () => {
    expect(sourceCounter(0).label).toBe("0 / 40 000");
    expect(sourceCounter(12345).label).toBe("12 345 / 40 000");
    expect(sourceCounter(40000).label).toBe("40 000 / 40 000");
  });

  it("отмечает превышение лимита со 40 001 символа", () => {
    expect(sourceCounter(40000).over).toBe(false);
    expect(sourceCounter(40001).over).toBe(true);
    expect(sourceCounter(40001).label).toBe("40 001 / 40 000");
  });
});

describe("canSubmitPlan", () => {
  it("нужен текст или файл, и не во время запроса", () => {
    expect(canSubmitPlan({ text: "", hasFile: false, busy: false })).toBe(false);
    expect(canSubmitPlan({ text: "   \n  ", hasFile: false, busy: false })).toBe(false);
    expect(canSubmitPlan({ text: "Письмо", hasFile: false, busy: false })).toBe(true);
    expect(canSubmitPlan({ text: "", hasFile: true, busy: false })).toBe(true);
    expect(canSubmitPlan({ text: "Письмо", hasFile: false, busy: true })).toBe(false);
    expect(canSubmitPlan({ text: "", hasFile: true, busy: true })).toBe(false);
  });

  it("текст длиннее 40 000 символов не отправляется; с файлом текст не учитывается", () => {
    const tooLong = "а".repeat(40001);
    expect(canSubmitPlan({ text: tooLong, hasFile: false, busy: false })).toBe(false);
    expect(canSubmitPlan({ text: tooLong, hasFile: true, busy: false })).toBe(true);
  });
});

describe("formatPlanDateTime", () => {
  it("переводит время в Asia/Dushanbe (UTC+5)", () => {
    expect(formatPlanDateTime("2026-10-20T09:30:00Z")).toBe("20.10.2026 14:30");
    expect(formatPlanDateTime("2026-10-19T22:00:00Z")).toBe("20.10.2026 03:00");
  });
});

describe("isDocxName", () => {
  it("принимает только имена, оканчивающиеся на .docx без учёта регистра", () => {
    expect(isDocxName("letter.docx")).toBe(true);
    expect(isDocxName("LETTER.DOCX")).toBe(true);
    expect(isDocxName("letter.doc")).toBe(false);
    expect(isDocxName("letter.docx.exe")).toBe(false);
    expect(isDocxName("letter.pdf")).toBe(false);
  });
});

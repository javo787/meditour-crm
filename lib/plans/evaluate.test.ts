import { getLead } from "@/lib/db";
import { newPlanOptions } from "./defaults";
import { evaluatePlan } from "./evaluate";
import { fictionalContent, FICTIONAL_LETTER } from "./test-fixtures";

jest.mock("@/lib/db", () => ({ getLead: jest.fn() }));

const mockedGetLead = getLead as jest.Mock;
const NOW = new Date("2026-10-09T05:00:00Z");

beforeEach(() => {
  jest.resetAllMocks();
});

describe("evaluatePlan", () => {
  it("returns [] when there is no content", async () => {
    expect(await evaluatePlan({ sourceText: FICTIONAL_LETTER, leadId: null, options: newPlanOptions(NOW) })).toEqual([]);
  });

  it("checks against the letter and reads the lead name from the CRM when no name is passed", async () => {
    mockedGetLead.mockResolvedValueOnce({ id: "l1", name: "Иванов Иван" });
    const w = await evaluatePlan({
      sourceText: FICTIONAL_LETTER,
      leadId: "l1",
      content: fictionalContent(),
      options: newPlanOptions(NOW),
      now: NOW,
    });
    expect(w.map((x) => x.code)).toContain("name-mismatch");
    expect(mockedGetLead).toHaveBeenCalledWith("l1");
  });

  it("does not call getLead when the name is passed in or there is no lead", async () => {
    const withName = await evaluatePlan({
      sourceText: FICTIONAL_LETTER,
      leadId: "l1",
      leadName: "Тестов Тест",
      content: fictionalContent(),
      options: newPlanOptions(NOW),
      now: NOW,
    });
    const noLead = await evaluatePlan({
      sourceText: FICTIONAL_LETTER,
      leadId: null,
      content: fictionalContent(),
      options: newPlanOptions(NOW),
      now: NOW,
    });
    expect(mockedGetLead).not.toHaveBeenCalled();
    expect(withName.map((x) => x.code)).not.toContain("name-mismatch");
    expect(noLead.map((x) => x.code)).not.toContain("name-mismatch");
  });
});

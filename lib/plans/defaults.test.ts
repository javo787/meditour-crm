import { BRAND, defaultFixed, newPlanContent, newPlanOptions, unverifiedClinicsNote, verifiedClinicsNote } from "./defaults";
import { planContentSchema, planDraftSchema } from "./schema";
import { FICTIONAL_LETTER, fictionalContent, fictionalDraft, fullContent } from "./test-fixtures";

describe("defaultFixed", () => {
  it("has four support points, six next steps ending with ЛЕЧЕНИЕ, the flight and an empty check date", () => {
    const fixed = defaultFixed();
    expect(fixed.support).toHaveLength(4);
    expect(fixed.nextSteps).toHaveLength(6);
    expect(fixed.nextSteps[5]).toBe("ЛЕЧЕНИЕ");
    expect(fixed.flights.text).toContain("SZ109");
    expect(fixed.flights.checkedOn).toBe("");
  });
});

describe("plan content", () => {
  it("the empty, fictional and full plans pass the strict content schema", () => {
    expect(planContentSchema.safeParse(newPlanContent()).success).toBe(true);
    expect(planContentSchema.safeParse(fictionalContent()).success).toBe(true);
    expect(planContentSchema.safeParse(fullContent()).success).toBe(true);
  });

  it("the fictional draft passes the lenient draft schema", () => {
    expect(planDraftSchema.safeParse(fictionalDraft()).success).toBe(true);
  });

  it("every evidence quote in the fictional draft is a verbatim line of the letter", () => {
    const quotes = fictionalDraft().costs.groups.flatMap((group) => group.rows.map((row) => row.evidence));
    expect(quotes).toHaveLength(5);
    for (const quote of quotes) expect(FICTIONAL_LETTER).toContain(quote);
  });

  it("no string of the fictional draft is longer than a table cell can hold (240 characters)", () => {
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(fictionalDraft());
    expect(Math.max(...strings.map((s) => s.length))).toBeLessThanOrEqual(240);
  });
});

describe("options, notes and brand", () => {
  it("newPlanOptions takes today's date in Dushanbe time", () => {
    expect(newPlanOptions(new Date("2026-10-08T20:30:00Z")).date).toBe("2026-10-09");
  });

  it("verifiedClinicsNote names the verification month and speaks of doctors only when the table has them", () => {
    expect(verifiedClinicsNote("2026-09", true)).toContain(
      "Врачи и госпитали указаны по итогам проверки актуальной информации на официальных сайтах клиник (сентябрь 2026 г.)",
    );
    expect(verifiedClinicsNote("2026-09", false)).toContain(
      "Госпитали указаны по итогам проверки актуальной информации на официальных сайтах клиник (сентябрь 2026 г.)",
    );
    expect(verifiedClinicsNote("2026-09", false)).not.toContain("Врачи");
    for (const hasDoctors of [true, false]) {
      expect(verifiedClinicsNote("2026-09", hasDoctors)).toContain(
        "Итоговое медицинское заключение и состав лечащей команды определяются госпиталем после очной оценки пациента.",
      );
    }
  });

  it("unverifiedClinicsNote speaks of doctors only when the table has them", () => {
    expect(unverifiedClinicsNote(true)).toContain("Врачи и госпитали указаны по информации принимающей стороны.");
    expect(unverifiedClinicsNote(false)).toContain("Госпитали указаны по информации принимающей стороны.");
    expect(unverifiedClinicsNote(false)).not.toContain("Врачи");
  });

  it("the brand footer keeps the confirmed phone number", () => {
    expect(BRAND.footer).toContain("(+992) 00 550 77 77");
  });
});

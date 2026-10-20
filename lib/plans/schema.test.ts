import {
  PLAN_LIMITS, PLAN_RESPONSE_SCHEMA, planContentSchema, planDraftSchema, planOptionsSchema, type PlanContent,
} from "@/lib/plans/schema";

// Локальный помощник: пустой, но валидный PlanContent (общие фикстуры появятся в Задаче 3).
function validContent(): PlanContent {
  return {
    language: "ru",
    patient: { name: "", gender: "unknown" },
    profile: { specialty: "", condition: "" },
    overview: [],
    diagnosis: { text: "", state: "", tactic: "", status: "" },
    indiaSteps: [],
    tactic: { intro: "", items: [] },
    documents: { title: "", items: [] },
    approach: { title: "", paragraphs: [], items: [], note: "" },
    clinics: [],
    costs: { groups: [], footnote: "" },
    stay: { rows: [], note: "" },
    included: [],
    notIncluded: "",
    letterIssues: [],
    fixed: {
      tacticDisclaimer: "", costFootnote: "",
      flights: { enabled: false, from: "", to: "", text: "", checkedOn: "" },
      support: [], nextSteps: [],
    },
  };
}
const clinic = (over: Partial<PlanContent["clinics"][number]> = {}) => ({
  id: "c1", name: "A", shortName: "A", city: "", area: "", doctor: "", why: "", ...over,
});

describe("planContentSchema", () => {
  it("accepts an empty content", () => {
    expect(planContentSchema.safeParse(validContent()).success).toBe(true);
  });

  it("accepts an overview item of exactly 400 characters and rejects 401", () => {
    expect(planContentSchema.safeParse({ ...validContent(), overview: ["x".repeat(400)] }).success).toBe(true);
    expect(planContentSchema.safeParse({ ...validContent(), overview: ["x".repeat(401)] }).success).toBe(false);
  });

  it("rejects a table cell over 300 characters and names the field", () => {
    const r = planContentSchema.safeParse({ ...validContent(), clinics: [clinic({ why: "x".repeat(301) })] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path.join(".")).toBe("clinics.0.why");
  });

  it("allows 30 clinics and rejects 31", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => clinic({ id: `c${i + 1}` }));
    expect(planContentSchema.safeParse({ ...validContent(), clinics: many(30) }).success).toBe(true);
    expect(planContentSchema.safeParse({ ...validContent(), clinics: many(31) }).success).toBe(false);
  });

  it("rejects an unknown gender and a malformed flights date", () => {
    expect(planContentSchema.safeParse({ ...validContent(), patient: { name: "", gender: "x" } }).success).toBe(false);
    const c = validContent();
    c.fixed.flights.checkedOn = "12.09.2026";
    expect(planContentSchema.safeParse(c).success).toBe(false);
  });
});

describe("planDraftSchema", () => {
  it("fills missing fields with empty values and has no language/fixed", () => {
    const d = planDraftSchema.parse({});
    expect(d.patient).toEqual({ name: "", gender: "unknown" });
    expect(d.overview).toEqual([]);
    expect(d.clinics).toEqual([]);
    expect(d.costs).toEqual({ groups: [], footnote: "" });
    expect(d).not.toHaveProperty("fixed");
    expect(d).not.toHaveProperty("language");
  });

  it("keeps the length limits", () => {
    expect(planDraftSchema.safeParse({ overview: ["x".repeat(401)] }).success).toBe(false);
  });
});

describe("planOptionsSchema", () => {
  const opts = { date: "2026-10-09", diagnosisHeading: "confirmed", clinicsVerifiedOnSites: false, clinicsVerifiedMonth: "", showPageNumbers: true };
  it("validates the date, the month and the heading", () => {
    expect(planOptionsSchema.safeParse(opts).success).toBe(true);
    expect(planOptionsSchema.safeParse({ ...opts, clinicsVerifiedMonth: "2026-09" }).success).toBe(true);
    expect(planOptionsSchema.safeParse({ ...opts, clinicsVerifiedMonth: "2026-13" }).success).toBe(false);
    expect(planOptionsSchema.safeParse({ ...opts, date: "09.10.2026" }).success).toBe(false);
    expect(planOptionsSchema.safeParse({ ...opts, diagnosisHeading: "other" }).success).toBe(false);
  });
});

describe("PLAN_RESPONSE_SCHEMA", () => {
  const keys = ["patient", "profile", "overview", "diagnosis", "indiaSteps", "tactic", "documents", "approach", "clinics", "costs", "stay", "included", "notIncluded", "letterIssues"];
  const schema = PLAN_RESPONSE_SCHEMA as any;

  it("mirrors the draft shape, in order", () => {
    expect(Object.keys(schema.properties)).toEqual(keys);
    expect(schema.required).toEqual(keys);
    expect(schema.propertyOrdering).toEqual(keys);
  });

  it("uses only UPPERCASE types (lowercase ones make Gemini answer 400)", () => {
    expect(JSON.stringify(schema)).not.toMatch(/"type":"(object|string|array|boolean|integer|number)"/);
  });

  it("price rows carry the evidence quote", () => {
    const rows = schema.properties.costs.properties.groups.items.properties.rows.items;
    expect(rows.required).toEqual(["label", "clinicId", "amount", "evidence"]);
  });
});

// ---------------------------------------------------------------------------
// Дальше — проверки сверх примеров из задачи: вся таблица лимитов (§5), значения по умолчанию
// внутри элементов массивов и соответствие схемы Gemini схеме zod.
// ---------------------------------------------------------------------------

/** По пути «clinics.0.why» строит { clinics: [{ why: value }] }: остальные поля мягкая схема заполнит сама. */
function nest(path: string, value: unknown): unknown {
  return path.split(".").reduceRight<unknown>((acc, key) => (/^\d+$/.test(key) ? [acc] : { [key]: acc }), value);
}
/** Путь первой ошибки мягкой схемы или null, если разбор прошёл. */
function draftIssuePath(raw: unknown): string | null {
  const r = planDraftSchema.safeParse(raw);
  return r.success ? null : r.error.issues[0].path.join(".");
}
const strings = (n: number, len: number) => Array.from({ length: n }, () => "x".repeat(len));
const blanks = (n: number) => Array.from({ length: n }, () => ({}));

describe("PLAN_LIMITS", () => {
  it("holds the limits from the spec", () => {
    expect(PLAN_LIMITS).toEqual({
      sourceChars: 40000, docxBytes: 5242880, docxUnpackedBytes: 20971520, requestBytes: 6291456,
      overviewItem: 400, cell: 300, cellSoft: 240, paragraph: 1200, evidence: 400, patientName: 120,
    });
  });
});

describe("length limits from the spec table (draft schema)", () => {
  it.each<[string, number]>([
    ["patient.name", 120], ["profile.specialty", 200], ["profile.condition", 200],
    ["diagnosis.text", 300], ["diagnosis.state", 300], ["diagnosis.tactic", 300], ["diagnosis.status", 300],
    ["tactic.intro", 1200], ["tactic.items.0.title", 120], ["tactic.items.0.text", 600],
    ["documents.title", 120],
    ["approach.title", 120], ["approach.items.0.title", 120], ["approach.items.0.text", 600], ["approach.note", 600],
    ["clinics.0.id", 20], ["clinics.0.name", 200], ["clinics.0.shortName", 60], ["clinics.0.city", 60],
    ["clinics.0.area", 100], ["clinics.0.doctor", 300], ["clinics.0.why", 300],
    ["costs.groups.0.title", 200], ["costs.groups.0.note", 600],
    ["costs.groups.0.rows.0.label", 300], ["costs.groups.0.rows.0.clinicId", 20],
    ["costs.groups.0.rows.0.amount", 60], ["costs.groups.0.rows.0.evidence", 400], ["costs.footnote", 600],
    ["stay.rows.0.label", 300], ["stay.rows.0.value", 300], ["stay.note", 600],
    ["notIncluded", 600],
  ])("%s: %i characters pass, one more is rejected with that path", (path, max) => {
    expect(planDraftSchema.safeParse(nest(path, "x".repeat(max))).success).toBe(true);
    expect(draftIssuePath(nest(path, "x".repeat(max + 1)))).toBe(path);
  });

  it.each<[string, number, number]>([
    ["overview", 12, 400], ["indiaSteps", 20, 400], ["documents.items", 20, 300],
    ["approach.paragraphs", 8, 1200], ["included", 30, 300], ["letterIssues", 20, 400],
  ])("%s: up to %i items of up to %i characters", (path, maxItems, maxLen) => {
    expect(planDraftSchema.safeParse(nest(path, strings(maxItems, maxLen))).success).toBe(true);
    expect(draftIssuePath(nest(path, strings(maxItems + 1, 1)))).toBe(path);
    expect(draftIssuePath(nest(path, strings(1, maxLen + 1)))).toBe(`${path}.0`);
  });

  it.each<[string, number]>([
    ["tactic.items", 12], ["approach.items", 12], ["clinics", 30],
    ["costs.groups", 12], ["costs.groups.0.rows", 40], ["stay.rows", 20],
  ])("%s: up to %i items", (path, max) => {
    expect(planDraftSchema.safeParse(nest(path, blanks(max))).success).toBe(true);
    expect(draftIssuePath(nest(path, blanks(max + 1)))).toBe(path);
  });

  it("does not default a wrong value: an unknown gender is still an error", () => {
    expect(draftIssuePath({ patient: { gender: "x" } })).toBe("patient.gender");
  });
});

describe("length limits of the fixed blocks (content schema)", () => {
  const withFixed = (path: string, value: unknown) => {
    const c = validContent();
    const keys = path.split(".");
    const last = keys.pop() as string;
    const target = keys.reduce<any>((o, k) => o[k], c.fixed);
    target[last] = value;
    return c;
  };
  const issuePath = (c: unknown) => {
    const r = planContentSchema.safeParse(c);
    return r.success ? null : r.error.issues[0].path.join(".");
  };

  it.each<[string, number]>([
    ["tacticDisclaimer", 600], ["costFootnote", 600], ["flights.from", 60], ["flights.to", 60], ["flights.text", 600],
  ])("fixed.%s: %i characters pass, one more is rejected with that path", (path, max) => {
    expect(planContentSchema.safeParse(withFixed(path, "x".repeat(max))).success).toBe(true);
    expect(issuePath(withFixed(path, "x".repeat(max + 1)))).toBe(`fixed.${path}`);
  });

  it.each<[string, number, number]>([["support", 10, 300], ["nextSteps", 8, 40]])(
    "fixed.%s: up to %i items of up to %i characters",
    (path, maxItems, maxLen) => {
      expect(planContentSchema.safeParse(withFixed(path, strings(maxItems, maxLen))).success).toBe(true);
      expect(issuePath(withFixed(path, strings(maxItems + 1, 1)))).toBe(`fixed.${path}`);
      expect(issuePath(withFixed(path, strings(1, maxLen + 1)))).toBe(`fixed.${path}.0`);
    },
  );

  it("flights.checkedOn is empty or a YYYY-MM-DD date", () => {
    expect(planContentSchema.safeParse(withFixed("flights.checkedOn", "2026-10-01")).success).toBe(true);
    expect(planContentSchema.safeParse(withFixed("flights.checkedOn", "")).success).toBe(true);
    expect(planContentSchema.safeParse(withFixed("flights.checkedOn", "2026-10-01 ")).success).toBe(false);
  });
});

describe("planDraftSchema defaults", () => {
  it("parses {} to the same body as an empty PlanContent", () => {
    const { language, fixed, ...body } = validContent();
    expect(language).toBe("ru");
    expect(fixed.support).toEqual([]);
    expect(planDraftSchema.parse({})).toEqual(body);
  });

  it("fills defaults inside array items and drops language/fixed if the model sends them", () => {
    const d = planDraftSchema.parse({
      language: "tg", fixed: { support: ["x"] },
      clinics: [{ name: "Example Hospital A" }],
      costs: { groups: [{ rows: [{ amount: "6800" }] }] },
      stay: { rows: [{ label: "Hospitalization" }] },
      tactic: { items: [{ title: "T" }] },
    });
    expect(d.clinics).toEqual([{ id: "", name: "Example Hospital A", shortName: "", city: "", area: "", doctor: "", why: "" }]);
    expect(d.costs).toEqual({
      groups: [{ title: "", note: "", rows: [{ label: "", clinicId: "", amount: "6800", evidence: "" }] }],
      footnote: "",
    });
    expect(d.stay).toEqual({ rows: [{ label: "Hospitalization", value: "", total: false }], note: "" });
    expect(d.tactic).toEqual({ intro: "", items: [{ title: "T", text: "" }] });
    expect(d).not.toHaveProperty("fixed");
    expect(d).not.toHaveProperty("language");
  });
});

describe("PLAN_RESPONSE_SCHEMA against the zod draft", () => {
  const schema = PLAN_RESPONSE_SCHEMA as any;

  function walk(node: any, visit: (n: any, path: string) => void, path = "$"): void {
    visit(node, path);
    for (const [key, child] of Object.entries<any>(node.properties ?? {})) walk(child, visit, `${path}.${key}`);
    if (node.items) walk(node.items, visit, `${path}[]`);
  }
  /** Ответ «модели» по схеме Gemini: в каждое поле подставляется допустимое значение. */
  function sampleFor(node: any): unknown {
    switch (node.type) {
      case "OBJECT": return Object.fromEntries(Object.entries<any>(node.properties).map(([k, v]) => [k, sampleFor(v)]));
      case "ARRAY": return [sampleFor(node.items)];
      case "BOOLEAN": return false;
      case "STRING": return node.enum ? node.enum[0] : "x";
      default: throw new Error(`unexpected type ${node.type}`);
    }
  }

  it("a sample built from the schema passes planDraftSchema unchanged (no field is missing or unknown on either side)", () => {
    const sample = sampleFor(schema);
    expect(planDraftSchema.parse(sample)).toEqual(sample);
  });

  it("every object lists all its keys as required, in order, and every field has a description", () => {
    let objects = 0;
    walk(schema, (node, path) => {
      if (node.properties) {
        objects += 1;
        const keys = Object.keys(node.properties);
        expect({ path, required: node.required }).toEqual({ path, required: keys });
        expect({ path, order: node.propertyOrdering }).toEqual({ path, order: keys });
      }
      if (path !== "$") expect({ path, description: typeof node.description === "string" && node.description.length >= 20 }).toEqual({ path, description: true });
    });
    expect(objects).toBeGreaterThan(10);
  });

  it("gender is an enum string; no nullable, minItems or pattern anywhere", () => {
    expect(schema.properties.patient.properties.gender).toMatchObject({ type: "STRING", format: "enum", enum: ["male", "female", "unknown"] });
    expect(JSON.stringify(schema)).not.toMatch(/"(nullable|minItems|pattern)":/);
  });
});

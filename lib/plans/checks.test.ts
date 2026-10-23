import { hasBlockingWarnings, runPlanChecks, treatingDoctorsInLetter } from "./checks";
import type { PlanCheckInput } from "./checks";
import { newPlanOptions } from "./defaults";
import type { PlanContent, PlanWarning } from "./schema";
import { prepareSource } from "./source";
import { FICTIONAL_LETTER, fictionalContent } from "./test-fixtures";

const NOW = new Date("2026-10-09T05:00:00Z");
const base = (): PlanCheckInput => ({
  content: fictionalContent(), options: newPlanOptions(NOW), source: prepareSource(FICTIONAL_LETTER),
  now: NOW, senderNames: [],
});
const codes = (w: PlanWarning[]) => w.map((x) => x.code);
const withRows = (amounts: string[]): PlanContent => {   // подменяет суммы в первой группе цен
  const c = fictionalContent();
  c.costs.groups = [{ title: "Лечение", note: "", rows: amounts.map((amount, i) => ({ label: `Строка ${i}`, clinicId: "", amount, evidence: "" })) }];
  return c;
};

it("the fictional plan has no errors and exactly the two expected warnings", () => {
  const w = runPlanChecks(base());
  expect(w.filter((x) => x.level === "error")).toEqual([]);
  expect(codes(w).sort()).toEqual(["clinics-unverified", "patient-name-translit"]);
});

it("money-missing names the lost amount", () => {
  const input = base();
  input.content.costs.groups[0].rows.splice(1, 1);                 // пропала строка 7 200
  const w = runPlanChecks(input).find((x) => x.code === "money-missing");
  expect(w?.level).toBe("error");
  expect(w?.message).toContain("7200");
});

it("money-invented points at the row", () => {
  const input = base();
  input.content.costs.groups[0].rows[0].amount = "6 900";
  const w = runPlanChecks(input).find((x) => x.code === "money-invented");
  expect(w?.path).toBe("costs.groups[0].rows[0].amount");
});

it("money-evidence: quote absent from the letter, and quote without the amount", () => {
  const a = base(); a.content.costs.groups[0].rows[0].evidence = "Example Hospital A - USD 9999";
  const b = base(); b.content.costs.groups[0].rows[0].evidence = "Example Hospital B - USD 7200";
  for (const input of [a, b]) {
    expect(runPlanChecks(input).find((x) => x.code === "money-evidence")?.path).toBe("costs.groups[0].rows[0].evidence");
  }
});

// Review Focus №1
it("accepts money the way letters write it and still notices a lost number", () => {
  const source = "Surgery USD 6,800\nTotal $7600 - $9000/-\nTests USD 500-USD 800\nCost 6,800 USD";
  const ok = runPlanChecks({ ...base(), source, content: withRows(["6 800", "7 600 – 9 000", "500 – 800"]) });
  expect(ok.filter((x) => x.code.startsWith("money"))).toEqual([]);
  const lost = runPlanChecks({ ...base(), source, content: withRows(["6 800", "7 600 – 9 000", "500"]) });
  expect(lost.find((x) => x.code === "money-missing")?.message).toContain("800");
});

// Review Focus №2
it("price-unknown-clinic: a row pointing at a clinic that is not in the list; an empty clinicId is fine", () => {
  const input = base();
  input.content.costs.groups[0].rows[0].clinicId = "zzz";
  const w = runPlanChecks(input).filter((x) => x.code === "price-unknown-clinic");
  expect(w.map((x) => x.path)).toEqual(["costs.groups[0].rows[0].clinicId"]);
  expect(codes(runPlanChecks({ ...base(), content: withRows(["6 800"]) }))).not.toContain("price-unknown-clinic");
});

it("name-mismatch for another patient; none for a matching one (Cyrillic CRM name vs Latin letter)", () => {
  expect(codes(runPlanChecks({ ...base(), leadName: "Иванов Иван" }))).toContain("name-mismatch");
  const same = runPlanChecks({ ...base(), leadName: "Тестов Тест" });
  expect(codes(same)).not.toContain("name-mismatch");
});

it("patient-name-translit disappears when the name equals the CRM name", () => {
  const input = base(); input.content.patient.name = "Тестов Тест"; input.leadName = "Тестов Тест";
  expect(codes(runPlanChecks(input))).not.toContain("patient-name-translit");
});

it("contact-leak: URL, e-mail and phone in printed text; evidence and letterIssues are not printed", () => {
  for (const leak of ["см. https://example.org/a", "пишите me@example.org", "звоните +91 98765 43210"]) {
    const input = base(); input.content.overview = [leak];
    expect(runPlanChecks(input).find((x) => x.code === "contact-leak")?.path).toBe("overview[0]");
  }
  const quiet = base(); quiet.content.letterIssues = ["Письмо ссылается на https://example.org"];
  expect(codes(runPlanChecks(quiet))).not.toContain("contact-leak");
});

it("foreign-glyph: Devanagari and emoji are errors; Greek µ, Tajik ғ, №, ≈ are fine", () => {
  const bad = base(); bad.content.overview = ["Врач अनिл", "Готово ✅"];
  expect(runPlanChecks(bad).filter((x) => x.code === "foreign-glyph").map((x) => x.path)).toEqual(["overview[0]", "overview[1]"]);
  const ok = base(); ok.content.overview = ["Размер 5 µm, Ғафур, № 3, ≈ 2 недели"];
  expect(codes(runPlanChecks(ok))).not.toContain("foreign-glyph");
});

it("verified-month-missing when the sites box is ticked without a month; clinics-unverified goes away with a month", () => {
  const off = base(); off.options = { ...off.options, clinicsVerifiedOnSites: true };
  expect(codes(runPlanChecks(off))).toContain("verified-month-missing");
  expect(codes(runPlanChecks(off))).not.toContain("clinics-unverified");
  const on = base(); on.options = { ...on.options, clinicsVerifiedOnSites: true, clinicsVerifiedMonth: "2026-09" };
  expect(codes(runPlanChecks(on))).not.toContain("verified-month-missing");
  expect(codes(runPlanChecks(on))).not.toContain("clinics-unverified");
});

it("sender-name is a warning for names from senderNames, case-insensitive", () => {
  const input = { ...base(), senderNames: ["Acme Medical Assistance"] };
  input.content.tactic.intro = "по данным acme medical assistance";
  const w = runPlanChecks(input).find((x) => x.code === "sender-name");
  expect(w?.level).toBe("warn");
  expect(w?.path).toBe("tactic.intro");
});

it("doctor-not-in-letter at clinics[0].doctor", () => {
  const input = base(); input.content.clinics[0].doctor = "Dr. Zorro Nonexistent — хирург";
  expect(runPlanChecks(input).find((x) => x.code === "doctor-not-in-letter")?.path).toBe("clinics[0].doctor");
});

it("letter-issue: one warning per letterIssues entry", () => {
  const input = base(); input.content.letterIssues = ["Описание клиники относится к другому госпиталю", "Число инъекций расходится"];
  expect(runPlanChecks(input).filter((x) => x.code === "letter-issue").map((x) => x.message)).toEqual(input.content.letterIssues);
});

it("flights-stale: empty date or 31 days old → warn; 29 days or disabled → none", () => {
  const set = (checkedOn: string, enabled = true) => {
    const input = base(); input.content.fixed.flights = { ...input.content.fixed.flights, checkedOn, enabled };
    return codes(runPlanChecks(input));
  };
  expect(set("")).toContain("flights-stale");
  expect(set("2026-09-08")).toContain("flights-stale");        // 31 день до 2026-10-09
  expect(set("2026-09-10")).not.toContain("flights-stale");    // 29 дней
  expect(set("", false)).not.toContain("flights-stale");
});

it("empty-section and long-cell are info", () => {
  const input = base(); input.content.clinics = []; input.content.stay.rows = [];
  input.content.diagnosis.text = "x".repeat(241);
  const w = runPlanChecks(input);
  expect(w.filter((x) => x.code === "empty-section").map((x) => x.path).sort()).toEqual(["clinics", "stay"]);
  expect(w.find((x) => x.code === "long-cell")?.level).toBe("info");
});

it("errors come first, then warnings, then info", () => {
  const input = base(); input.content.overview = ["https://example.org"]; input.content.clinics = [];
  const levels = runPlanChecks(input).map((x) => x.level);
  expect(levels).toEqual([...levels].sort((a, b) => ["error", "warn", "info"].indexOf(a) - ["error", "warn", "info"].indexOf(b)));
  expect(hasBlockingWarnings(runPlanChecks(input))).toBe(true);
  expect(hasBlockingWarnings(runPlanChecks(base()))).toBe(false);
});


describe("doctors named in the letter", () => {
  const LETTER = [
    "We recommend the following Hospitals and Doctors:",
    "1. Alpha Hospital is a 600-bed hospital in Delhi.",
    "Dr. Anna Example will be the treating doctor.",
    "2. Bravo Medical Centre is a 300-bed hospital in Gurugram.",
    "Dr. (Maj Gen) Ravi Demo will be the treating doctor.",
    "3. Charlie Institute offers surgery in 15 specialties.",
    "Dr. Meera Sample- will be the treating doctor. Profile attached.",
  ].join("\n");
  const NAMES = ["Alpha Hospital", "Bravo Medical Centre", "Charlie Institute"];
  const clinic = (n: number, doctor: string) => ({ id: `c${n}`, name: NAMES[n], shortName: NAMES[n].split(" ")[0], city: "", area: "", doctor, why: "" });
  // order — порядок клиник в плане (индексы в NAMES); doctors — врач по каждой из них
  const input = (order: number[], doctors: string[]) => {
    const i = base();
    i.source = LETTER;
    i.content.clinics = order.map((n, k) => clinic(n, doctors[k]));
    i.content.costs.groups = [];
    return i;
  };
  const mismatches = (w: PlanWarning[]) => w.filter((x) => x.code === "clinic-doctor-mismatch");

  it("reads the doctor names in letter order", () => {
    expect(treatingDoctorsInLetter(LETTER)).toEqual(["Dr. Anna Example", "Dr. (Maj Gen) Ravi Demo", "Dr. Meera Sample"]);
  });

  it("is quiet when every clinic has its own doctor", () => {
    const w = runPlanChecks(input([0, 1, 2], ["Dr. Anna Example", "Dr. (Maj Gen) Ravi Demo — хирург", "Dr. Meera Sample"]));
    expect(mismatches(w)).toEqual([]);
    expect(codes(w)).not.toContain("letter-doctor-missing");
  });

  it("does not depend on the order of clinics in the plan", () => {
    // В плане клиники идут в порядке таблицы цен (C, A, B), а не как в письме — врачи при этом правильные.
    const ok = runPlanChecks(input([2, 0, 1], ["Dr. Meera Sample", "Dr. Anna Example", "Dr. Ravi Demo"]));
    expect(mismatches(ok)).toEqual([]);
    // А если врачей перепутали, предупреждение называет нужную клинику, в каком бы порядке они ни стояли.
    const swapped = mismatches(runPlanChecks(input([2, 0, 1], ["Dr. Anna Example", "Dr. Meera Sample", "Dr. Ravi Demo"])));
    // Предупреждения идут в порядке письма (A, затем C), а путь указывает на строку клиники в плане.
    expect(swapped.map((x) => x.path).sort()).toEqual(["clinics[0].doctor", "clinics[1].doctor"]);
    expect(swapped.some((x) => x.path === "clinics[0].doctor" && x.message.includes("Charlie"))).toBe(true);
  });

  it("catches the failure seen in a real plan: one wrong doctor, the rest empty", () => {
    const w = runPlanChecks(input([0, 1, 2], ["", "Dr. Meera Sample", ""]));
    const found = mismatches(w);
    expect(found.map((x) => x.path)).toEqual(["clinics[0].doctor", "clinics[1].doctor", "clinics[2].doctor"]);
    expect(found[0].message).toContain("не указан врач");
    expect(found[1].message).toContain("Ravi Demo");
    expect(found.every((x) => x.level === "warn")).toBe(true);
    expect(hasBlockingWarnings(w)).toBe(false);
  });

  it("names a letter doctor whose clinic is not in the plan", () => {
    const w = runPlanChecks(input([0, 2], ["Dr. Anna Example", "Dr. Meera Sample"]));
    const missing = w.filter((x) => x.code === "letter-doctor-missing");
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain("Ravi Demo");
  });

  it("stays silent for letters without the treating-doctor phrase", () => {
    expect(codes(runPlanChecks(base()))).not.toContain("clinic-doctor-mismatch");
    expect(codes(runPlanChecks(base()))).not.toContain("letter-doctor-missing");
  });
});

import {
  amountNumbers,
  clinicLabel,
  formatAmount,
  formatDotDate,
  formatMonthYear,
  formatRuDate,
  genderLabel,
  letterMoneyNumbers,
  sortRowsByAmount,
  todayInZone,
} from "./format";

const NB = " ";

it.each([
  ["USD 6800", `6${NB}800`], ["$6,800", `6${NB}800`], ["USD 500-USD 800", "500 – 800"],
  ["USD 2000-2500", `2${NB}000 – 2${NB}500`], ["+$3000-$4000", `+3${NB}000 – 4${NB}000`],
  ["USD 80-90 / сеанс", "80 – 90 / сеанс"], ["USD 7600 - USD 9000/-", `7${NB}600 – 9${NB}000`],
  ["6 800", `6${NB}800`], ["USD 99.50", "99.50"], ["по запросу", "по запросу"], ["", ""],
])("formatAmount(%j) → %j and is idempotent", (raw, out) => {
  expect(formatAmount(raw)).toBe(out);
  expect(formatAmount(out)).toBe(out);
});

it("amountNumbers collapses thousands separators", () => {
  expect(amountNumbers(`6${NB}800, 6,800 and 6800`)).toEqual([6800, 6800, 6800]);
});

// Review Focus №1
it("letterMoneyNumbers reads money the way letters write it and ignores other numbers", () => {
  const source = ["Surgery USD 6,800", "Total $7600 - $9000/-", "Tests USD 500-USD 800", "Range USD 2000-2500",
    "Cost 6,800 USD", "Range 7000-8000 USD", "10 sessions of dialysis, 52 years old"].join("\n");
  expect(letterMoneyNumbers(source)).toEqual([6800, 7600, 9000, 500, 800, 2000, 2500, 6800, 7000, 8000]);
});

it("todayInZone crosses midnight in Dushanbe (UTC+5)", () => {
  expect(todayInZone(new Date("2026-10-08T20:30:00Z"))).toBe("2026-10-09");
  expect(todayInZone(new Date("2026-10-08T18:30:00Z"))).toBe("2026-10-08");
});

it("date helpers", () => {
  expect(formatRuDate("2026-10-09")).toBe("9 октября 2026 г.");
  expect(formatDotDate("2026-10-09")).toBe("09.10.2026");
  expect(formatMonthYear("2026-09")).toBe("сентябрь 2026 г.");
});

it("sortRowsByAmount sorts by the first number, rows without numbers go last, input is not mutated", () => {
  const rows = [{ amount: `7${NB}200` }, { amount: "по запросу" }, { amount: `6${NB}400` }, { amount: `500 – 800` }];
  expect(sortRowsByAmount(rows).map((r) => r.amount)).toEqual(["500 – 800", `6${NB}400`, `7${NB}200`, "по запросу"]);
  expect(rows[0].amount).toBe(`7${NB}200`);
});

it("clinicLabel and genderLabel", () => {
  expect(clinicLabel({ name: "Example Hospital A & Research", shortName: "Example A", city: "Фаридабад" })).toBe("Example A (Фаридабад)");
  expect(clinicLabel({ name: "Example Hospital B", shortName: "", city: "" })).toBe("Example Hospital B");
  expect(genderLabel("male")).toBe("Мужской");
  expect(genderLabel("unknown")).toBe("—");
});

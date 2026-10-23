import path from "node:path";

import type { TDocumentDefinitions } from "pdfmake/interfaces";

import { DEJAVU_DIR } from "@/lib/pdf-fonts";

import { newPlanContent, newPlanOptions } from "./defaults";
import { buildPlanDefinition, buildPlanPdf, planPdfFilename, planSectionTitles } from "./pdf";
import type { PlanPdfInput } from "./pdf";
import { fictionalContent, fullContent } from "./test-fixtures";

// fontkit — зависимость pdfkit, типов у неё нет: подключаем через require, как в lib/pdf-fonts.test.ts.
const fontkit = require("fontkit") as {
  openSync(file: string): {
    hasGlyphForCodePoint(codePoint: number): boolean;
    layout(text: string): { advanceWidth: number };
    unitsPerEm: number;
  };
};

const NOW = new Date("2026-10-09T05:00:00Z");
const input = (over: Partial<PlanPdfInput> = {}): PlanPdfInput =>
  ({ content: fictionalContent(), options: newPlanOptions(NOW), status: "draft", ...over });

// Обходит дерево содержимого (массивы, table.body, columns, stack, text и любые вложенные объекты) в порядке документа.
function walk(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit));
    return;
  }
  if (node !== null && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((value) => walk(value, visit));
  }
}

// Таблица узла: ширины и строки ячеек (проверяем форму таблицы, не только текст).
type TableNode = {
  widths: Array<number | string>;
  body: Array<Array<Record<string, unknown>>>;
  headerRows?: number;
  keepWithHeaderRows?: number;
};

// Узлы разделов (с полем sectionTitle), по порядку; table — сама таблица раздела.
function sectionNodes(def: TDocumentDefinitions): Array<{ sectionTitle: string; table: TableNode }> {
  const nodes: Array<{ sectionTitle: string; table: TableNode }> = [];
  walk(def.content, (obj) => {
    if (typeof obj.sectionTitle === "string") nodes.push({ sectionTitle: obj.sectionTitle, table: obj.table as TableNode });
  });
  return nodes;
}

// Таблица раздела по его заголовку.
function sectionTable(def: TDocumentDefinitions, title: string): TableNode {
  const node = sectionNodes(def).find((item) => item.sectionTitle === title);
  if (!node) throw new Error(`раздел «${title}» не найден`);
  return node.table;
}

// Таблица полосы пациента: единственная, в ячейках которой есть подпись «ПОЛ».
function patientStripTable(def: TDocumentDefinitions): TableNode {
  const tables: TableNode[] = [];
  walk(def.content, (obj) => {
    const table = obj.table as TableNode | undefined;
    if (table && JSON.stringify(table.body).includes('"ПОЛ"')) tables.push(table);
  });
  return tables[0];
}

// Подписи столбцов: строка шапки столбцов идёт сразу за строкой заголовка раздела.
const headerLabels = (table: TableNode): unknown[] => table.body[1].map((cell) => cell.text);

const TEXT_WIDTH = 527; // ширина текста A4 при полях 34 pt
const NAVY = "#21268c";
const ZEBRA = "#f7f9fc";

// Ширины в pt: проценты — от TEXT_WIDTH, «*» — остаток (он один), числа — как есть.
function resolveWidths(widths: Array<number | string>): number[] {
  const known = widths.map((w) => (typeof w === "number" ? w : w.endsWith("%") ? (parseFloat(w) / 100) * TEXT_WIDTH : NaN));
  const used = known.reduce((sum, w) => (Number.isNaN(w) ? sum : sum + w), 0);
  return known.map((w) => (Number.isNaN(w) ? TEXT_WIDTH - used : w));
}

// Ширина строки жирным шрифтом DejaVu Sans Bold при размере size (pt).
const boldFont = fontkit.openSync(path.join(DEJAVU_DIR, "DejaVuSans-Bold.ttf"));
const boldWidth = (text: string, size: number): number => (boldFont.layout(text).advanceWidth * size) / boldFont.unitsPerEm;

// Все строки text из def.content, склеенные пробелом.
function allText(def: TDocumentDefinitions): string {
  const parts: string[] = [];
  walk(def.content, (obj) => {
    if (typeof obj.text === "string") parts.push(obj.text);
  });
  return parts.join(" ");
}

it("starts with the form title and the first four sections in form order", () => {
  const def = buildPlanDefinition(input());
  expect(allText(def)).toContain("ПЛАН МЕДИЦИНСКОГО ОБСЛЕДОВАНИЯ И ЛЕЧЕНИЯ");
  expect(planSectionTitles(def).slice(0, 4)).toEqual([
    "МЕДИЦИНСКИЙ ОБЗОР", "ПОДТВЕРЖДЁННЫЙ ДИАГНОЗ", "ЧТО НЕОБХОДИМО СДЕЛАТЬ В ИНДИИ", "ВОЗМОЖНАЯ ТАКТИКА ЛЕЧЕНИЯ"]);
});

it("diagnosis heading follows the option", () => {
  const def = buildPlanDefinition(input({ options: { ...newPlanOptions(NOW), diagnosisHeading: "by-documents" } }));
  expect(planSectionTitles(def)[1]).toBe("ДИАГНОЗ ПО ПРЕДОСТАВЛЕННЫМ ДОКУМЕНТАМ");
});

it("omits an empty overview section and prints the patient strip", () => {
  const content = fictionalContent();
  content.overview = [];
  const def = buildPlanDefinition(input({ content }));
  expect(planSectionTitles(def)).not.toContain("МЕДИЦИНСКИЙ ОБЗОР");
  const text = allText(def);
  for (const part of ["ПАЦИЕНТ", "Testov Test", "Мужской", "09.10.2026", "Урология (камни в почках)"]) {
    expect(text).toContain(part);
  }
});

it("profile has no brackets when the condition is empty", () => {
  const content = fictionalContent();
  content.profile.condition = "";
  const text = allText(buildPlanDefinition(input({ content })));
  expect(text).toContain("Урология");
  expect(text).not.toContain("Урология (");
});

it("diagnosis table prints only the filled rows", () => {
  const content = fictionalContent();
  content.diagnosis.status = "";
  const text = allText(buildPlanDefinition(input({ content })));
  expect(text).toContain("ТЕКУЩЕЕ СОСТОЯНИЕ");
  expect(text).not.toContain("ТЕКУЩИЙ СТАТУС");
});

it("steps are numbered 01, 02, 03 and the tactic disclaimer follows the tactic section", () => {
  const def = buildPlanDefinition(input());
  const tokens = allText(def).split(" ");
  expect(tokens).toEqual(expect.arrayContaining(["01", "02", "03"]));
  expect(allText(def)).toContain(fictionalContent().fixed.tacticDisclaimer);
});

it("the logo is embedded as a data URI", () => {
  expect(JSON.stringify(buildPlanDefinition(input()).content)).toContain("data:image/png;base64,");
});

it("watermark only until reviewed", () => {
  expect((buildPlanDefinition(input({ status: "draft" })).watermark as { text: string }).text).toBe("ЧЕРНОВИК");
  expect(buildPlanDefinition(input({ status: "reviewed" })).watermark).toBeUndefined();
});

it("every section table keeps its title with the first row", () => {
  const nodes = sectionNodes(buildPlanDefinition(input()));
  expect(nodes.length).toBeGreaterThanOrEqual(4);
  for (const node of nodes) {
    expect(node.table.headerRows).toBeGreaterThanOrEqual(1);
    expect(node.table.keepWithHeaderRows).toBe(1);
  }
});

it("footer carries the contact line and optional page numbers", () => {
  const footer = buildPlanDefinition(input()).footer as (page: number, pages: number) => unknown;
  expect(JSON.stringify(footer(2, 5))).toContain("(+992) 00 550 77 77");
  expect(JSON.stringify(footer(2, 5))).toContain("стр. 2 из 5");
  const off = buildPlanDefinition(input({ options: { ...newPlanOptions(NOW), showPageNumbers: false } })).footer as (
    p: number,
    n: number,
  ) => unknown;
  expect(JSON.stringify(off(2, 5))).not.toContain("стр.");
});

it("planPdfFilename", () => {
  expect(planPdfFilename({ patientName: "Тестов Тест", date: "2026-10-09", status: "reviewed" })).toBe("Plan_Testov_Test_2026-10-09.pdf");
  expect(planPdfFilename({ patientName: "", date: "2026-10-09", status: "draft" })).toBe("Plan_patient_2026-10-09_DRAFT.pdf");
  expect(planPdfFilename({ patientName: "O'Neil  अ Test", date: "2026-10-09", status: "reviewed" })).toBe("Plan_O_Neil_Test_2026-10-09.pdf");
});

it("buildPlanPdf returns a PDF", async () => {
  expect((await buildPlanPdf(input())).subarray(0, 4).toString()).toBe("%PDF");
});

it("prints every section in form order when everything is filled", () => {
  expect(planSectionTitles(buildPlanDefinition(input({ content: fullContent() })))).toEqual([
    "МЕДИЦИНСКИЙ ОБЗОР", "ПОДТВЕРЖДЁННЫЙ ДИАГНОЗ", "ЧТО НЕОБХОДИМО СДЕЛАТЬ В ИНДИИ", "ВОЗМОЖНАЯ ТАКТИКА ЛЕЧЕНИЯ",
    "НЕОБХОДИМЫЕ ДОКУМЕНТЫ", "РЕКОМЕНДОВАННЫЕ КЛИНИКИ", "ПРЕДЛАГАЕМЫЙ ПОДХОД", "ОРИЕНТИРОВОЧНАЯ СТОИМОСТЬ",
    "ПРОЕЗД И ПРЕБЫВАНИЕ", "ЧТО ВКЛЮЧЕНО", "СЛЕДУЮЩИЙ ШАГ"]);
});

it("skips documents and approach when they are empty", () => {
  const titles = planSectionTitles(buildPlanDefinition(input()));
  expect(titles).not.toContain("НЕОБХОДИМЫЕ ДОКУМЕНТЫ");
  expect(titles).not.toContain("ПРЕДЛАГАЕМЫЙ ПОДХОД");
});

it("the tactic disclaimer closes the tactic+documents block", () => {
  const withDocs = allText(buildPlanDefinition(input({ content: fullContent() })));
  expect(withDocs.indexOf("НЕОБХОДИМЫЕ ДОКУМЕНТЫ")).toBeLessThan(withDocs.indexOf("не гарантирует результат лечения"));
  const withoutDocs = allText(buildPlanDefinition(input()));
  expect(withoutDocs.indexOf("ВОЗМОЖНАЯ ТАКТИКА ЛЕЧЕНИЯ")).toBeLessThan(withoutDocs.indexOf("не гарантирует результат лечения"));
  expect(withoutDocs.indexOf("не гарантирует результат лечения")).toBeLessThan(withoutDocs.indexOf("РЕКОМЕНДОВАННЫЕ КЛИНИКИ"));
});

it("cost rows take their label from the linked clinic and format the amount", () => {
  const text = allText(buildPlanDefinition(input()));
  expect(text).toContain("Example A (Фаридабад)");
  expect(text).toContain("6 800"); // разряды через неразрывный пробел (formatAmount)
  expect(text).toContain("ОРИЕНТИРОВОЧНАЯ СТОИМОСТЬ, USD");
  expect(text).toContain("Итоговая стоимость лечения будет определена после первичной оценки в Индии");
});

// Review Focus №2
it("a price row pointing at an unknown clinic falls back to its own label and does not crash", async () => {
  const content = fictionalContent();
  content.costs.groups[0].rows[0] = { ...content.costs.groups[0].rows[0], clinicId: "zzz", label: "Прочее" };
  expect(allText(buildPlanDefinition(input({ content })))).toContain("Прочее");
  expect((await buildPlanPdf(input({ content }))).subarray(0, 4).toString()).toBe("%PDF");
});

it("the clinics note depends on the verification option", () => {
  expect(allText(buildPlanDefinition(input()))).toContain("по информации принимающей стороны");
  const on = { ...newPlanOptions(NOW), clinicsVerifiedOnSites: true, clinicsVerifiedMonth: "2026-09" };
  expect(allText(buildPlanDefinition(input({ options: on })))).toContain("официальных сайтах клиник (сентябрь 2026 г.)");
});

it("the flights line prints the check date only when it is set", () => {
  const content = fictionalContent();
  content.fixed.flights.checkedOn = "2026-09-12";
  expect(allText(buildPlanDefinition(input({ content })))).toContain("проверена 12.09.2026 и подлежит уточнению перед бронированием");
  content.fixed.flights.checkedOn = "";
  const text = allText(buildPlanDefinition(input({ content })));
  expect(text).toContain("Информация о рейсах подлежит уточнению перед бронированием");
  expect(text).not.toContain("проверена");
});

it("the default 'not included' text is used when the letter gives none; a trailing dot is not doubled", () => {
  const content = fictionalContent();
  content.notIncluded = "";
  expect(allText(buildPlanDefinition(input({ content })))).toContain("Не включено: консультации, не входящие в согласованный план");
  content.notIncluded = "перелёт.";
  expect(allText(buildPlanDefinition(input({ content })))).toContain("Не включено: перелёт.");
  expect(allText(buildPlanDefinition(input({ content })))).not.toContain("перелёт..");
});

it("the next-step chips follow fixed.nextSteps and the last one is green", () => {
  const def = buildPlanDefinition(input());
  const chips = JSON.stringify(def.content);
  expect(chips).toContain("ПОДТВЕРЖДЕНИЕ");
  expect(chips).toContain("#6dbb4d");
  expect(allText(def)).toContain("Чтобы продолжить, свяжитесь с вашим координатором Meditur HBG.");
});

it("every character of the template and of the fixtures exists in DejaVu (regular and bold)", () => {
  const text = allText(buildPlanDefinition(input({ content: fullContent() })));
  for (const file of ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"]) {
    const font = fontkit.openSync(path.join(DEJAVU_DIR, file));
    const missing = [...new Set(text)].filter((ch) => !/\s/.test(ch) && !font.hasGlyphForCodePoint(ch.codePointAt(0)!));
    expect(missing).toEqual([]);
  }
});

// Review Focus №5
it("extreme plans still build: 30 clinics with long cells, an empty plan, a full plan", async () => {
  const big = fictionalContent();
  big.clinics = Array.from({ length: 30 }, (_, i) => ({
    ...big.clinics[0], id: `c${i + 1}`,
    doctor: "Dr. Anna Example ".repeat(30).slice(0, 290), why: "Описание. ".repeat(60).slice(0, 290),
  }));
  const pdf = await buildPlanPdf(input({ content: big }));
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(3);
  expect((await buildPlanPdf(input({ content: newPlanContent() }))).subarray(0, 4).toString()).toBe("%PDF");
  expect((await buildPlanPdf(input({ content: fullContent() }))).subarray(0, 4).toString()).toBe("%PDF");
});

it("the gender column fits «Женский» and «Мужской» on one line and the profile column stays readable", () => {
  const widths = resolveWidths(patientStripTable(buildPlanDefinition(input())).widths);
  // ячейка полосы пациента: отступы по 8 pt с каждой стороны
  for (const label of ["Женский", "Мужской"]) expect(boldWidth(label, 9) + 16).toBeLessThanOrEqual(widths[1]);
  expect(boldWidth("Урология (камни в почках)", 9) + 16).toBeLessThanOrEqual(widths[3]);
  expect(widths[3]).toBeGreaterThanOrEqual(180);
});

it("every step number keeps its navy chip on zebra rows; the zebra tint covers only the text cell", () => {
  const content = fictionalContent();
  content.indiaSteps.push("Наблюдение после процедуры и контрольное КТ");
  const rows = sectionTable(buildPlanDefinition(input({ content })), "ЧТО НЕОБХОДИМО СДЕЛАТЬ В ИНДИИ").body.slice(1);
  expect(rows).toHaveLength(4);
  rows.forEach(([chip, text], index) => {
    expect(chip.fillColor).not.toBe(ZEBRA);
    expect(JSON.stringify(chip)).toContain(`"fillColor":"${NAVY}"`);
    expect(JSON.stringify(chip)).toContain('"color":"#ffffff"');
    expect(text.fillColor).toBe(index % 2 === 1 ? ZEBRA : undefined);
  });
});

it("the clinics table prints the doctor and reason columns when some clinic has them", () => {
  const table = sectionTable(buildPlanDefinition(input()), "РЕКОМЕНДОВАННЫЕ КЛИНИКИ");
  expect(headerLabels(table)).toEqual(["№", "ГОСПИТАЛЬ", "ГОРОД", "РЕКОМЕНДУЕМЫЙ СПЕЦИАЛИСТ", "ПОЧЕМУ РАССМАТРИВАЕТСЯ"]);
  expect(table.widths).toHaveLength(5);
});

it("the doctor column is dropped only when no clinic has a doctor", () => {
  const none = fictionalContent();
  for (const clinic of none.clinics) clinic.doctor = "";
  const noneTable = sectionTable(buildPlanDefinition(input({ content: none })), "РЕКОМЕНДОВАННЫЕ КЛИНИКИ");
  expect(headerLabels(noneTable)).toEqual(["№", "ГОСПИТАЛЬ", "ГОРОД", "ПОЧЕМУ РАССМАТРИВАЕТСЯ"]);
  for (const row of noneTable.body) expect(row).toHaveLength(noneTable.widths.length);
  expect(allText(buildPlanDefinition(input({ content: none })))).not.toContain("РЕКОМЕНДУЕМЫЙ СПЕЦИАЛИСТ");

  // у одной клиники врач есть — столбец печатается
  const one = fictionalContent();
  for (const clinic of one.clinics.slice(1)) clinic.doctor = "";
  expect(headerLabels(sectionTable(buildPlanDefinition(input({ content: one })), "РЕКОМЕНДОВАННЫЕ КЛИНИКИ"))).toContain(
    "РЕКОМЕНДУЕМЫЙ СПЕЦИАЛИСТ",
  );
});

it("the reason column is dropped only when no clinic has a reason", () => {
  const none = fictionalContent();
  for (const clinic of none.clinics) clinic.why = "";
  const table = sectionTable(buildPlanDefinition(input({ content: none })), "РЕКОМЕНДОВАННЫЕ КЛИНИКИ");
  expect(headerLabels(table)).toEqual(["№", "ГОСПИТАЛЬ", "ГОРОД", "РЕКОМЕНДУЕМЫЙ СПЕЦИАЛИСТ"]);
  for (const row of table.body) expect(row).toHaveLength(table.widths.length);
  expect(allText(buildPlanDefinition(input({ content: none })))).not.toContain("ПОЧЕМУ РАССМАТРИВАЕТСЯ");
});

it("with neither doctors nor reasons the clinics table keeps №, госпиталь and город, one cell per column in every row", () => {
  const content = fictionalContent();
  for (const clinic of content.clinics) {
    clinic.doctor = "";
    clinic.why = "";
  }
  const table = sectionTable(buildPlanDefinition(input({ content })), "РЕКОМЕНДОВАННЫЕ КЛИНИКИ");
  expect(headerLabels(table)).toEqual(["№", "ГОСПИТАЛЬ", "ГОРОД"]);
  expect(table.widths).toHaveLength(3);
  for (const row of table.body) expect(row).toHaveLength(3);
  expect(allText(buildPlanDefinition(input({ content })))).toContain("Фаридабад (Дели NCR)");
});

it("the clinics note does not promise doctors when no clinic has one", () => {
  const content = fictionalContent();
  for (const clinic of content.clinics) clinic.doctor = "";
  const verified = { ...newPlanOptions(NOW), clinicsVerifiedOnSites: true, clinicsVerifiedMonth: "2026-09" };
  const text = allText(buildPlanDefinition(input({ content, options: verified })));
  expect(text).toContain("Госпитали указаны по итогам проверки актуальной информации на официальных сайтах клиник (сентябрь 2026 г.)");
  expect(text).not.toContain("Врачи и госпитали");
  const unverified = allText(buildPlanDefinition(input({ content })));
  expect(unverified).toContain("Госпитали указаны по информации принимающей стороны.");
  expect(unverified).not.toContain("Врачи и госпитали");
});

it("the footer draws a thin light rule across the content width above the contact line", () => {
  const footer = buildPlanDefinition(input()).footer as (page: number, pages: number) => unknown;
  const stack = (footer(2, 5) as { stack: Array<Record<string, unknown>> }).stack;
  expect(stack[0].canvas).toEqual([{ type: "line", x1: 0, y1: 0, x2: TEXT_WIDTH, y2: 0, lineWidth: 0.5, lineColor: "#d6d9f0" }]);
  expect(JSON.stringify(stack[1])).toContain("MEDITUR HBG");
});

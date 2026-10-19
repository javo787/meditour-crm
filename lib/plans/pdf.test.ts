import type { TDocumentDefinitions } from "pdfmake/interfaces";

import { newPlanOptions } from "./defaults";
import { buildPlanDefinition, buildPlanPdf, planPdfFilename, planSectionTitles } from "./pdf";
import type { PlanPdfInput } from "./pdf";
import { fictionalContent } from "./test-fixtures";

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

type SectionNode = { sectionTitle: string; table: { headerRows?: number; keepWithHeaderRows?: number } };

// Узлы разделов (с полем sectionTitle), по порядку.
function sectionNodes(def: TDocumentDefinitions): SectionNode[] {
  const nodes: SectionNode[] = [];
  walk(def.content, (obj) => {
    if (typeof obj.sectionTitle === "string") nodes.push(obj as unknown as SectionNode);
  });
  return nodes;
}

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

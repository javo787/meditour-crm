// PDF плана лечения: формуляр «ПЛАН МЕДИЦИНСКОГО ОБСЛЕДОВАНИЯ И ЛЕЧЕНИЯ» на pdfmake.
// Шрифт DejaVu Sans (assets/fonts/dejavu), логотип — data-URI из public/brand. PDF не сохраняется: собирается по запросу.
// Каждый раздел — таблица, у которой заголовок раздела — первая строка-шапка (§10 спецификации): заголовок
// не остаётся один внизу страницы и повторяется на следующей странице.
import fs from "node:fs";
import path from "node:path";

import pdfmake from "pdfmake";
import type { Content, ContentTable, TDocumentDefinitions, TableCell } from "pdfmake/interfaces";

import { transliterate } from "@/lib/documents";
import { ensurePdfFonts } from "@/lib/pdf-fonts";

import { BRAND } from "./defaults";
import { formatDotDate, formatRuDate, genderLabel } from "./format";
import type { PlanContent, PlanOptions, PlanStatus } from "./schema";

// Цвета формуляра (Global Constraints, раздел PDF).
const INDIGO = "#21268c";
const TINT = "#eef0fa";
const LINE = "#d6d9f0";
const INK = "#1a2433";
const MUTED = "#4b535f";
const CAPTION = "#6f767f";
const FOOTER = "#979ba2";
const GREEN = "#6dbb4d";

// Ширина области текста A4 при полях 34 pt слева и справа.
const CONTENT_WIDTH = 527;

type Widths = NonNullable<ContentTable["table"]["widths"]>;
// Раздел: таблица с собственным полем sectionTitle (pdfmake неизвестные поля игнорирует).
type SectionNode = ContentTable & { sectionTitle: string };

export interface PlanPdfInput {
  content: PlanContent;
  options: PlanOptions;
  status: PlanStatus;
}

// Логотип читается с диска один раз и кэшируется; в PDF попадает как data-URI, без сетевого доступа.
let logoDataUri: string | undefined;
function logoImage(): string {
  if (logoDataUri === undefined) {
    const png = fs.readFileSync(path.join(process.cwd(), "public", "brand", "logo-full.png"));
    logoDataUri = `data:image/png;base64,${png.toString("base64")}`;
  }
  return logoDataUri;
}

const nonEmpty = (items: string[]): string[] => items.filter((item) => item.trim() !== "");

// Раздел: первая строка — заголовок (зелёная метка слева, разреженные буквы); шапка повторяется на новой странице.
// splitRows — для длинных абзацев: строки можно рвать по страницам; таблицы и списки не рвутся.
function sectionNode(title: string, rows: TableCell[][], widths: Widths, splitRows = false): SectionNode {
  const span = widths.length;
  const heading: TableCell = {
    colSpan: span,
    columns: [
      { canvas: [{ type: "rect", x: 0, y: 1, w: 3, h: 11, color: GREEN }], width: 3 },
      { text: title, bold: true, color: INDIGO, fontSize: 9.5, characterSpacing: 0.6, margin: [6, 0, 0, 0] },
    ],
    margin: [0, 0, 0, 3],
  };
  const filler = Array.from({ length: span - 1 }, (): TableCell => ({}));
  return {
    sectionTitle: title,
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: !splitRows,
      widths,
      body: [[heading, ...filler], ...rows],
    },
    layout: "noBorders",
    margin: [0, 0, 0, 10],
  };
}

// Номер шага в индиго-квадрате: «01».
function numberBadge(label: string): TableCell {
  return {
    table: {
      widths: [20],
      body: [[{ text: label, bold: true, color: "#ffffff", fillColor: INDIGO, alignment: "center", fontSize: 7.5, margin: [0, 3, 0, 3] }]],
    },
    layout: "noBorders",
  };
}

// «Урология (камни в почках)»; без скобок, если состояния нет.
function profileText({ specialty, condition }: PlanContent["profile"]): string {
  if (condition.trim() === "") return specialty;
  return specialty.trim() === "" ? condition : `${specialty} (${condition})`;
}

function header(options: PlanOptions): Content[] {
  return [
    {
      columns: [
        { image: logoImage(), width: 80 },
        {
          width: "*",
          stack: [
            { text: BRAND.tagline, bold: true, color: INDIGO, alignment: "right", fontSize: 8, characterSpacing: 0.4 },
            { text: formatRuDate(options.date), color: CAPTION, alignment: "right", fontSize: 8, margin: [0, 3, 0, 0] },
          ],
        },
      ],
    },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.8, lineColor: INK }], margin: [0, 6, 0, 0] },
    { text: BRAND.title, bold: true, fontSize: 14, color: INDIGO, margin: [0, 10, 0, 2] },
    { text: BRAND.subtitle, fontSize: 8.5, color: MUTED, margin: [0, 0, 0, 10] },
  ];
}

// Полоса ПАЦИЕНТ / ПОЛ / ДАТА / ПРОФИЛЬ: подпись мелко сверху, значение жирным.
function patientStrip(content: PlanContent, options: PlanOptions): Content {
  const cell = (label: string, value: string): TableCell => ({
    fillColor: TINT,
    stack: [
      { text: label, fontSize: 6.5, color: CAPTION, characterSpacing: 0.4 },
      { text: value, bold: true, fontSize: 9, margin: [0, 2, 0, 0] },
    ],
  });
  return {
    table: {
      widths: ["30%", "12%", "14%", "44%"],
      body: [
        [
          cell("ПАЦИЕНТ", content.patient.name || "—"),
          cell("ПОЛ", genderLabel(content.patient.gender)),
          cell("ДАТА", formatDotDate(options.date)),
          cell("ПРОФИЛЬ", profileText(content.profile)),
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
    margin: [0, 0, 0, 14],
  };
}

function overviewSection(items: string[]): SectionNode {
  return sectionNode(
    "МЕДИЦИНСКИЙ ОБЗОР",
    items.map((item): TableCell[] => [{ text: `— ${item}`, margin: [0, 1, 0, 1] }]),
    ["*"],
  );
}

// Таблица из двух колонок: подпись серым слева, текст справа. Строка печатается, только если поле непусто.
function diagnosisSection(title: string, diagnosis: PlanContent["diagnosis"]): SectionNode | undefined {
  const rows: Array<[string, string]> = [
    ["ДИАГНОЗ", diagnosis.text],
    ["ТЕКУЩЕЕ СОСТОЯНИЕ", diagnosis.state],
    ["ПОТЕНЦИАЛЬНАЯ ТАКТИКА", diagnosis.tactic],
    ["ТЕКУЩИЙ СТАТУС", diagnosis.status],
  ];
  const filled = rows.filter(([, value]) => value.trim() !== "");
  if (filled.length === 0) return undefined;
  return sectionNode(
    title,
    filled.map(([label, value]): TableCell[] => [
      { text: label, color: CAPTION, fontSize: 7, characterSpacing: 0.4, margin: [0, 2, 0, 0] },
      { text: value, margin: [0, 1, 0, 2] },
    ]),
    [130, "*"],
  );
}

function stepsSection(steps: string[]): SectionNode {
  return sectionNode(
    "ЧТО НЕОБХОДИМО СДЕЛАТЬ В ИНДИИ",
    steps.map((step, index): TableCell[] => [numberBadge(String(index + 1).padStart(2, "0")), { text: step, margin: [0, 3, 0, 3] }]),
    [26, "*"],
  );
}

// «— название — текст» по каждому пункту; абзац-вступление выше пунктов.
function tacticSection(tactic: PlanContent["tactic"]): SectionNode | undefined {
  const items = tactic.items.filter((item) => item.title.trim() !== "" || item.text.trim() !== "");
  const intro = tactic.intro.trim();
  if (intro === "" && items.length === 0) return undefined;
  const rows: TableCell[][] = [];
  if (intro !== "") rows.push([{ text: intro, margin: [0, 1, 0, 4] }]);
  for (const item of items) {
    const head: Content[] = item.title.trim() === "" ? [] : [{ text: item.title, bold: true }, { text: " — " }];
    rows.push([{ text: [{ text: "— " }, ...head, { text: item.text }], margin: [0, 1, 0, 3] }]);
  }
  return sectionNode("ВОЗМОЖНАЯ ТАКТИКА ЛЕЧЕНИЯ", rows, ["*"], true);
}

export function buildPlanDefinition({ content, options, status }: PlanPdfInput): TDocumentDefinitions {
  const body: Content[] = [...header(options), patientStrip(content, options)];

  const overviewItems = nonEmpty(content.overview);
  if (overviewItems.length > 0) body.push(overviewSection(overviewItems));

  const diagnosisTitle =
    options.diagnosisHeading === "by-documents" ? "ДИАГНОЗ ПО ПРЕДОСТАВЛЕННЫМ ДОКУМЕНТАМ" : "ПОДТВЕРЖДЁННЫЙ ДИАГНОЗ";
  const diagnosis = diagnosisSection(diagnosisTitle, content.diagnosis);
  if (diagnosis) body.push(diagnosis);

  const steps = nonEmpty(content.indiaSteps);
  if (steps.length > 0) body.push(stepsSection(steps));

  const tactic = tacticSection(content.tactic);
  if (tactic) {
    body.push(tactic);
    if (content.fixed.tacticDisclaimer.trim() !== "") {
      body.push({ text: content.fixed.tacticDisclaimer, italics: true, color: MUTED, margin: [0, 0, 0, 10] });
    }
  }

  return {
    pageSize: "A4",
    pageMargins: [34, 36, 34, 46],
    defaultStyle: { font: "DejaVu", fontSize: 8.5, color: INK },
    info: { title: BRAND.title, author: "Meditur HBG" },
    ...(status === "reviewed"
      ? {}
      : {
          watermark: { text: "ЧЕРНОВИК", font: "DejaVu", bold: true, fontSize: 110, color: "#9da3b0", opacity: 0.25, angle: -35 },
        }),
    footer: (currentPage: number, pageCount: number): Content => ({
      columns: [
        { text: BRAND.footer, fontSize: 7, color: FOOTER, width: "*" },
        {
          text: options.showPageNumbers ? `стр. ${currentPage} из ${pageCount}` : "",
          fontSize: 7,
          color: CAPTION,
          alignment: "right",
          width: "auto",
        },
      ],
      margin: [34, 0, 34, 0],
    }),
    content: body,
  };
}

// Заголовки разделов в порядке документа: узлы с полем sectionTitle.
export function planSectionTitles(def: TDocumentDefinitions): string[] {
  const titles: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === "object") {
      const { sectionTitle } = node as { sectionTitle?: unknown };
      if (typeof sectionTitle === "string") titles.push(sectionTitle);
      Object.values(node).forEach(visit);
    }
  };
  visit(def.content);
  return titles;
}

// Plan_<имя латиницей>_<дата>.pdf; для не проверенного плана перед .pdf добавляется _DRAFT.
export function planPdfFilename({
  patientName,
  date,
  status,
}: {
  patientName: string;
  date: string;
  status: PlanStatus;
}): string {
  const name = transliterate(patientName).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "patient";
  return `Plan_${name}_${date}${status === "reviewed" ? "" : "_DRAFT"}.pdf`;
}

export async function buildPlanPdf(input: PlanPdfInput): Promise<Buffer> {
  ensurePdfFonts();
  return pdfmake.createPdf(buildPlanDefinition(input)).getBuffer();
}

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

import { BRAND, DEFAULT_NOT_INCLUDED, UNVERIFIED_CLINICS_NOTE, verifiedClinicsNote } from "./defaults";
import { clinicLabel, formatAmount, formatDotDate, formatRuDate, genderLabel } from "./format";
import type {
  PlanClinic,
  PlanContent,
  PlanCostGroup,
  PlanCostRow,
  PlanFixed,
  PlanOptions,
  PlanStatus,
  PlanStayRow,
} from "./schema";

// Цвета формуляра (Global Constraints, раздел PDF).
const INDIGO = "#21268c";
const TINT = "#eef0fa";
const LINE = "#d6d9f0";
const INK = "#1a2433";
const MUTED = "#4b535f";
const CAPTION = "#6f767f";
const FOOTER = "#979ba2";
const GREEN = "#6dbb4d";
const ZEBRA = "#f7f9fc";
const WHITE = "#ffffff";

// Ширина области текста A4 при полях 34 pt слева и справа.
const CONTENT_WIDTH = 527;

type Widths = NonNullable<ContentTable["table"]["widths"]>;
type Align = "left" | "right" | "center";
type SectionOptions = { splitRows?: boolean; layout?: ContentTable["layout"]; columnHeader?: TableCell[] };
// Раздел: таблица с собственным полем sectionTitle (pdfmake неизвестные поля игнорирует).
type SectionNode = ContentTable & { sectionTitle: string };

// Сетка таблицы клиник: тонкие линии между строками и столбцами; под заголовком раздела и шапкой линий нет.
const GRID_LAYOUT = {
  hLineWidth: (i: number) => (i <= 2 ? 0 : 0.5),
  vLineWidth: () => 0.5,
  hLineColor: () => LINE,
  vLineColor: () => LINE,
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

// Линии только между строками (без верхней и вертикальных): таблица диагноза, пребывания, вложенные таблицы.
const LINES_LAYOUT = {
  hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
  vLineWidth: () => 0,
  hLineColor: () => LINE,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

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
// columnHeader — тёмная строка подписей столбцов сразу под заголовком (тоже повторяется).
// splitRows — для длинных абзацев: строки можно рвать по страницам; таблицы и списки не рвутся.
function sectionNode(
  title: string,
  rows: TableCell[][],
  widths: Widths,
  { splitRows = false, layout = "noBorders", columnHeader }: SectionOptions = {},
): SectionNode {
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
  const head: TableCell[][] = columnHeader ? [[heading, ...filler], columnHeader] : [[heading, ...filler]];
  return {
    sectionTitle: title,
    table: {
      headerRows: head.length,
      keepWithHeaderRows: 1,
      dontBreakRows: !splitRows,
      widths,
      body: [...head, ...rows],
    },
    layout,
    margin: [0, 0, 0, 10],
  };
}

// Шапка столбцов: тёмная полоса с подписями колонок, как в формуляре.
function columnHeader(labels: Array<[string, Align?]>): TableCell[] {
  return labels.map(([text, alignment = "left"]): TableCell => ({
    text,
    bold: true,
    color: WHITE,
    fillColor: INDIGO,
    fontSize: 7,
    characterSpacing: 0.4,
    alignment,
    margin: [4, 3, 4, 3],
  }));
}

// Пункт списка «— текст»: тире в узкой колонке, перенос строки встаёт под текст, а не под тире (висячий отступ).
function bullet(body: string | Content[], margin: [number, number, number, number] = [0, 1, 0, 1]): Content {
  return { columns: [{ text: "—", width: 12 }, { text: body, width: "*" }], margin };
}

// «название — текст» (тактика, предлагаемый подход): название жирным, если оно есть.
function titledText(title: string, text: string): Content[] {
  if (title.trim() === "") return [{ text }];
  return [{ text: title, bold: true }, { text: " — " }, { text }];
}

// Номер шага в индиго-квадрате: «01».
function numberBadge(label: string): ContentTable {
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
            { text: BRAND.tagline, bold: true, color: MUTED, alignment: "right", fontSize: 8, characterSpacing: 0.8 },
            { text: formatRuDate(options.date), color: CAPTION, alignment: "right", fontSize: 8, margin: [0, 3, 0, 0] },
          ],
        },
      ],
    },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.8, lineColor: INK }], margin: [0, 6, 0, 0] },
    { text: BRAND.title, bold: true, fontSize: 16, color: INDIGO, margin: [0, 10, 0, 2] },
    { text: BRAND.subtitle, italics: true, fontSize: 7.5, color: MUTED, margin: [0, 0, 0, 10] },
  ];
}

// Полоса ПАЦИЕНТ / ПОЛ / ДАТА / ПРОФИЛЬ: подпись мелко сверху, значение жирным.
function patientStrip(content: PlanContent, options: PlanOptions): Content {
  const cell = (label: string, value: string): TableCell => ({
    fillColor: TINT,
    stack: [
      { text: label, fontSize: 6.5, color: CAPTION, characterSpacing: 0.4 },
      { text: value, bold: true, color: INDIGO, fontSize: 9, margin: [0, 2, 0, 0] },
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
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
    margin: [0, 0, 0, 14],
  };
}

function overviewSection(items: string[]): SectionNode {
  return sectionNode(
    "МЕДИЦИНСКИЙ ОБЗОР",
    items.map((item): TableCell[] => [bullet(item)]),
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
      { text: label, color: CAPTION, fontSize: 7, characterSpacing: 0.4, fillColor: TINT },
      { text: value, bold: true, color: INDIGO },
    ]),
    [130, "*"],
    { layout: LINES_LAYOUT },
  );
}

// Шаги: номер в квадрате, каждая вторая строка с зеброй.
function stepsSection(steps: string[]): SectionNode {
  return sectionNode(
    "ЧТО НЕОБХОДИМО СДЕЛАТЬ В ИНДИИ",
    steps.map((step, index): TableCell[] => {
      const fillColor = index % 2 === 1 ? ZEBRA : undefined;
      return [
        { ...numberBadge(String(index + 1).padStart(2, "0")), fillColor },
        { text: step, margin: [0, 3, 0, 3], fillColor },
      ];
    }),
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
  for (const item of items) rows.push([bullet(titledText(item.title, item.text), [0, 1, 0, 3])]);
  return sectionNode("ВОЗМОЖНАЯ ТАКТИКА ЛЕЧЕНИЯ", rows, ["*"], { splitRows: true });
}

// НЕОБХОДИМЫЕ ДОКУМЕНТЫ: заголовок из письма или стандартный; пункты «— …».
function documentsSection(documents: PlanContent["documents"]): SectionNode | undefined {
  const items = nonEmpty(documents.items);
  if (items.length === 0) return undefined;
  return sectionNode(
    documents.title.trim() || "НЕОБХОДИМЫЕ ДОКУМЕНТЫ",
    items.map((item): TableCell[] => [bullet(item)]),
    ["*"],
  );
}

// РЕКОМЕНДОВАННЫЕ КЛИНИКИ: тёмная шапка столбцов; под таблицей — примечание о том, откуда сведения.
const CLINIC_WIDTHS: Widths = [24, 118, 92, 135, "*"];
function clinicsSection(clinics: PlanClinic[], options: PlanOptions): SectionNode | undefined {
  if (clinics.length === 0) return undefined;
  const rows: TableCell[][] = clinics.map((clinic, index): TableCell[] => {
    const fillColor = index % 2 === 1 ? ZEBRA : undefined;
    return [
      { text: String(index + 1), color: CAPTION, fillColor },
      { text: clinic.name, bold: true, color: INDIGO, fillColor },
      { text: clinic.area.trim() === "" ? clinic.city : `${clinic.city} (${clinic.area})`, fillColor },
      { text: clinic.doctor, fillColor },
      { text: clinic.why, fillColor },
    ];
  });
  const note = options.clinicsVerifiedOnSites ? verifiedClinicsNote(options.clinicsVerifiedMonth) : UNVERIFIED_CLINICS_NOTE;
  rows.push([{ text: note, italics: true, color: MUTED, fontSize: 7.5, colSpan: 5, margin: [0, 4, 0, 0] }, {}, {}, {}, {}]);
  return sectionNode("РЕКОМЕНДОВАННЫЕ КЛИНИКИ", rows, CLINIC_WIDTHS, {
    columnHeader: columnHeader([["№"], ["ГОСПИТАЛЬ"], ["ГОРОД"], ["РЕКОМЕНДУЕМЫЙ СПЕЦИАЛИСТ"], ["ПОЧЕМУ РАССМАТРИВАЕТСЯ"]]),
    layout: GRID_LAYOUT,
  });
}

// ПРЕДЛАГАЕМЫЙ ПОДХОД: абзацы, пункты «— название — текст» и примечание курсивом.
function approachSection(approach: PlanContent["approach"]): SectionNode | undefined {
  const paragraphs = nonEmpty(approach.paragraphs);
  const items = approach.items.filter((item) => item.title.trim() !== "" || item.text.trim() !== "");
  const note = approach.note.trim();
  if (paragraphs.length === 0 && items.length === 0 && note === "") return undefined;
  const rows: TableCell[][] = paragraphs.map((paragraph): TableCell[] => [{ text: paragraph, margin: [0, 1, 0, 3] }]);
  for (const item of items) rows.push([bullet(titledText(item.title, item.text))]);
  if (note !== "") rows.push([{ text: note, italics: true, color: MUTED, margin: [0, 2, 0, 0] }]);
  return sectionNode(approach.title.trim() || "ПРЕДЛАГАЕМЫЙ ПОДХОД", rows, ["*"], { splitRows: true });
}

// Подпись строки цены: название клиники из списка, если строка к ней привязана; иначе своя подпись; иначе «—».
function costRowLabel(row: PlanCostRow, clinics: PlanClinic[]): string {
  const clinic = row.clinicId === "" ? undefined : clinics.find((item) => item.id === row.clinicId);
  if (clinic) return clinicLabel(clinic);
  return row.label.trim() === "" ? "—" : row.label;
}

// Шапка группы цен: название жирным, примечание курсивом, шапка столбцов.
function costGroupHead(group: PlanCostGroup): TableCell[][] {
  const head: TableCell[][] = [[{ text: group.title, bold: true, color: INDIGO, colSpan: 2, margin: [0, 4, 0, 2] }, {}]];
  if (group.note.trim() !== "") head.push([{ text: group.note, italics: true, color: MUTED, colSpan: 2, margin: [0, 0, 0, 3] }, {}]);
  head.push(columnHeader([["УСЛУГА"], ["ОРИЕНТИРОВОЧНАЯ СТОИМОСТЬ, USD", "right"]]));
  return head;
}

// Строки группы цен: подпись слева, сумма справа жирным индиго.
function costGroupBody(group: PlanCostGroup, clinics: PlanClinic[]): TableCell[][] {
  return group.rows.map((row): TableCell[] => [
    { text: costRowLabel(row, clinics), margin: [0, 3, 0, 3] },
    { text: formatAmount(row.amount), bold: true, color: INDIGO, alignment: "right", margin: [0, 3, 0, 3] },
  ]);
}

const COST_WIDTHS: Widths = ["*", 190];

// Вторая и следующие группы — отдельные таблицы: название группы стоит в шапке (повторяется на новой странице).
function costGroupTable(group: PlanCostGroup, clinics: PlanClinic[]): ContentTable {
  const head = costGroupHead(group);
  return {
    table: {
      headerRows: head.length,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths: COST_WIDTHS,
      body: [...head, ...costGroupBody(group, clinics)],
    },
    layout: "noBorders",
    margin: [0, 0, 0, 10],
  };
}

// ОРИЕНТИРОВОЧНАЯ СТОИМОСТЬ: первая группа — в самом разделе, остальные — отдельными таблицами; в конце — сноска.
// Группы без строк не печатаются; если групп не осталось, раздела нет.
function costBlocks(costs: PlanContent["costs"], fixed: PlanFixed, clinics: PlanClinic[]): Content[] {
  const groups = costs.groups.filter((group) => group.rows.length > 0);
  if (groups.length === 0) return [];
  const [first, ...rest] = groups;
  if (!first) return [];
  const blocks: Content[] = [
    sectionNode("ОРИЕНТИРОВОЧНАЯ СТОИМОСТЬ", [...costGroupHead(first), ...costGroupBody(first, clinics)], COST_WIDTHS),
  ];
  for (const group of rest) blocks.push(costGroupTable(group, clinics));
  const footnote = costs.footnote.trim() || fixed.costFootnote.trim();
  if (footnote !== "") blocks.push({ text: footnote, italics: true, fontSize: 7.5, color: MUTED, margin: [0, 0, 0, 10] });
  return blocks;
}

// Полоса ОТКУДА → КУДА: два блока с подписями и стрелка между ними.
function routeStrip(from: string, to: string): Content {
  const place = (caption: string, value: string): TableCell => ({
    fillColor: TINT,
    stack: [
      { text: caption, fontSize: 6.5, color: CAPTION, characterSpacing: 0.4 },
      { text: value, bold: true, color: INDIGO, fontSize: 9, margin: [0, 2, 0, 0] },
    ],
  });
  return {
    table: {
      widths: ["*", 34, "*"],
      body: [
        [
          place("ОТКУДА", from),
          { text: "→", bold: true, color: INDIGO, fontSize: 12, alignment: "center", margin: [0, 6, 0, 0] },
          place("КУДА", to),
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
    margin: [0, 0, 0, 6],
  };
}

// Таблица «УСЛУГА | ОРИЕНТИРОВОЧНОЕ ВРЕМЯ»; итоговая строка жирным на подложке.
function stayTable(rows: PlanStayRow[]): Content {
  return {
    table: {
      widths: ["*", 150],
      body: [
        columnHeader([["УСЛУГА"], ["ОРИЕНТИРОВОЧНОЕ ВРЕМЯ", "right"]]),
        ...rows.map((row): TableCell[] => {
          const fillColor = row.total ? TINT : undefined;
          return [
            { text: row.label, bold: row.total, color: row.total ? INDIGO : INK, fillColor },
            { text: row.value, bold: true, color: INDIGO, alignment: "right", fillColor },
          ];
        }),
      ],
    },
    layout: LINES_LAYOUT,
  };
}

// ПРОЕЗД И ПРЕБЫВАНИЕ: полоса рейса (если рейс включён), строка рейса с пометкой проверки, таблица пребывания, сноска.
function travelSection(content: PlanContent): SectionNode | undefined {
  const { flights } = content.fixed;
  const stayRows = content.stay.rows;
  if (!flights.enabled && stayRows.length === 0) return undefined;
  const rows: TableCell[][] = [];
  if (flights.enabled) {
    rows.push([routeStrip(flights.from, flights.to)]);
    const caveat = flights.checkedOn
      ? `Информация о рейсах проверена ${formatDotDate(flights.checkedOn)} и подлежит уточнению перед бронированием.`
      : "Информация о рейсах подлежит уточнению перед бронированием.";
    rows.push([{ text: [{ text: `${flights.text} ` }, { text: caveat, italics: true, color: MUTED }], margin: [0, 0, 0, 6] }]);
  }
  if (stayRows.length > 0) rows.push([stayTable(stayRows)]);
  const note = content.stay.note.trim();
  if (note !== "") rows.push([{ text: note, italics: true, fontSize: 7.5, color: MUTED, margin: [0, 4, 0, 0] }]);
  if (rows.length === 0) return undefined;
  return sectionNode("ПРОЕЗД И ПРЕБЫВАНИЕ", rows, ["*"]);
}

// ЧТО ВКЛЮЧЕНО: две колонки под тёмной шапкой; ниже — что не включено (своё или стандартное).
function includedSection(included: string[], support: string[], notIncluded: string): SectionNode | undefined {
  const items = nonEmpty(included);
  const extras = nonEmpty(support);
  if (items.length === 0 && extras.length === 0) return undefined;
  const excluded = (notIncluded.trim() || DEFAULT_NOT_INCLUDED).replace(/\.+$/, "");
  return sectionNode(
    "ЧТО ВКЛЮЧЕНО",
    [
      [{ stack: items.map((item) => bullet(item)) }, { stack: extras.map((item) => bullet(item)) }],
      [{ text: `Не включено: ${excluded}.`, color: MUTED, colSpan: 2, margin: [0, 2, 0, 0] }, {}],
    ],
    ["*", "*"],
    { columnHeader: columnHeader([["В СТОИМОСТЬ ЛЕЧЕНИЯ"], ["ОРГАНИЗАЦИОННАЯ ПОДДЕРЖКА MEDITUR HBG"]]) },
  );
}

// Плашки шагов в строку, белые промежутки между ними; последний шаг зелёный.
function stepChips(steps: string[]): Content {
  const last = steps.length - 1;
  return {
    table: {
      widths: steps.map((): string => "*"),
      body: [
        steps.map((step, index): TableCell => ({
          text: step,
          bold: true,
          color: WHITE,
          fillColor: index === last ? GREEN : INDIGO,
          alignment: "center",
          fontSize: 7.5,
          margin: [0, 5, 0, 5],
        })),
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 || i === steps.length ? 0 : 4),
      vLineColor: () => WHITE,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 2],
  };
}

// СЛЕДУЮЩИЙ ШАГ печатается всегда: плашки шагов, призыв и контакты.
function nextStepSection(fixed: PlanFixed): SectionNode {
  const steps = nonEmpty(fixed.nextSteps);
  const rows: TableCell[][] = [];
  if (steps.length > 0) rows.push([stepChips(steps)]);
  rows.push([{ text: BRAND.nextStepCta, bold: true, color: INDIGO, margin: [0, 6, 0, 2] }]);
  rows.push([{ text: BRAND.contactLine, color: MUTED, fontSize: 8 }]);
  return sectionNode("СЛЕДУЮЩИЙ ШАГ", rows, ["*"]);
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
  if (tactic) body.push(tactic);

  const documents = documentsSection(content.documents);
  if (documents) body.push(documents);

  // Дисклеймер замыкает блок «тактика + документы»: после документов, если они есть, иначе после тактики (§10).
  const disclaimer = content.fixed.tacticDisclaimer.trim();
  if (disclaimer !== "" && (tactic || documents)) {
    body.push({ text: disclaimer, italics: true, color: MUTED, margin: [0, 0, 0, 10] });
  }

  const clinics = clinicsSection(content.clinics, options);
  if (clinics) body.push(clinics);

  const approach = approachSection(content.approach);
  if (approach) body.push(approach);

  body.push(...costBlocks(content.costs, content.fixed, content.clinics));

  const travel = travelSection(content);
  if (travel) body.push(travel);

  const included = includedSection(content.included, content.fixed.support, content.notIncluded);
  if (included) body.push(included);

  body.push(nextStepSection(content.fixed));

  return {
    pageSize: "A4",
    pageMargins: [34, 36, 34, 46],
    defaultStyle: { font: "DejaVu", fontSize: 9, color: INK },
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

import pdfmake from "pdfmake";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

import type { DossierData } from "@/lib/dossier";
import { ensurePdfFonts } from "@/lib/pdf-fonts";

// PDF собирается чистым JS (pdfmake) прямо на сервере — без браузера: на
// бесплатном Render (512 МБ) headless Chromium рядом с Next.js не влезает.
// Оригиналы фото в файл не вшиваются: они уходят в WhatsApp отдельными
// фото, а PDF остаётся лёгким (десятки КБ вместо десятков МБ).
// Шрифты настраивает lib/pdf-fonts.ts; досье, как и раньше, набрано шрифтом Roboto.

const ACCENT = "#1e3a8a";
const MUTED = "#64748b";

export interface DossierPatient {
  name: string;
  dateOfBirth?: string;
  gender?: string;
}

function formatCompiled(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function buildDossierDefinition(
  patient: DossierPatient,
  data: DossierData,
  compiledAt: Date = new Date()
): TDocumentDefinitions {
  const rule = (color = ACCENT, width = 1.5): Content => ({
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: width, lineColor: color }],
    margin: [0, 4, 0, 10],
  });

  const patientRows: Content[][] = [
    [{ text: "Patient", color: MUTED, fontSize: 9 }, { text: patient.name || "Not specified", bold: true }],
  ];
  if (patient.gender) patientRows.push([{ text: "Gender", color: MUTED, fontSize: 9 }, { text: patient.gender, bold: true }]);
  if (patient.dateOfBirth) {
    patientRows.push([{ text: "Date of birth", color: MUTED, fontSize: 9 }, { text: patient.dateOfBirth, bold: true }]);
  }

  const content: Content[] = [
    { text: "COMPREHENSIVE PATIENT DOSSIER", fontSize: 18, bold: true, color: ACCENT },
    { text: `Translated medical documents  |  Compiled: ${formatCompiled(compiledAt)}`, fontSize: 9, color: MUTED, margin: [0, 2, 0, 0] },
    rule(),
    {
      table: { widths: [90, "*"], body: patientRows },
      layout: "noBorders",
      margin: [0, 0, 0, 14],
    },
    {
      text: "The documents below are English translations prepared by the Meditour HBG case coordination team from the patient's original documents. The original documents are provided separately. A translation is not a diagnosis and must be interpreted by the attending physician together with the patient's clinical history and examination.",
      fontSize: 9,
      color: MUTED,
      margin: [0, 0, 0, 16],
    },
  ];

  if (data.sections.length > 0) {
    content.push({ text: "Contents", fontSize: 12, bold: true, color: ACCENT, margin: [0, 0, 0, 6] });
    content.push({
      table: {
        widths: [20, "*", 80],
        body: data.sections.map((s) => [
          { text: String(s.number), color: MUTED },
          { text: s.title },
          { text: s.date ?? "", color: MUTED, alignment: "right" },
        ]),
      },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, 10],
    });
  }

  if (data.imaging.length > 0) {
    content.push({
      text: "Imaging studies provided as original images (not translated)",
      fontSize: 12,
      bold: true,
      color: ACCENT,
      margin: [0, 8, 0, 6],
    });
    content.push({
      table: {
        widths: ["*", 80],
        body: data.imaging.map((i) => [{ text: i.title }, { text: i.date ?? "", color: MUTED, alignment: "right" }]),
      },
      layout: "lightHorizontalLines",
    });
  }

  data.sections.forEach((s) => {
    const meta = [s.date ? `Date: ${s.date}` : null, s.language ? `Original language: ${s.language}` : null]
      .filter(Boolean)
      .join("   |   ");
    content.push({
      text: `${s.number}. ${s.title}`,
      fontSize: 14,
      bold: true,
      color: ACCENT,
      pageBreak: "before",
    });
    if (meta) content.push({ text: meta, fontSize: 9, color: MUTED, margin: [0, 2, 0, 0] });
    content.push(rule("#cbd5e1", 0.5));
    // Абзацы сохраняются как в переводе; строки результатов анализов — по одной.
    content.push({ text: s.text, fontSize: 10.5, lineHeight: 1.25, preserveLeadingSpaces: true });
    if (s.hasUncertain) {
      content.push({
        text: "Fragments marked (illegible) or (?) could not be read reliably in the original document.",
        fontSize: 8.5,
        italics: true,
        color: MUTED,
        margin: [0, 10, 0, 0],
      });
    }
  });

  return {
    pageSize: "A4",
    pageMargins: [40, 48, 40, 52],
    defaultStyle: { font: "Roboto", fontSize: 10.5 },
    info: { title: `Patient dossier – ${patient.name || "translated documents"}`, author: "Meditour HBG" },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: "Meditour HBG – translated medical documents", fontSize: 8, color: MUTED, margin: [40, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: MUTED, alignment: "right", margin: [0, 0, 40, 0] },
      ],
    }),
    content,
  };
}

export async function buildDossierPdf(
  patient: DossierPatient,
  data: DossierData,
  compiledAt: Date = new Date()
): Promise<Buffer> {
  ensurePdfFonts();
  return pdfmake.createPdf(buildDossierDefinition(patient, data, compiledAt)).getBuffer();
}

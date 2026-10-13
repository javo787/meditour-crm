// Подготовка данных для PDF-досье и для контекста ассистента Medical Request.
// Чистая логика: из списка документов выбирает, что и в каком порядке идёт
// в итоговый файл.
import { languageName, sortDocuments } from "@/lib/documents";
import type { PatientDocument } from "@/lib/types";

export interface DossierSection {
  number: number;
  title: string;
  date?: string;
  language?: string;
  text: string;
  hasUncertain: boolean;
}

export interface DossierImagingItem {
  title: string;
  date?: string;
}

export interface DossierData {
  sections: DossierSection[];
  imaging: DossierImagingItem[];
  /** Включённые документы, которые координатор ещё не отметил как проверенные. */
  unreviewed: number;
  /** Документы, которые ещё в очереди или читаются — досье лучше собирать после них. */
  inProgress: number;
}

export function prepareDossier(docs: PatientDocument[]): DossierData {
  const inProgress = docs.filter((d) => d.status === "pending" || d.status === "processing").length;
  const ready = sortDocuments(docs.filter((d) => d.status === "done" && d.include));

  const reports = ready.filter((d) => d.category === "report" && (d.translationEn ?? "").trim() !== "");
  const imaging = ready.filter((d) => d.category === "imaging");

  return {
    sections: reports.map((d, i) => ({
      number: i + 1,
      title: d.title || d.filename,
      date: d.docDate,
      language: languageName(d.sourceLanguage),
      text: (d.translationEn ?? "").trim(),
      hasUncertain: (d.uncertain?.length ?? 0) > 0,
    })),
    imaging: imaging.map((d) => ({ title: d.title || d.filename, date: d.docDate })),
    unreviewed: [...reports, ...imaging].filter((d) => !d.reviewed).length,
    inProgress,
  };
}

/**
 * Блок для ассистента Medical Opinion Request: готовые переводы вместо
 * повторной отправки самих картинок в Gemini на каждом ходу диалога.
 */
export function buildDocumentsContext(docs: PatientDocument[]): string {
  const { sections, imaging } = prepareDossier(docs);
  if (sections.length === 0 && imaging.length === 0) return "";

  const lines: string[] = [
    "# PATIENT DOCUMENTS ALREADY READ AND TRANSLATED",
    "These are English translations of the patient's original documents, produced earlier from the files themselves. Use them as the source of clinical facts and do not ask the coordinator to retype them.",
  ];
  for (const s of sections) {
    lines.push("", `Document ${s.number}: ${s.title}${s.date ? ` (${s.date})` : ""}`, s.text);
  }
  if (imaging.length > 0) {
    lines.push("", "Imaging provided as original image files (not translated):");
    for (const i of imaging) lines.push(`- ${i.title}${i.date ? ` (${i.date})` : ""}`);
  }
  return lines.join("\n");
}

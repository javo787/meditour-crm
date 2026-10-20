// Подготовка данных для PDF-досье и для контекста ассистента Medical Request.
// Чистая логика: из списка документов выбирает, что и в каком порядке идёт
// в итоговый файл.
import { findDuplicatePairs, groupDocuments, languageName, sortDocuments } from "@/lib/documents";
import type { PatientDocument } from "@/lib/types";

export interface DossierSection {
  number: number;
  title: string;
  date?: string;
  language?: string;
  text: string;
  hasUncertain: boolean;
  handwritten: boolean;
}

export interface DossierImagingItem {
  title: string;
  date?: string;
}

export interface DossierData {
  sections: DossierSection[];
  imaging: DossierImagingItem[];
  /** Включённые документы (разделы), которые координатор ещё не отметил как проверенные. */
  unreviewed: number;
  /** Документы, которые ещё в очереди или читаются — досье лучше собирать после них. */
  inProgress: number;
  /** Пары номеров разделов, которые выглядят как две фото одного документа. */
  duplicates: Array<[number, number]>;
}

export function prepareDossier(docs: PatientDocument[]): DossierData {
  const inProgress = docs.filter((d) => d.status === "pending" || d.status === "processing").length;
  const allGroups = groupDocuments(docs);

  // Многостраничный документ — один раздел: страницы склеиваются по порядку,
  // название/дата/категория берутся с первой страницы (дата — с первой, где она есть).
  const ready = sortDocuments(
    allGroups
      .filter((g) => g.primary.status === "done" && g.primary.include)
      .map((group) => ({
        group,
        at: group.primary.at,
        docDate: group.primary.docDate ?? group.pages.find((p) => p.docDate)?.docDate,
      }))
  );

  const textOf = (pages: PatientDocument[]) =>
    pages
      .filter((p) => p.status === "done")
      .map((p) => (p.translationEn ?? "").trim())
      .filter(Boolean)
      .join("\n\n");

  const reports = ready.filter((r) => r.group.primary.category === "report" && textOf(r.group.pages) !== "");
  const imaging = ready.filter((r) => r.group.primary.category === "imaging");

  const sectionNumberByPrimary = new Map(reports.map((r, i) => [r.group.primary.id, i + 1]));
  const duplicates: Array<[number, number]> = [];
  for (const [a, b] of findDuplicatePairs(allGroups)) {
    const na = sectionNumberByPrimary.get(a.primary.id);
    const nb = sectionNumberByPrimary.get(b.primary.id);
    if (na && nb) duplicates.push(na < nb ? [na, nb] : [nb, na]);
  }

  const isReviewed = (pages: PatientDocument[]) => pages.filter((p) => p.status === "done").every((p) => p.reviewed);

  return {
    sections: reports.map((r, i) => ({
      number: i + 1,
      title: r.group.primary.title || r.group.primary.filename,
      date: r.docDate,
      language: languageName(r.group.primary.sourceLanguage),
      text: textOf(r.group.pages),
      hasUncertain: r.group.pages.some((p) => (p.uncertain?.length ?? 0) > 0),
      handwritten: r.group.pages.some((p) => p.handwritten === true),
    })),
    imaging: imaging.map((r) => ({ title: r.group.primary.title || r.group.primary.filename, date: r.docDate })),
    unreviewed: [...reports, ...imaging].filter((r) => !isReviewed(r.group.pages)).length,
    inProgress,
    duplicates,
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

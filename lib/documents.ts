// Чистая логика документов пациента: проверки результата разбора, порядок,
// даты, транслитерация. Без БД и без node-модулей — используется и на
// сервере, и в браузере (панель «Документы»).
import type { DocumentCategory, PatientDocument } from "@/lib/types";

export const ALLOWED_DOCUMENT_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_ATTEMPTS = 2;

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

/** Чистый MIME без параметров; если браузер не дал тип — по расширению. */
export function resolveMimeType(rawType: string | undefined, filename: string): string | undefined {
  const clean = (rawType ?? "").split(";")[0].trim().toLowerCase();
  if ((ALLOWED_DOCUMENT_MIME as readonly string[]).includes(clean)) return clean;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext];
}

// ───────────────────────── проверки перевода ─────────────────────────

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const NUMERIC_DATE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g;
const WORD_DATE = new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})[a-z]*\\.?\\s+\\d{4}\\b`, "gi");

/**
 * Числа из текста (десятичная запятая → точка). Даты вырезаются: в оригинале
 * «19.04.1988», в переводе «19 Apr 1988» — иначе каждая дата давала бы ложное
 * расхождение. Длинные числа (9+ цифр: ИНН, телефоны) не учитываются — по
 * правилам промпта они в перевод не переносятся.
 */
export function extractNumbers(text: string): string[] {
  const stripped = text.replace(NUMERIC_DATE, " ").replace(WORD_DATE, " ");
  const found = stripped.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const result = new Set<string>();
  for (const raw of found) {
    if (raw.replace(/\D/g, "").length >= 9) continue;
    const n = Number(raw.replace(",", "."));
    result.add(Number.isFinite(n) ? String(n) : raw);
  }
  return Array.from(result);
}

/** Числа, которые есть в оригинале, но пропали из перевода. */
export function missingNumbers(original: string, translation: string): string[] {
  const inTranslation = new Set(extractNumbers(translation));
  return extractNumbers(original).filter((n) => !inTranslation.has(n));
}

// ───────────────────────── имена ─────────────────────────

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ғ: "gh", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", ӣ: "i", й: "y", к: "k", қ: "q", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ӯ: "u", ф: "f", х: "kh", ҳ: "h", ч: "ch", ҷ: "j",
  ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", ў: "u",
};

/** Кириллица (русская и таджикская) → латиница в стиле загранпаспорта. */
export function transliterate(text: string): string {
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const mapped = TRANSLIT[lower];
    if (mapped === undefined) {
      out += ch;
    } else if (ch !== lower && mapped) {
      out += mapped[0].toUpperCase() + mapped.slice(1);
    } else {
      out += mapped;
    }
  }
  return out;
}

function nameTokens(name: string): string[] {
  return transliterate(name)
    .toLowerCase()
    .replace(/dzh/g, "j")
    .replace(/kh/g, "h")
    .replace(/gh/g, "g")
    .replace(/q/g, "k")
    .replace(/y/g, "i")
    .replace(/(.)\1+/g, "$1")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

/** Имя лида похоже на настоящее ФИО (а не ник, номер или «Контакт WhatsApp»). */
export function looksLikeRealName(name: string): boolean {
  if (/\d|whatsapp|@/i.test(name)) return false;
  return nameTokens(name).length >= 2;
}

/**
 * «match» — хотя бы одно слово имени совпало (с учётом разной транслитерации),
 * «mismatch» — ни одного, «unknown» — нечего сравнивать.
 */
export function compareNames(a: string | undefined, b: string | undefined): "match" | "mismatch" | "unknown" {
  const ta = nameTokens(a ?? "");
  const tb = nameTokens(b ?? "");
  if (ta.length === 0 || tb.length === 0) return "unknown";
  for (const x of ta) {
    for (const y of tb) {
      const limit = Math.min(x.length, y.length) >= 6 ? 2 : 1;
      if (x.slice(0, 4) === y.slice(0, 4) || editDistance(x, y) <= limit) return "match";
    }
  }
  return "mismatch";
}

// ───────────────────────── результат разбора ─────────────────────────

export interface ExtractedDocument {
  category: DocumentCategory;
  title: string;
  docDate?: string;
  sourceLanguage?: string;
  patientNameOnDoc?: string;
  originalText: string;
  translationEn: string;
  uncertain: string[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseExtractionJson(raw: string): ExtractedDocument {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object") throw new Error("Ответ модели не объект");

  const category: DocumentCategory =
    parsed.category === "report" || parsed.category === "imaging" ? parsed.category : "other";
  const date = str(parsed.docDate);
  return {
    category,
    title: str(parsed.title) || "Untitled document",
    docDate: date && date.toLowerCase() !== "null" ? date : undefined,
    sourceLanguage: str(parsed.sourceLanguage) || undefined,
    patientNameOnDoc: str(parsed.patientNameOnDoc) || undefined,
    originalText: category === "report" ? str(parsed.originalText) : "",
    translationEn: category === "report" ? str(parsed.translationEn) : "",
    uncertain: Array.isArray(parsed.uncertain)
      ? parsed.uncertain.filter((u: unknown): u is string => typeof u === "string" && u.trim() !== "")
      : [],
  };
}

/** Предупреждения для координатора (по-русски), показываются в панели. */
export function buildWarnings(params: {
  extracted: ExtractedDocument;
  leadName?: string;
}): string[] {
  const { extracted, leadName } = params;
  const warnings: string[] = [];

  if (extracted.category === "report") {
    if (!extracted.translationEn) {
      warnings.push("Перевод пустой — модель не вернула текст. Нажмите «Повторить».");
    } else {
      const missing = missingNumbers(extracted.originalText, extracted.translationEn);
      if (missing.length > 0) {
        warnings.push(
          `В переводе не найдены числа из оригинала: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}. Сверьте с фото.`
        );
      }
    }
    if (extracted.uncertain.length > 0) {
      warnings.push(`Есть неразборчивые места (${extracted.uncertain.length}) — проверьте по фото.`);
    }
  }

  if (
    extracted.patientNameOnDoc &&
    leadName &&
    looksLikeRealName(leadName) &&
    compareNames(extracted.patientNameOnDoc, leadName) === "mismatch"
  ) {
    warnings.push(
      `Имя в документе («${extracted.patientNameOnDoc}») не похоже на имя лида («${leadName}») — возможно, чужой документ.`
    );
  }
  return warnings;
}

// ───────────────────────── даты, порядок, язык ─────────────────────────

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** «12 Mar 2026» / «Mar 2026» / «2026-03-12» / «2026» → timestamp или null. */
export function parseDocDate(value: string | undefined): number | null {
  if (!value) return null;
  const s = value.trim();
  let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  if (m && MONTH_INDEX[m[2].toLowerCase()] !== undefined) {
    return Date.UTC(Number(m[3]), MONTH_INDEX[m[2].toLowerCase()], Number(m[1]));
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  if (m && MONTH_INDEX[m[1].toLowerCase()] !== undefined) {
    return Date.UTC(Number(m[2]), MONTH_INDEX[m[1].toLowerCase()], 1);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{4})$/);
  if (m) return Date.UTC(Number(m[1]), 0, 1);
  return null;
}

/** По дате документа (старые первыми); без даты — в конец, по порядку добавления. */
export function sortDocuments<T extends Pick<PatientDocument, "docDate" | "at">>(docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const da = parseDocDate(a.docDate);
    const db = parseDocDate(b.docDate);
    if (da !== null && db !== null && da !== db) return da - db;
    if (da !== null && db === null) return -1;
    if (da === null && db !== null) return 1;
    return a.at.localeCompare(b.at);
  });
}

const LANGUAGE_NAMES: Record<string, string> = {
  ru: "Russian", tg: "Tajik", uz: "Uzbek", en: "English", fa: "Persian", kk: "Kazakh", ky: "Kyrgyz",
  tr: "Turkish", ar: "Arabic",
};

export function languageName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return LANGUAGE_NAMES[code.toLowerCase().slice(0, 2)] ?? code;
}

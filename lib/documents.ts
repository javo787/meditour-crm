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
      // Допуск растёт с длиной слова: Bobojonov ↔ Bobochnovo — одно имя, а
      // Bobojonov ↔ Boboeva (общее только начало «Bobo») — разные.
      const shortest = Math.min(x.length, y.length);
      const limit = shortest >= 9 ? 3 : shortest >= 6 ? 2 : 1;
      if (editDistance(x, y) <= limit) return "match";
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
  patientDob?: string;
  patientGender?: "Male" | "Female";
  handwritten: boolean;
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
  const orUndefined = (v: unknown) => {
    const t = str(v);
    return t && t.toLowerCase() !== "null" ? t : undefined;
  };
  const gender = str(parsed.patientGender).toLowerCase();
  return {
    category,
    title: str(parsed.title) || "Untitled document",
    docDate: orUndefined(parsed.docDate),
    sourceLanguage: str(parsed.sourceLanguage) || undefined,
    patientNameOnDoc: orUndefined(parsed.patientNameOnDoc),
    patientDob: orUndefined(parsed.patientDob),
    patientGender: gender.startsWith("m") ? "Male" : gender.startsWith("f") ? "Female" : undefined,
    handwritten: parsed.handwritten === true,
    originalText: category === "report" ? str(parsed.originalText) : "",
    translationEn: category === "report" ? str(parsed.translationEn) : "",
    uncertain: Array.isArray(parsed.uncertain)
      ? parsed.uncertain.filter((u: unknown): u is string => typeof u === "string" && u.trim() !== "")
      : [],
  };
}

/** Доля строк, где текст не прочитан вовсе (одно «(illegible)» без содержания). */
export function illegibleLineStats(text: string): { total: number; empty: number } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const empty = lines.filter((l) => l.replace(/\(illegible\)/gi, "").replace(/[^\p{L}\p{N}]/gu, "").length < 4).length;
  return { total: lines.length, empty };
}

/** Почти весь документ не прочитан — в PDF такой лист только занимает место. */
export function isMostlyIllegible(text: string): boolean {
  const { total, empty } = illegibleLineStats(text);
  return empty >= 3 && total > 0 && empty / total >= 0.4;
}

/** Предупреждения для координатора (по-русски), показываются в панели. */
export function buildWarnings(params: {
  extracted: ExtractedDocument;
  leadName?: string;
  /** Имя пациента латиницей из профиля досье — главный эталон для сверки имён. */
  profileName?: string;
}): string[] {
  const { extracted, leadName, profileName } = params;
  const warnings: string[] = [];

  if (extracted.category === "report") {
    if (!extracted.translationEn) {
      warnings.push("Перевод пустой — модель не вернула текст. Нажмите «Заново».");
    } else {
      const missing = missingNumbers(extracted.originalText, extracted.translationEn);
      if (missing.length > 0) {
        warnings.push(
          `В переводе не найдены числа из оригинала: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}. Сверьте с фото.`
        );
      }
      if (isMostlyIllegible(extracted.translationEn)) {
        warnings.push("Почти весь текст неразборчив — документ не включён в PDF. Включите вручную, если он всё же нужен.");
      }
    }
    if (extracted.uncertain.length > 0) {
      warnings.push(`Есть неразборчивые места (${extracted.uncertain.length}) — проверьте по фото.`);
    }
    if (extracted.handwritten) {
      warnings.push("Рукописный документ: названия препаратов, дозы и даты обязательно сверьте с фото.");
    }
  }

  const reference = profileName?.trim() || (leadName && looksLikeRealName(leadName) ? leadName : undefined);
  if (extracted.patientNameOnDoc && reference && compareNames(extracted.patientNameOnDoc, reference) === "mismatch") {
    warnings.push(
      `Имя в документе («${extracted.patientNameOnDoc}») не похоже на имя пациента («${reference}») — возможно, чужой документ.`
    );
  }
  return warnings;
}

// ───────────────────────── многостраничные документы и сверка между документами ─────────────────────────

export interface DocumentGroup {
  /** Первая страница: от неё название, дата и категория раздела. */
  primary: PatientDocument;
  /** Все страницы по порядку, включая первую. */
  pages: PatientDocument[];
}

/**
 * Склеивает страницы: документы с mergedInto идут за своим главным документом.
 * Если главный документ удалён (или сам оказался страницей), страница
 * остаётся самостоятельным документом.
 */
export function groupDocuments(docs: PatientDocument[]): DocumentGroup[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const isPage = (d: PatientDocument) => {
    const parent = d.mergedInto ? byId.get(d.mergedInto) : undefined;
    return Boolean(parent && !parent.mergedInto);
  };
  const children = new Map<string, PatientDocument[]>();
  for (const d of docs) {
    if (d.mergedInto && isPage(d)) {
      children.set(d.mergedInto, [...(children.get(d.mergedInto) ?? []), d]);
    }
  }
  return docs
    .filter((d) => !isPage(d))
    .map((primary) => ({
      primary,
      pages: [
        primary,
        ...(children.get(primary.id) ?? []).sort(
          (a, b) => (a.pageNo ?? 0) - (b.pageNo ?? 0) || a.at.localeCompare(b.at)
        ),
      ],
    }));
}

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of Array.from(a)) if (b.has(w)) common++;
  return common / (a.size + b.size - common);
}

function groupText(group: DocumentGroup, field: "originalText" | "translationEn"): string {
  return group.pages.map((p) => p[field] ?? "").join("\n");
}

/** Пары разделов, которые почти совпадают по тексту (две фото одного документа). */
export function findDuplicatePairs(groups: DocumentGroup[]): Array<[DocumentGroup, DocumentGroup]> {
  const eligible = groups.filter((g) => g.primary.status === "done" && g.primary.category === "report");
  const sets = eligible.map((g) => ({
    original: wordSet(groupText(g, "originalText")),
    translation: wordSet(groupText(g, "translationEn")),
  }));
  const pairs: Array<[DocumentGroup, DocumentGroup]> = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      if (Math.min(sets[i].translation.size, sets[j].translation.size) < 15) continue;
      const similarity = Math.max(
        jaccard(sets[i].original, sets[j].original),
        jaccard(sets[i].translation, sets[j].translation)
      );
      if (similarity >= 0.6) pairs.push([eligible[i], eligible[j]]);
    }
  }
  return pairs;
}

function yearOf(value: string | undefined): number | null {
  const ts = parseDocDate(value);
  return ts === null ? null : new Date(ts).getUTCFullYear();
}

function majority<T>(values: T[], key: (v: T) => string): T | undefined {
  const counts = new Map<string, { value: T; n: number }>();
  for (const v of values) {
    const k = key(v);
    const entry = counts.get(k);
    if (entry) entry.n++;
    else counts.set(k, { value: v, n: 1 });
  }
  const best = Array.from(counts.values()).sort((a, b) => b.n - a.n)[0];
  return best && best.n >= 2 ? best.value : undefined;
}

/** Самая частая дата рождения и пол среди разобранных документов — подсказка для титульной страницы. */
export function suggestProfile(docs: PatientDocument[]): { dob?: string; gender?: "Male" | "Female" } {
  const done = docs.filter((d) => d.status === "done");
  const fullDobs = done.map((d) => d.patientDob).filter((v): v is string => {
    const ts = parseDocDate(v);
    return ts !== null && !/^\d{4}$/.test(v ?? "");
  });
  const dob = majority(fullDobs, (v) => String(parseDocDate(v)));
  const gender = majority(
    done.map((d) => d.patientGender).filter((g): g is "Male" | "Female" => Boolean(g)),
    (g) => g
  );
  return { dob, gender };
}

/**
 * Предупреждения, которые видны только при сравнении документов друг с другом:
 * дубли, дата рождения не как у остальных, год документа далеко от остальных.
 * Считаются на лету (не хранятся), поэтому всегда актуальны.
 */
export function crossDocumentWarnings(docs: PatientDocument[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const add = (id: string, text: string) => result.set(id, [...(result.get(id) ?? []), text]);
  const groups = groupDocuments(docs);

  for (const [a, b] of findDuplicatePairs(groups)) {
    add(a.primary.id, `Похоже на дубль документа «${b.primary.title ?? b.primary.filename}» — оставьте один.`);
    add(b.primary.id, `Похоже на дубль документа «${a.primary.title ?? a.primary.filename}» — оставьте один.`);
  }

  const done = docs.filter((d) => d.status === "done" && d.category !== "other");

  // Дата рождения: сверяем с самой частой по дню или, если на документе только год, по году.
  const commonDob = suggestProfile(docs).dob;
  if (commonDob) {
    const commonTs = parseDocDate(commonDob);
    const commonYear = yearOf(commonDob);
    for (const d of done) {
      const ts = parseDocDate(d.patientDob);
      if (!d.patientDob || ts === null) continue;
      const yearOnly = /^\d{4}$/.test(d.patientDob.trim());
      const differs = yearOnly ? yearOf(d.patientDob) !== commonYear : ts !== commonTs;
      if (differs) {
        add(d.id, `Дата рождения в документе (${d.patientDob}) не совпадает с остальными (${commonDob}) — проверьте, тот ли это пациент.`);
      }
    }
  }

  // Год документа далеко от медианы: так выглядит ошибка чтения цифр (2026 → 2020).
  const years = done.map((d) => yearOf(d.docDate)).filter((y): y is number => y !== null).sort((a, b) => a - b);
  if (years.length >= 3) {
    const median = years[Math.floor(years.length / 2)];
    for (const d of done) {
      const y = yearOf(d.docDate);
      if (y !== null && Math.abs(y - median) >= 3) {
        add(d.id, `Год документа (${y}) сильно отличается от остальных (около ${median}) — сверьте дату с фото.`);
      }
    }
  }
  return result;
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

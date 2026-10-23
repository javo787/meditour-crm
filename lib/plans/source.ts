// Подготовка письма и .docx для плана: вырезаем ссылки, почту и телефоны, проверяем размер,
// достаём текст из .docx без картинок. Вход в CRM закрыт паролем, поэтому защита от «бомб» простая.
import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { PLAN_LIMITS } from "./schema";

export type PlanInputErrorCode = "empty" | "too-long" | "bad-docx" | "docx-too-big" | "docx-unsafe";

// Тексты для интерфейса: показываются координатору как есть.
const MESSAGES: Record<PlanInputErrorCode, string> = {
  empty: "Письмо пустое или слишком короткое. Вставьте текст письма целиком.",
  "too-long": `Письмо длиннее ${PLAN_LIMITS.sourceChars} символов. Сократите его или разделите на части.`,
  "bad-docx": "Файл не читается как .docx. Сохраните его заново в формате .docx или вставьте текст письма.",
  "docx-too-big": `Файл .docx больше ${PLAN_LIMITS.docxBytes / 1024 / 1024} МБ.`,
  "docx-unsafe": "Файл .docx слишком велик после распаковки. Вставьте текст письма вручную.",
};

export class PlanInputError extends Error {
  readonly code: PlanInputErrorCode;

  constructor(code: PlanInputErrorCode) {
    super(MESSAGES[code]);
    this.name = "PlanInputError";
    this.code = code;
  }
}

// Ссылки, почта и телефоны: их не отдаём модели и не печатаем в плане.
// Телефон — только в трёх случаях: (а) «+» и ≥ 9 цифр; (б) после tel, phone, mobile, call и т. п.
// и символа «:», «.» или пробела — ≥ 8 цифр; (в) ≥ 10 цифр подряд. Суммы без «+» и без такого слова не совпадают.
const CONTACT_RULES: { re: RegExp; minDigits: number }[] = [
  { re: /(?:https?:\/\/|www\.|pin\.it\/)\S+/gi, minDigits: 0 },
  { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, minDigits: 0 },
  { re: /\(?\+\d[  \-()\d]*\d/g, minDigits: 9 },
  // Группа в скобках — только цифры: слово-ключ остаётся в тексте.
  { re: /\b(?:tel|phone|mobile|mob|cell|call|whatsapp|contact|ph)[.:  ][  ]*(\d[  \-()\d]*\d)/gi, minDigits: 8 },
  { re: /\d{10,}/g, minDigits: 10 },
];

// Диапазоны [начало, конец) найденных контактов: по возрастанию, без перекрытий.
function contactSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const { re, minDigits } of CONTACT_RULES) {
    for (const m of text.matchAll(re)) {
      const hit = m[1] ?? m[0];
      if (hit.replace(/\D/g, "").length < minDigits) continue;
      // Группа цифр всегда стоит в конце совпадения.
      const start = (m.index ?? 0) + m[0].length - hit.length;
      spans.push([start, start + hit.length]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

// Найденные ссылки, почта и телефоны, в порядке появления.
export function findContacts(text: string): string[] {
  return contactSpans(text).map(([start, end]) => text.slice(start, end));
}

// Вырезает контакты; двойные пробелы и пробелы по краям строк убирает.
export function stripContacts(text: string): string {
  let out = "";
  let pos = 0;
  for (const [start, end] of contactSpans(text)) {
    out += text.slice(pos, start);
    pos = end;
  }
  out += text.slice(pos);
  return out
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n");
}

// Приглашения перейти на сайт отправителя и «виртуальный тур» — реклама, а не медицинский текст.
// В письмах они стоят В КОНЦЕ абзаца про госпиталь или врача («… Click on the link: <url>»), а ссылки к
// этому моменту уже вырезаны. Поэтому удаляем только такое предложение, а не всю строку: иначе вместе
// с ним пропадают название госпиталя, его описание и имя врача, и модель путает, чей это врач.
const TOUR_SENTENCE = /virtual tour|visual tour|click on (?:the )?link|via (?:the )?link/i;

// Оставляет в строке всё, кроме предложений-приглашений. «Dr.» даёт ложную границу предложения, но
// уцелевшие части склеиваются обратно через пробел, так что текст не портится.
export function dropTourSentences(line: string): string {
  if (!TOUR_SENTENCE.test(line)) return line;
  return line
    .split(/(?<=[.!?])\s+/)
    .filter((part) => !TOUR_SENTENCE.test(part))
    .join(" ");
}

// Письмо, готовое к отправке модели: без контактов и рекламы, с проверенной длиной.
export function prepareSource(text: string): string {
  // Длина считается по тексту как вставлен (до замены переводов строк).
  if (text.length > PLAN_LIMITS.sourceChars) throw new PlanInputError("too-long");
  const cleaned = stripContacts(text.replace(/\r\n/g, "\n"))
    .split("\n")
    .flatMap((line) => {
      const kept = dropTourSentences(line);
      // Строка, целиком состоявшая из рекламы, исчезает; пустые строки письма остаются как были.
      return kept === "" && line !== "" ? [] : [kept];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length < 30) throw new PlanInputError("empty");
  return cleaned;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const decodeEntities = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name]);

// Теги, которые разрывают строку: абзацы, списки, таблицы, переводы строк.
const BLOCK_TAG = /<\/?(?:p|div|h[1-6]|ul|ol|li|table|tbody|thead|tr|br)\b[^>]*>/gi;

// Текст ячейки таблицы: абзацы внутри ячейки склеиваются пробелом.
const cellText = (html: string) =>
  decodeEntities(html.replace(BLOCK_TAG, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// HTML из mammoth → обычный текст: абзац — строка, строка таблицы — «A | B | C», пункт списка — «- …».
export function htmlToPlainText(html: string): string {
  const withRows = html.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row: string) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cellText(m[1])).filter(Boolean);
    return `${cells.join(" | ")}\n`;
  });
  const text = withRows
    .replace(/<li\b[^>]*>(\s*<p\b[^>]*>)?/gi, "\n- ")
    .replace(BLOCK_TAG, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "" && line !== "-")
    .join("\n");
}

const ZIP_LOCAL_SIGNATURE = 0x04034b50; // «PK\x03\x04» в начале архива
const ZIP_END_SIGNATURE = 0x06054b50; // конец оглавления (End of Central Directory)
const ZIP_ENTRY_SIGNATURE = 0x02014b50; // запись оглавления
const MAX_ENTRIES = 2000;

// Конец оглавления ищем с конца: после него может идти комментарий до 65 535 байт.
function findEndOfDirectory(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === ZIP_END_SIGNATURE) return i;
  }
  return -1;
}

// Проверка по оглавлению архива, до распаковки: размер файла, число записей и сумма распакованных размеров.
export function assertDocxSafe(buffer: Buffer): void {
  if (buffer.length > PLAN_LIMITS.docxBytes) throw new PlanInputError("docx-too-big");
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE) throw new PlanInputError("bad-docx");
  const end = findEndOfDirectory(buffer);
  if (end < 0) throw new PlanInputError("bad-docx");
  const entries = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  // Маркеры ZIP64 и слишком много записей: такой архив не разбираем.
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new PlanInputError("docx-unsafe");
  }
  if (entries > MAX_ENTRIES) throw new PlanInputError("docx-unsafe");
  if (directoryOffset + directorySize > end) throw new PlanInputError("bad-docx");
  let total = 0;
  let pos = directoryOffset;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > end || buffer.readUInt32LE(pos) !== ZIP_ENTRY_SIGNATURE) throw new PlanInputError("bad-docx");
    const size = buffer.readUInt32LE(pos + 24); // распакованный размер записи
    if (size === 0xffffffff) throw new PlanInputError("docx-unsafe");
    total += size;
    if (total > PLAN_LIMITS.docxUnpackedBytes) throw new PlanInputError("docx-unsafe");
    pos += 46 + buffer.readUInt16LE(pos + 28) + buffer.readUInt16LE(pos + 30) + buffer.readUInt16LE(pos + 32);
  }
}

// Текст .docx. Картинки не читаются в память; любая ошибка разбора — «bad-docx».
export async function docxToText(buffer: Buffer): Promise<string> {
  assertDocxSafe(buffer);
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
    );
    html = result.value;
  } catch {
    throw new PlanInputError("bad-docx");
  }
  return htmlToPlainText(html);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

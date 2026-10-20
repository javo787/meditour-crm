// Автопроверки плана: детерминированные правила без модели (таблица — в спецификации, §7).
// Пересчитываются при каждом сохранении: ошибки блокируют «Проверено», предупреждения — подсказки координатору.
import { compareNames, looksLikeRealName } from "@/lib/documents";
import { amountNumbers, letterMoneyNumbers, todayInZone } from "./format";
import { PLAN_LIMITS } from "./schema";
import type { PlanContent, PlanOptions, PlanWarning } from "./schema";
import { findContacts } from "./source";

export interface PlanCheckInput {
  content: PlanContent;
  options: PlanOptions;
  source: string; // письмо после prepareSource
  leadName?: string;
  now?: Date;
  senderNames?: string[]; // по умолчанию — из PLAN_SENDER_NAMES
}

export interface PrintedString {
  path: string;
  text: string;
}

// Все строки, которые попадают в PDF. Цитаты из письма (evidence) и пометки модели (letterIssues) не печатаются.
export function printedStrings(content: PlanContent): PrintedString[] {
  const out: PrintedString[] = [];
  const add = (path: string, text: string) => {
    if (text.trim() !== "") out.push({ path, text });
  };
  add("patient.name", content.patient.name);
  add("profile.specialty", content.profile.specialty);
  add("profile.condition", content.profile.condition);
  content.overview.forEach((t, i) => add(`overview[${i}]`, t));
  add("diagnosis.text", content.diagnosis.text);
  add("diagnosis.state", content.diagnosis.state);
  add("diagnosis.tactic", content.diagnosis.tactic);
  add("diagnosis.status", content.diagnosis.status);
  content.indiaSteps.forEach((t, i) => add(`indiaSteps[${i}]`, t));
  add("tactic.intro", content.tactic.intro);
  content.tactic.items.forEach((item, i) => {
    add(`tactic.items[${i}].title`, item.title);
    add(`tactic.items[${i}].text`, item.text);
  });
  add("documents.title", content.documents.title);
  content.documents.items.forEach((t, i) => add(`documents.items[${i}]`, t));
  add("approach.title", content.approach.title);
  content.approach.paragraphs.forEach((t, i) => add(`approach.paragraphs[${i}]`, t));
  content.approach.items.forEach((item, i) => {
    add(`approach.items[${i}].title`, item.title);
    add(`approach.items[${i}].text`, item.text);
  });
  add("approach.note", content.approach.note);
  content.clinics.forEach((c, i) => {
    add(`clinics[${i}].name`, c.name);
    add(`clinics[${i}].shortName`, c.shortName);
    add(`clinics[${i}].city`, c.city);
    add(`clinics[${i}].area`, c.area);
    add(`clinics[${i}].doctor`, c.doctor);
    add(`clinics[${i}].why`, c.why);
  });
  content.costs.groups.forEach((g, i) => {
    add(`costs.groups[${i}].title`, g.title);
    add(`costs.groups[${i}].note`, g.note);
    g.rows.forEach((row, j) => {
      add(`costs.groups[${i}].rows[${j}].label`, row.label);
      add(`costs.groups[${i}].rows[${j}].amount`, row.amount);
    });
  });
  add("costs.footnote", content.costs.footnote);
  content.stay.rows.forEach((row, i) => {
    add(`stay.rows[${i}].label`, row.label);
    add(`stay.rows[${i}].value`, row.value);
  });
  add("stay.note", content.stay.note);
  content.included.forEach((t, i) => add(`included[${i}]`, t));
  add("notIncluded", content.notIncluded);
  add("fixed.tacticDisclaimer", content.fixed.tacticDisclaimer);
  add("fixed.costFootnote", content.fixed.costFootnote);
  add("fixed.flights.from", content.fixed.flights.from);
  add("fixed.flights.to", content.fixed.flights.to);
  add("fixed.flights.text", content.fixed.flights.text);
  content.fixed.support.forEach((t, i) => add(`fixed.support[${i}]`, t));
  content.fixed.nextSteps.forEach((t, i) => add(`fixed.nextSteps[${i}]`, t));
  return out;
}

// Для поиска подстроки: нижний регистр, неразрывный пробел → пробел, пробелы схлопнуты.
const normalize = (text: string) => text.toLowerCase().replace(/ /g, " ").replace(/\s+/g, " ").trim();

// Символ вне латиницы, кириллицы, греческого и общих знаков, либо эмодзи: шрифт PDF его не покажет.
const FOREIGN_GLYPH = /[^\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Common}\p{Script=Inherited}]|\p{Emoji_Presentation}/u;

const LEVEL_ORDER: Record<PlanWarning["level"], number> = { error: 0, warn: 1, info: 2 };

// Названия агентства-отправителя из PLAN_SENDER_NAMES (через запятую). В репозитории значений нет.
function senderNamesFromEnv(): string[] {
  return (process.env.PLAN_SENDER_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Дни от одной ISO-даты до другой (даты без времени, UTC).
const daysBetween = (fromIso: string, toIso: string) => (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;

// Проверки плана: сначала ошибки, потом предупреждения, потом подсказки; внутри уровня — порядок правил.
export function runPlanChecks(input: PlanCheckInput): PlanWarning[] {
  const { content, options, source } = input;
  const now = input.now ?? new Date();
  const senderNames = (input.senderNames ?? senderNamesFromEnv()).filter((name) => normalize(name) !== "");
  const leadName = input.leadName ?? "";
  const printed = printedStrings(content);
  const printedNumbers = new Set(printed.flatMap((p) => amountNumbers(p.text)));
  const sourceNumbers = new Set(amountNumbers(source));
  const normalizedSource = normalize(source);
  const clinicIds = new Set(content.clinics.map((c) => c.id));
  const rows = content.costs.groups.flatMap((group, i) =>
    group.rows.map((row, j) => ({ row, path: `costs.groups[${i}].rows[${j}]` })),
  );
  const clinics = content.clinics.map((clinic, i) => ({ clinic, path: `clinics[${i}]` }));
  const warnings: PlanWarning[] = [];
  const push = (code: string, level: PlanWarning["level"], message: string, path?: string) =>
    warnings.push({ code, level, message, ...(path === undefined ? {} : { path }) });

  // Ошибки
  for (const n of new Set(letterMoneyNumbers(source))) {
    if (!printedNumbers.has(n)) push("money-missing", "error", `В письме есть сумма ${n} USD, а в плане её нет`);
  }
  for (const { row, path } of rows) {
    const invented = amountNumbers(row.amount).find((n) => !sourceNumbers.has(n));
    if (invented !== undefined) push("money-invented", "error", `Суммы ${invented} нет в письме`, `${path}.amount`);
  }
  for (const { row, path } of rows) {
    if (row.evidence.trim() === "") continue;
    const evidenceNumbers = amountNumbers(row.evidence);
    const quoted = normalizedSource.includes(normalize(row.evidence));
    if (!quoted || amountNumbers(row.amount).some((n) => !evidenceNumbers.includes(n))) {
      push("money-evidence", "error", `Цитата из письма не найдена или не содержит сумму ${row.amount}`, `${path}.evidence`);
    }
  }
  for (const { row, path } of rows) {
    if (row.clinicId !== "" && !clinicIds.has(row.clinicId)) {
      push("price-unknown-clinic", "error", "Строка цены ссылается на клинику, которой нет в списке", `${path}.clinicId`);
    }
  }
  if (looksLikeRealName(leadName) && compareNames(content.patient.name, leadName) === "mismatch") {
    push("name-mismatch", "error", `Имя в письме «${content.patient.name}» не совпадает с именем пациента в CRM «${leadName}»`, "patient.name");
  }
  for (const p of printed) {
    const found = findContacts(p.text);
    if (found.length > 0) push("contact-leak", "error", `В тексте осталась ссылка, почта или телефон: «${found[0]}»`, p.path);
  }
  for (const p of printed) {
    const bad = FOREIGN_GLYPH.exec(p.text);
    if (bad) push("foreign-glyph", "error", `Символ «${bad[0]}» не поддерживается шрифтом PDF`, p.path);
  }
  if (options.clinicsVerifiedOnSites && options.clinicsVerifiedMonth === "") {
    push("verified-month-missing", "error", "Укажите месяц проверки по сайтам клиник", "options.clinicsVerifiedMonth");
  }

  // Предупреждения
  for (const p of printed) {
    const hay = normalize(p.text);
    const name = senderNames.find((n) => hay.includes(normalize(n)));
    if (name !== undefined) push("sender-name", "warn", `В тексте упомянуто название агентства: «${name}»`, p.path);
  }
  for (const { clinic, path } of clinics) {
    for (const field of ["doctor", "name"] as const) {
      const missing = (clinic[field].match(/[A-Za-z]{4,}/g) ?? []).find((w) => !normalizedSource.includes(w.toLowerCase()));
      if (missing !== undefined) push("doctor-not-in-letter", "warn", `«${missing}» нет в письме — проверьте по сайту клиники`, `${path}.${field}`);
    }
  }
  if (content.clinics.length > 0 && !options.clinicsVerifiedOnSites) {
    push("clinics-unverified", "warn", "Врачи и клиники не проверены по сайтам клиник", "options.clinicsVerifiedOnSites");
  }
  for (const issue of content.letterIssues) push("letter-issue", "warn", issue);
  const flights = content.fixed.flights;
  if (flights.enabled && (flights.checkedOn === "" || daysBetween(flights.checkedOn, todayInZone(now)) > 30)) {
    push("flights-stale", "warn", "Дата проверки рейсов пуста или старше 30 дней", "fixed.flights.checkedOn");
  }
  if (content.patient.name !== "" && content.patient.name !== leadName) {
    push("patient-name-translit", "warn", "Имя написано моделью — проверьте написание", "patient.name");
  }

  // Подсказки
  if (content.clinics.length === 0) push("empty-section", "info", "В плане нет раздела: клиники", "clinics");
  if (content.costs.groups.every((g) => g.rows.length === 0)) push("empty-section", "info", "В плане нет раздела: цены", "costs");
  if (content.stay.rows.length === 0) push("empty-section", "info", "В плане нет раздела: пребывание", "stay");
  const cells: { text: string; path: string }[] = [
    { text: content.diagnosis.text, path: "diagnosis.text" },
    { text: content.diagnosis.state, path: "diagnosis.state" },
    { text: content.diagnosis.tactic, path: "diagnosis.tactic" },
    { text: content.diagnosis.status, path: "diagnosis.status" },
    ...clinics.flatMap(({ clinic, path }) =>
      (["name", "shortName", "city", "area", "doctor", "why"] as const).map((field) => ({ text: clinic[field], path: `${path}.${field}` })),
    ),
    ...rows.map(({ row, path }) => ({ text: row.label, path: `${path}.label` })),
    ...content.stay.rows.flatMap((row, i) => [
      { text: row.label, path: `stay.rows[${i}].label` },
      { text: row.value, path: `stay.rows[${i}].value` },
    ]),
  ];
  for (const cell of cells) {
    if (cell.text.length > PLAN_LIMITS.cellSoft) push("long-cell", "info", "Слишком длинный текст в ячейке", cell.path);
  }

  return warnings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

// Есть ли ошибки, из-за которых план нельзя отметить «Проверено».
export function hasBlockingWarnings(warnings: PlanWarning[]): boolean {
  return warnings.some((w) => w.level === "error");
}

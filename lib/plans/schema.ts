import { z } from "zod";

// Данные раздела «Планы»: схемы zod, выведенные из них типы, документы коллекции TreatmentPlans,
// лимиты длин и схема ответа Gemini. Все типы содержимого плана выводятся из схем через z.infer,
// поэтому схема и тип разойтись не могут. Файл — только данные (без сети и БД); покрыт lib/plans/schema.test.ts.

// ---------------------------------------------------------------------------
// 1) Лимиты
// ---------------------------------------------------------------------------

// Лимиты, нужные не только схеме: разбор письма и .docx, тело запроса, «мягкий» предел ячейки.
export const PLAN_LIMITS = {
  sourceChars: 40000, // письмо как вставлено (для .docx — длина извлечённого текста)
  docxBytes: 5242880, // 5 МБ — сам .docx
  docxUnpackedBytes: 20971520, // 20 МБ суммарно после распаковки (защита от «zip-бомбы»)
  requestBytes: 6291456, // 6 МБ — тело запроса
  overviewItem: 400, // пункт обзора
  cell: 300, // ячейка таблицы и короткий пункт списка
  cellSoft: 240, // «мягкий» предел ячейки: длиннее — предупреждение, схема его не проверяет
  paragraph: 1200, // абзац
  evidence: 400, // цитата из письма в строке цены
  patientName: 120,
} as const;

// Остальные пределы из таблицы спецификации (§5): строки — в символах, списки — в элементах.
export const MAX = {
  profile: 200,
  overviewItems: 12,
  indiaSteps: 20,
  indiaStep: 400,
  tacticItems: 12,
  itemTitle: 120,
  itemText: 600,
  heading: 120, // documents.title, approach.title
  documentItems: 20,
  approachParagraphs: 8,
  note: 600, // примечания, сноски, notIncluded и тексты блоков fixed
  clinics: 30,
  clinicId: 20,
  clinicName: 200,
  clinicShortName: 60,
  city: 60,
  area: 100,
  groups: 12,
  groupTitle: 200,
  rows: 40,
  amount: 60,
  stayRows: 20,
  included: 30,
  letterIssues: 20,
  letterIssue: 400,
  place: 60, // flights.from / flights.to
  support: 10,
  nextSteps: 8,
  nextStep: 40,
} as const;

// ---------------------------------------------------------------------------
// 2) Содержимое плана: строгая схема (то, что хранится и что правит координатор)
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().max(max);
const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).max(max);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_OR_EMPTY = /^(\d{4}-\d{2}-\d{2})?$/;
const ISO_MONTH_OR_EMPTY = /^(\d{4}-(0[1-9]|1[0-2]))?$/;

const genderSchema = z.enum(["male", "female", "unknown"]);

// Пункт «название — текст» (тактика лечения, предлагаемый подход).
const titledItemSchema = z.object({ title: text(MAX.itemTitle), text: text(MAX.itemText) });

const clinicSchema = z.object({
  id: text(MAX.clinicId),
  name: text(MAX.clinicName),
  shortName: text(MAX.clinicShortName),
  city: text(MAX.city),
  area: text(MAX.area),
  doctor: text(PLAN_LIMITS.cell),
  why: text(PLAN_LIMITS.cell),
});

const costRowSchema = z.object({
  label: text(PLAN_LIMITS.cell),
  clinicId: text(MAX.clinicId),
  amount: text(MAX.amount),
  evidence: text(PLAN_LIMITS.evidence),
});

const costGroupSchema = z.object({
  title: text(MAX.groupTitle),
  note: text(MAX.note),
  rows: list(costRowSchema, MAX.rows),
});

const stayRowSchema = z.object({
  label: text(PLAN_LIMITS.cell),
  value: text(PLAN_LIMITS.cell),
  total: z.boolean(),
});

// Снимок блоков формуляра из defaults.ts на момент создания плана.
const fixedSchema = z.object({
  tacticDisclaimer: text(MAX.note),
  costFootnote: text(MAX.note),
  flights: z.object({
    enabled: z.boolean(),
    from: text(MAX.place),
    to: text(MAX.place),
    text: text(MAX.note),
    checkedOn: z.string().regex(ISO_DATE_OR_EMPTY), // "" или YYYY-MM-DD
  }),
  support: list(text(PLAN_LIMITS.cell), MAX.support),
  nextSteps: list(text(MAX.nextStep), MAX.nextSteps),
});

export const planContentSchema = z.object({
  language: z.literal("ru"), // место под "tg" в будущем
  patient: z.object({ name: text(PLAN_LIMITS.patientName), gender: genderSchema }),
  profile: z.object({ specialty: text(MAX.profile), condition: text(MAX.profile) }),
  overview: list(text(PLAN_LIMITS.overviewItem), MAX.overviewItems),
  diagnosis: z.object({
    text: text(PLAN_LIMITS.cell),
    state: text(PLAN_LIMITS.cell),
    tactic: text(PLAN_LIMITS.cell),
    status: text(PLAN_LIMITS.cell),
  }),
  indiaSteps: list(text(MAX.indiaStep), MAX.indiaSteps),
  tactic: z.object({ intro: text(PLAN_LIMITS.paragraph), items: list(titledItemSchema, MAX.tacticItems) }),
  documents: z.object({ title: text(MAX.heading), items: list(text(PLAN_LIMITS.cell), MAX.documentItems) }),
  approach: z.object({
    title: text(MAX.heading),
    paragraphs: list(text(PLAN_LIMITS.paragraph), MAX.approachParagraphs),
    items: list(titledItemSchema, MAX.tacticItems),
    note: text(MAX.note),
  }),
  clinics: list(clinicSchema, MAX.clinics),
  costs: z.object({ groups: list(costGroupSchema, MAX.groups), footnote: text(MAX.note) }),
  stay: z.object({ rows: list(stayRowSchema, MAX.stayRows), note: text(MAX.note) }),
  included: list(text(PLAN_LIMITS.cell), MAX.included),
  notIncluded: text(MAX.note),
  letterIssues: list(text(MAX.letterIssue), MAX.letterIssues), // что модель заметила в письме; не печатается
  fixed: fixedSchema,
});

// ---------------------------------------------------------------------------
// 3) Черновик модели: мягкая схема
// ---------------------------------------------------------------------------

// Те же поля и те же длины, но пропущенное поле на любой глубине получает значение по умолчанию
// ("" / [] / false / "unknown"). Неверное значение (не пропуск) по-прежнему ошибка.
// language и fixed в черновике нет: их ставит код, лишние ключи из ответа модели отбрасываются.
const draftText = (max: number) => text(max).default("");
const draftList = <T extends z.ZodTypeAny>(item: T, max: number) => list(item, max).default([]);

const titledItemDraft = z.object({ title: draftText(MAX.itemTitle), text: draftText(MAX.itemText) });

const clinicDraft = z.object({
  id: draftText(MAX.clinicId),
  name: draftText(MAX.clinicName),
  shortName: draftText(MAX.clinicShortName),
  city: draftText(MAX.city),
  area: draftText(MAX.area),
  doctor: draftText(PLAN_LIMITS.cell),
  why: draftText(PLAN_LIMITS.cell),
});

const costRowDraft = z.object({
  label: draftText(PLAN_LIMITS.cell),
  clinicId: draftText(MAX.clinicId),
  amount: draftText(MAX.amount),
  evidence: draftText(PLAN_LIMITS.evidence),
});

const costGroupDraft = z.object({
  title: draftText(MAX.groupTitle),
  note: draftText(MAX.note),
  rows: draftList(costRowDraft, MAX.rows),
});

const stayRowDraft = z.object({
  label: draftText(PLAN_LIMITS.cell),
  value: draftText(PLAN_LIMITS.cell),
  total: z.boolean().default(false),
});

export const planDraftSchema = z.object({
  patient: z.object({ name: draftText(PLAN_LIMITS.patientName), gender: genderSchema.default("unknown") }).default({}),
  profile: z.object({ specialty: draftText(MAX.profile), condition: draftText(MAX.profile) }).default({}),
  overview: draftList(text(PLAN_LIMITS.overviewItem), MAX.overviewItems),
  diagnosis: z
    .object({
      text: draftText(PLAN_LIMITS.cell),
      state: draftText(PLAN_LIMITS.cell),
      tactic: draftText(PLAN_LIMITS.cell),
      status: draftText(PLAN_LIMITS.cell),
    })
    .default({}),
  indiaSteps: draftList(text(MAX.indiaStep), MAX.indiaSteps),
  tactic: z
    .object({ intro: draftText(PLAN_LIMITS.paragraph), items: draftList(titledItemDraft, MAX.tacticItems) })
    .default({}),
  documents: z
    .object({ title: draftText(MAX.heading), items: draftList(text(PLAN_LIMITS.cell), MAX.documentItems) })
    .default({}),
  approach: z
    .object({
      title: draftText(MAX.heading),
      paragraphs: draftList(text(PLAN_LIMITS.paragraph), MAX.approachParagraphs),
      items: draftList(titledItemDraft, MAX.tacticItems),
      note: draftText(MAX.note),
    })
    .default({}),
  clinics: draftList(clinicDraft, MAX.clinics),
  costs: z.object({ groups: draftList(costGroupDraft, MAX.groups), footnote: draftText(MAX.note) }).default({}),
  stay: z.object({ rows: draftList(stayRowDraft, MAX.stayRows), note: draftText(MAX.note) }).default({}),
  included: draftList(text(PLAN_LIMITS.cell), MAX.included),
  notIncluded: draftText(MAX.note),
  letterIssues: draftList(text(MAX.letterIssue), MAX.letterIssues),
});

// ---------------------------------------------------------------------------
// 4) Параметры плана
// ---------------------------------------------------------------------------

export const planOptionsSchema = z.object({
  date: z.string().regex(ISO_DATE), // ISO-дата плана, по умолчанию сегодня (Asia/Dushanbe)
  diagnosisHeading: z.enum(["confirmed", "by-documents"]), // «ПОДТВЕРЖДЁННЫЙ ДИАГНОЗ» / «ДИАГНОЗ ПО ПРЕДОСТАВЛЕННЫМ ДОКУМЕНТАМ»
  clinicsVerifiedOnSites: z.boolean(), // фраза «проверено по официальным сайтам клиник…»
  clinicsVerifiedMonth: z.string().regex(ISO_MONTH_OR_EMPTY), // "2026-09"; обязателен, если галочка стоит
  showPageNumbers: z.boolean(),
});

// ---------------------------------------------------------------------------
// 5) Типы
// ---------------------------------------------------------------------------

export type PlanGender = z.infer<typeof genderSchema>;
export type PlanClinic = z.infer<typeof clinicSchema>;
export type PlanCostRow = z.infer<typeof costRowSchema>;
export type PlanCostGroup = z.infer<typeof costGroupSchema>;
export type PlanStayRow = z.infer<typeof stayRowSchema>;
export type PlanFixed = z.infer<typeof fixedSchema>;
export type PlanContent = z.infer<typeof planContentSchema>;
export type PlanOptions = z.infer<typeof planOptionsSchema>;
// То, что заполняет модель: всё содержимое, кроме language и fixed.
export type PlanDraft = Omit<PlanContent, "language" | "fixed">;

// Проверка при компиляции: выход мягкой схемы — ровно PlanDraft (на это опирается contentFromDraft).
// Если схема и тип разойдутся, tsc перестанет проходить.
type DraftOutput = z.output<typeof planDraftSchema>;
type AssertTrue<T extends true> = T;
type DraftMatchesSchema = AssertTrue<[DraftOutput, PlanDraft] extends [PlanDraft, DraftOutput] ? true : false>;

export type PlanStatus = "empty" | "draft" | "reviewed"; // empty — письмо сохранено, плана ещё нет

export interface PlanWarning {
  code: string; // из таблицы проверок (§7)
  level: "error" | "warn" | "info"; // красный / жёлтый / серый
  message: string; // по-русски, для координатора
  path?: string; // поле, к которому привязано: "costs.groups[0].rows[2].amount"
}

export interface PlanGeneration {
  state: "idle" | "running" | "done" | "failed";
  startedAt?: string;
  model?: string;
  promptVersion?: string;
  ms?: number;
  attempts?: number;
  error?: string;
}

export interface PlanReview {
  by: string;
  at: string;
  changedFields: number;
  confirmations: string[];
}

// План в виде, в котором его отдаёт API (id и leadId — строки; даты — ISO-строки, как в остальных коллекциях).
export interface TreatmentPlan {
  id: string;
  leadId: string | null;
  version: number; // растёт при каждом сохранении; защита от затирания правок
  status: PlanStatus;
  source: { text: string; kind: "paste" | "docx"; filename?: string; sha256: string };
  content?: PlanContent; // то, что правит координатор
  aiDraft?: PlanContent; // как вернула модель — для метрики «сколько правили»
  options: PlanOptions;
  warnings: PlanWarning[]; // пересчитываются при каждом сохранении
  generation: PlanGeneration;
  review?: PlanReview;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Строка списка планов.
export interface PlanListItem {
  id: string;
  patientName: string;
  status: PlanStatus;
  leadId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  errorCount: number;
  generationState: PlanGeneration["state"];
}

// ---------------------------------------------------------------------------
// 6) Схема ответа Gemini для PlanDraft
// ---------------------------------------------------------------------------

// Подмножество схемы Gemini, которое мы используем. Типы — ТОЛЬКО в верхнем регистре, как у
// REPLY_RESPONSE_SCHEMA в lib/gemini.ts: со строчными Gemini отвечает 400. Без nullable, minItems и pattern:
// необязательные разделы выражаются пустой строкой или пустым массивом, а пределы длин (их проверяет
// planDraftSchema) названы в описаниях, чтобы схема не оказалась «слишком сложной» для API.
interface GeminiSchema {
  type: "OBJECT" | "ARRAY" | "STRING" | "BOOLEAN";
  description?: string;
  format?: "enum";
  enum?: string[];
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
  propertyOrdering?: string[];
}

const gStr = (description: string): GeminiSchema => ({ type: "STRING", description });
const gBool = (description: string): GeminiSchema => ({ type: "BOOLEAN", description });
const gArr = (items: GeminiSchema, description: string): GeminiSchema => ({ type: "ARRAY", description, items });
// Объект: все ключи обязательны и идут в заданном порядке (Gemini сохраняет порядок из propertyOrdering).
const gObj = (properties: Record<string, GeminiSchema>, description?: string): GeminiSchema => {
  const keys = Object.keys(properties);
  return {
    type: "OBJECT",
    ...(description ? { description } : {}),
    properties,
    required: keys,
    propertyOrdering: keys,
  };
};

const gTitledItems = (description: string): GeminiSchema =>
  gArr(
    gObj(
      {
        title: gStr(`Short name of the point, in Russian. At most ${MAX.itemTitle} characters.`),
        text: gStr(`What the point says, in Russian, using only facts from the letter. At most ${MAX.itemText} characters.`),
      },
      "One named point of the section.",
    ),
    description,
  );

export const PLAN_RESPONSE_SCHEMA = gObj({
  patient: gObj(
    {
      name: gStr(
        `The patient's full name. Write it in Cyrillic following the usual transliteration rules for Tajik and Uzbek names; if unsure, keep the Latin spelling exactly as in the letter. Empty string if the letter does not name the patient. At most ${PLAN_LIMITS.patientName} characters.`,
      ),
      gender: {
        type: "STRING",
        format: "enum",
        enum: [...genderSchema.options],
        description:
          "The patient's gender, judged from Mr./Ms./Mrs. and he/she in the letter: male, female, or unknown when the letter does not show it.",
      },
    },
    "The patient the letter is about.",
  ),
  profile: gObj(
    {
      specialty: gStr(
        `Medical specialty of the case as a short Russian noun phrase, for example «Урология». Empty string if the letter does not make it clear. At most ${MAX.profile} characters.`,
      ),
      condition: gStr(
        `The patient's condition in a few Russian words, as the letter names it, for example «камни в почках». Empty string if the letter does not name it. At most ${MAX.profile} characters.`,
      ),
    },
    "The profile of the case, in Russian.",
  ),
  overview: gArr(
    gStr(`One fact about the case, in Russian. At most ${PLAN_LIMITS.overviewItem} characters.`),
    `Medical overview in Russian: short points that summarise the patient's case and the conclusions of the hospital team, using only facts from the letter. One fact per point; no advertising, greetings or signature. Usually 1-6 points, at most ${MAX.overviewItems}. Empty array if the letter gives no such facts.`,
  ),
  diagnosis: gObj(
    {
      text: gStr("The diagnosis itself, as the letter names it."),
      state: gStr("The patient's current state as the letter describes it, for example whether an infection is active."),
      tactic: gStr("The potential treatment tactic that the letter links to this diagnosis."),
      status: gStr(
        "The current status of the diagnosis or of the case as the letter puts it, for example preliminary, confirmed, or awaiting repeat tests.",
      ),
    },
    `The diagnosis table, all in Russian. Each field at most ${PLAN_LIMITS.cell} characters; empty string for anything the letter does not state.`,
  ),
  indiaSteps: gArr(
    gStr(`One step, a short Russian sentence. At most ${MAX.indiaStep} characters.`),
    `What has to be done in India, in the order of the letter, for example repeat tests on arrival, consultations, the procedure. At most ${MAX.indiaSteps} steps. Empty array if the letter names none.`,
  ),
  tactic: gObj(
    {
      intro: gStr(
        `A short introduction to the possible tactic. At most ${PLAN_LIMITS.paragraph} characters. Empty string if the letter has none.`,
      ),
      items: gTitledItems(`Points of the tactic taken from the letter, at most ${MAX.tacticItems}. Empty array if the letter has none.`),
    },
    "Possible treatment tactic, in Russian. Keep the letter's cautious wording (for example «возможно», «по предварительной оценке») and never promise or guarantee a result.",
  ),
  documents: gObj(
    {
      title: gStr(
        `Heading of the section in Russian capitals, normally «НЕОБХОДИМЫЕ ДОКУМЕНТЫ»; empty string when there is no such section. At most ${MAX.heading} characters.`,
      ),
      items: gArr(
        gStr(`One document or examination, in Russian. At most ${PLAN_LIMITS.cell} characters.`),
        `Documents or examinations the letter asks for, one per entry; at most ${MAX.documentItems} entries. Empty array when there are none.`,
      ),
    },
    "OPTIONAL section «НЕОБХОДИМЫЕ ДОКУМЕНТЫ»: documents the hospital asks the patient to provide. Leave the title and the list empty when the letter asks for none.",
  ),
  approach: gObj(
    {
      title: gStr(
        `Heading of the section in Russian capitals, normally «ПРЕДЛАГАЕМЫЙ ПОДХОД»; empty string when there is no such section. At most ${MAX.heading} characters.`,
      ),
      paragraphs: gArr(
        gStr(`One paragraph, in Russian. At most ${PLAN_LIMITS.paragraph} characters.`),
        `Paragraphs of the proposed approach; at most ${MAX.approachParagraphs}. Empty array when there are none.`,
      ),
      items: gTitledItems(`Named points of the approach taken from the letter, at most ${MAX.tacticItems}. Empty array when there are none.`),
      note: gStr(`A closing note to the section, in Russian. At most ${MAX.note} characters; empty string when there is none.`),
    },
    "OPTIONAL section «ПРЕДЛАГАЕМЫЙ ПОДХОД»: the approach the letter describes at length. Leave everything in it empty when the letter has no such description.",
  ),
  clinics: gArr(
    gObj(
      {
        id: gStr(
          `Short unique id of the hospital inside this answer: c1, c2, c3 and so on in the order of the letter. Price rows point to it through clinicId. At most ${MAX.clinicId} characters.`,
        ),
        name: gStr(`Full hospital name in Latin exactly as in the letter. At most ${MAX.clinicName} characters.`),
        shortName: gStr(
          `Short hospital name in Latin for labels in tables: the short form the letter itself uses, or the full name without generic words such as Hospital or Institute. At most ${MAX.clinicShortName} characters.`,
        ),
        city: gStr(
          `City in Russian, for example «Бангалор»; empty string if the letter does not give it. At most ${MAX.city} characters.`,
        ),
        area: gStr(
          `District or metropolitan area in Russian, for example «Дели NCR»; empty string if the letter does not give it. At most ${MAX.area} characters.`,
        ),
        doctor: gStr(
          `The doctor the letter names, written «Dr. Name — position»: the name in Latin as in the letter, the position in Russian. Empty string if no doctor is named. At most ${PLAN_LIMITS.cell} characters.`,
        ),
        why: gStr(
          `One short Russian sentence from the letter on why this hospital or doctor fits the case; no advertising or boasting. Empty string if the letter says nothing. At most ${PLAN_LIMITS.cell} characters.`,
        ),
      },
      "One hospital with its doctor.",
    ),
    `The hospitals and doctors the letter names, in the order of the letter, at most ${MAX.clinics}. Only those the letter names: never add a hospital or a doctor from your own knowledge. Empty array if the letter names none.`,
  ),
  costs: gObj(
    {
      groups: gArr(
        gObj(
          {
            title: gStr(`Heading of the group, in Russian. At most ${MAX.groupTitle} characters.`),
            note: gStr(
              `A short note in Russian on how to read the group, for example that the variants are alternatives and are not added up; empty string if not needed. At most ${MAX.note} characters.`,
            ),
            rows: gArr(
              gObj(
                {
                  label: gStr(`What the price is for, in Russian, as the letter says it. At most ${PLAN_LIMITS.cell} characters.`),
                  clinicId: gStr(
                    `The id from clinics of the hospital this price belongs to; empty string when the price is not tied to one hospital. At most ${MAX.clinicId} characters.`,
                  ),
                  amount: gStr(
                    `The amount as the letter writes it, for example «6800», «500-800» or «80-90 за визит», or «по запросу» when the letter says the price is on request. A per-unit suffix must be in Russian («в день», «за визит», «за ночь», «за сеанс», «в неделю»). Never recalculate, add up or convert. The currency is USD, so no currency name is needed. At most ${MAX.amount} characters.`,
                  ),
                  evidence: gStr(
                    `A verbatim quotation from the letter, copied character for character from one line, that contains this price. At most ${PLAN_LIMITS.evidence} characters.`,
                  ),
                },
                "One price row of the group.",
              ),
              `Price rows of the group, at most ${MAX.rows}. When the letter gives alternatives by hospital, write one row per hospital.`,
            ),
          },
          "One group of price rows.",
        ),
        `Price tables, one group per kind of cost, for example the treatment variants by hospital, or additional expenses. At most ${MAX.groups} groups. Empty array if the letter gives no prices.`,
      ),
      footnote: gStr(
        `A note the letter makes about the prices, in Russian. At most ${MAX.note} characters; empty string if there is none.`,
      ),
    },
    "Estimated cost of treatment in USD, copied from the letter. Nothing is recalculated, converted or added up.",
  ),
  stay: gObj(
    {
      rows: gArr(
        gObj(
          {
            label: gStr(`What the duration is for, in Russian. At most ${PLAN_LIMITS.cell} characters.`),
            value: gStr(
              `The duration as the letter writes it, in Russian, for example «2–3 дня» or «≈ 2 недели». At most ${PLAN_LIMITS.cell} characters.`,
            ),
            total: gBool("true only for the row that gives the total stay in India; false for every other row."),
          },
          "One row of the stay table.",
        ),
        `Duration rows in the order of the letter, for example hospitalization, stay before the procedure, stay after discharge, total stay; at most ${MAX.stayRows}. Empty array if the letter gives no durations.`,
      ),
      note: gStr(`A note about the stay, in Russian. At most ${MAX.note} characters; empty string if the letter has none.`),
    },
    "Duration of the stay in India, from the letter.",
  ),
  included: gArr(
    gStr(`One thing the price includes, in Russian. At most ${PLAN_LIMITS.cell} characters.`),
    `What the letter says the treatment price includes, one item per entry; at most ${MAX.included} entries. Empty array if the letter does not say.`,
  ),
  notIncluded: gStr(
    `What the letter says is NOT included in the price: one Russian phrase in lower case with the items separated by semicolons, without the words «Не включено». At most ${MAX.note} characters. Empty string if the letter does not say.`,
  ),
  letterIssues: gArr(
    gStr(`One problem, a single Russian sentence. At most ${MAX.letterIssue} characters.`),
    `Problems you noticed in the letter, one per entry: a description or link that evidently belongs to another hospital, hospital names that differ between the list and the price table, numbers or durations that contradict each other. Report them here and never fix them silently. At most ${MAX.letterIssues} entries. Empty array if there are none.`,
  ),
});

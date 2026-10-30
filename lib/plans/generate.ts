// Вызов модели для раздела «Планы»: письмо -> JSON по схеме -> zod -> sanitize. Один повтор с перечнем нарушений.
// Сетевые и HTTP-ошибки модели не оборачиваются: их перебор и повторы уже есть в generateWithFallback.
// В журнал пишутся длины, модель, время и пути нарушений; текст письма и ответа модели — никогда.
import { generateWithFallback } from "@/lib/gemini";
import { createLogger } from "@/lib/logger";
import { formatAmount } from "./format";
import { PLAN_FEWSHOT, PLAN_PROMPT_VERSION, PLAN_SYSTEM_PROMPT, buildPlanUserMessage } from "./prompt";
import { PLAN_RESPONSE_SCHEMA, planDraftSchema } from "./schema";
import type { PlanDraft } from "./schema";
import { stripContacts } from "./source";

const log = createLogger("plan-generate");

const MAX_ATTEMPTS = 2; // первый вызов и один повтор
const MAX_REPAIR_LINES = 20; // нарушений в служебной пометке
const MAX_REPAIR_LINE_CHARS = 200; // длина одной строки пометки
const WHOLE_ANSWER = "(весь ответ)"; // путь для нарушения без пути

// attempts — сколько раз вызвана модель (раннер пишет это число в generation.attempts).
export class PlanGenerationError extends Error {
  constructor(message: string, readonly attempts: number = 0) {
    super(message);
    this.name = "PlanGenerationError";
  }
}

// Строка черновика: без ссылок, почты и телефонов, без пробелов по краям.
const cleanText = (text: string) => stripContacts(text).trim();

// Копия значения, в которой очищены все строки на любой глубине (ключи и порядок сохраняются).
function cleanStrings<T>(value: T): T {
  if (typeof value === "string") return cleanText(value) as T;
  if (Array.isArray(value)) return value.map((item) => cleanStrings(item)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanStrings(item)])) as T;
  }
  return value;
}

// Пометка для группы цен-альтернатив: без неё читатель плана легко складывает цены клиник.
export const ALTERNATIVES_NOTE = "Варианты по госпиталям — выбирается один; стоимости не суммируются.";
const ALTERNATIVES_NOTE_TAIL = "Выбирается один вариант; стоимости не суммируются.";
const GENERIC_ALTERNATIVES_NOTE = /^варианты по (?:клиникам|госпиталям|больницам)\.?$/i;
const MAX_NOTE_CHARS = 280;

// Нижняя граница суммы для сортировки: «6 000 – 6 500» → 6000, «80-90 за визит» → 80, «по запросу» → null.
function lowerBound(amount: string): number | null {
  const match = amount.match(/\d[\d\s\u00a0\u202f]*(?:[.,]\d+)?/);
  if (!match) return null;
  const n = Number(match[0].replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Черновик модели, приведённый к печатному виду. Вход не меняется.
export function sanitizeDraft(draft: PlanDraft): PlanDraft {
  const out = cleanStrings(draft);
  for (const group of out.costs.groups) {
    for (const row of group.rows) row.amount = formatAmount(row.amount);

    // Варианты по разным клиникам: от самой дешёвой (строки без числа — в конец) и с пометкой, что выбирается один.
    // Порядок задаётся один раз при генерации; после этого координатор волен менять его в редакторе.
    const clinicIds = new Set(group.rows.map((row) => row.clinicId).filter((id) => id !== ""));
    if (clinicIds.size >= 2) {
      group.rows.sort((a, b) => {
        const x = lowerBound(a.amount);
        const y = lowerBound(b.amount);
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        return x - y;
      });
      const note = group.note.trim();
      if (note === "" || GENERIC_ALTERNATIVES_NOTE.test(note)) {
        group.note = ALTERNATIVES_NOTE;
      } else if (!/не\s+суммир/i.test(note)) {
        const extended = `${note.replace(/[.\s]+$/, "")}. ${ALTERNATIVES_NOTE_TAIL}`;
        if (extended.length <= MAX_NOTE_CHARS) group.note = extended;
      }
    }
  }
  // Пустой или повторяющийся id получает первый свободный c{n}; id у первой клиники с таким значением остаётся.
  // Ссылки clinicId в строках цен не трогаем: висящую поймает проверка price-unknown-clinic.
  const taken = new Set<string>();
  const needNewId: number[] = [];
  out.clinics.forEach((clinic, i) => {
    if (clinic.id === "" || taken.has(clinic.id)) needNewId.push(i);
    else taken.add(clinic.id);
  });
  let n = 1;
  for (const i of needNewId) {
    while (taken.has(`c${n}`)) n++;
    out.clinics[i].id = `c${n}`;
    taken.add(`c${n}`);
  }
  return out;
}

// JSON из ответа модели: терпит блок ```json и текст до и после (берёт от первой { до последней }).
export function parseDraftJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new SyntaxError("В ответе нет JSON-объекта");
  return JSON.parse(raw.slice(start, end + 1));
}

type ParsedAnswer =
  | { ok: true; draft: PlanDraft }
  | { ok: false; lines: string[]; paths: string[] }; // lines — для модели, paths — для журнала

function parseAnswer(raw: string): ParsedAnswer {
  let json: unknown;
  try {
    json = parseDraftJson(raw);
  } catch {
    return {
      ok: false,
      lines: [`${WHOLE_ANSWER}: ответ не разобрался как JSON — верни один JSON-объект по схеме, без текста вокруг`],
      paths: [WHOLE_ANSWER],
    };
  }
  const parsed = planDraftSchema.safeParse(json);
  if (parsed.success) return { ok: true, draft: sanitizeDraft(parsed.data) };
  const issues = parsed.error.issues.slice(0, MAX_REPAIR_LINES).map((issue) => ({
    path: issue.path.join(".") || WHOLE_ANSWER,
    message: issue.message,
  }));
  return {
    ok: false,
    lines: issues.map((i) => `${i.path}: ${i.message}`.slice(0, MAX_REPAIR_LINE_CHARS)),
    paths: issues.map((i) => i.path),
  };
}

const turn = (role: "user" | "model", text: string) => ({ role, parts: [{ text }] });

// Пример (письмо и желаемый ответ) идёт парой ходов перед настоящим письмом.
function buildContents(sourceText: string, repairErrors?: string[]) {
  return [
    turn("user", buildPlanUserMessage(PLAN_FEWSHOT.letter)),
    turn("model", JSON.stringify(PLAN_FEWSHOT.output)),
    turn("user", buildPlanUserMessage(sourceText, repairErrors ? { repairErrors } : undefined)),
  ];
}

// sourceText — письмо после prepareSource. Ошибка разбора или схемы -> один повтор с перечнем нарушений;
// вторая ошибка -> PlanGenerationError (attempts = 2). Ошибки самой модели (HTTP, сеть) проходят как есть.
export async function generatePlanDraft(params: { sourceText: string; requestId?: string }): Promise<{
  draft: PlanDraft;
  model: string;
  promptVersion: string;
  attempts: number;
  ms: number;
}> {
  const logger = params.requestId ? log.child(params.requestId) : log;
  const startedAt = Date.now();
  let repairErrors: string[] | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { text, model } = await generateWithFallback(
      buildContents(params.sourceText, repairErrors),
      PLAN_SYSTEM_PROMPT,
      logger,
      {
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: PLAN_RESPONSE_SCHEMA,
          maxOutputTokens: 16000,
        },
        keepGenerationConfig: true,
      },
    );
    const parsed = parseAnswer(text);
    if (parsed.ok) {
      const ms = Date.now() - startedAt;
      logger.info("Планы: черновик получен", { model, attempts: attempt, ms, replyLength: text.length });
      return { draft: parsed.draft, model, promptVersion: PLAN_PROMPT_VERSION, attempts: attempt, ms };
    }
    // Только длина ответа и пути нарушений: ни текста письма, ни текста ответа.
    logger.warn("Планы: ответ модели не разобран", { attempt, model, replyLength: text.length, paths: parsed.paths });
    repairErrors = parsed.lines;
  }
  throw new PlanGenerationError("Модель вернула ответ, который не удалось разобрать", MAX_ATTEMPTS);
}

// Фоновая генерация плана. Запуск не ждёт ответа модели: HTTP-запрос отвечает сразу, а результат или ошибка
// пишутся в базу с условием «запуск всё ещё текущий» (см. completeGeneration и failGeneration в ./db).
// В журнал пишутся id плана, длины, число попыток, время и код ошибки; текст письма и ответ модели — никогда.
import { compareNames } from "@/lib/documents";
import { getLead } from "@/lib/db";
import { createLogger, newRequestId } from "@/lib/logger";
import { claimGeneration, completeGeneration, failGeneration } from "./db";
import { contentFromDraft } from "./defaults";
import { evaluatePlan } from "./evaluate";
import { PlanGenerationError, generatePlanDraft } from "./generate";
import { PlanInputError, prepareSource } from "./source";

const log = createLogger("plan-runner");

export const GENERATION_TIMEOUT_MS = 240000; // 4 минуты: вызов модели с повторами укладывается, зависание — нет
const GENERIC_ERROR = "Не удалось получить ответ модели. Повторите попытку.";

// Ожидание с тайм-аутом. Опоздавший ответ модели здесь уже никому не нужен: race его поглощает.
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PlanGenerationError("Модель не ответила за 4 минуты")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runPlanGeneration(planId: string): Promise<void> {
  const requestId = newRequestId();
  const logger = log.child(requestId);
  const claimed = await claimGeneration(planId);
  if (!claimed) return; // другой запуск уже идёт

  // claimGeneration всегда ставит startedAt; пустая строка не совпадёт ни с одной записью, и результат будет отброшен.
  const startedAt = claimed.generation.startedAt ?? "";
  const started = Date.now();
  try {
    const sourceText = prepareSource(claimed.source.text);
    const lead = claimed.leadId ? await getLead(claimed.leadId) : undefined;
    const result = await withTimeout(generatePlanDraft({ sourceText, requestId }), GENERATION_TIMEOUT_MS);

    // Имя пациента берём из CRM, если оно совпадает с письмом. Если нет — остаётся имя из письма, и проверка даст name-mismatch.
    const draft = { ...result.draft };
    if (lead && compareNames(draft.patient.name, lead.name) !== "mismatch") {
      draft.patient = { ...draft.patient, name: lead.name };
    }
    const content = contentFromDraft(draft, claimed.content?.fixed);
    const warnings = await evaluatePlan({
      sourceText: claimed.source.text,
      leadId: claimed.leadId,
      content,
      options: claimed.options,
      leadName: lead ? lead.name : "",
    });

    const saved = await completeGeneration(planId, startedAt, {
      content,
      promptVersion: result.promptVersion,
      attempts: result.attempts,
      ms: result.ms,
      model: result.model,
      warnings,
    });
    if (!saved) logger.info("результат отброшен: генерация уже не актуальна", { planId });
  } catch (err) {
    const message = err instanceof PlanInputError || err instanceof PlanGenerationError ? err.message : GENERIC_ERROR;
    // Сколько раз вызвана модель, известно только у PlanGenerationError; при сбое сети или тайм-ауте вызова — 0.
    const attempts = err instanceof PlanGenerationError ? err.attempts : 0;
    logger.error("генерация не удалась", {
      planId,
      attempts,
      ms: Date.now() - started,
      error: err instanceof PlanInputError ? err.code : err instanceof Error ? err.name : "unknown",
    });
    await failGeneration(planId, startedAt, message, attempts);
  }
}

// Запуск в фоне: ответ HTTP-запроса не ждёт модели, а сбой никогда не уходит в необработанный отказ.
export function kickPlanGeneration(planId: string): void {
  runPlanGeneration(planId).catch((err: unknown) => {
    log.error("фоновый запуск генерации упал", { planId, error: err instanceof Error ? err.name : "unknown" });
  });
}

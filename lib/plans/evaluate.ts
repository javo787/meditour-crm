// Единственное место, где считаются предупреждения плана: раннер, PATCH и «Проверено» вызывают эту функцию.
import { getLead } from "@/lib/db";
import { runPlanChecks } from "./checks";
import type { PlanContent, PlanOptions, PlanWarning } from "./schema";
import { PlanInputError, prepareSource } from "./source";

export async function evaluatePlan(p: {
  sourceText: string;
  leadId: string | null;
  content?: PlanContent;
  options: PlanOptions;
  leadName?: string;
  now?: Date;
}): Promise<PlanWarning[]> {
  if (!p.content) return [];

  // Письмо для проверок очищаем так же, как для модели. Если очистка не прошла (письмо слишком короткое), берём как есть.
  let source = p.sourceText;
  try {
    source = prepareSource(p.sourceText);
  } catch (err) {
    if (!(err instanceof PlanInputError)) throw err;
  }

  // Имя лида: если вызывающий его не передал, читаем из CRM. Без лида имени нет.
  let leadName = p.leadName;
  if (leadName === undefined && p.leadId) leadName = (await getLead(p.leadId))?.name;

  return runPlanChecks({ content: p.content, options: p.options, source, leadName, now: p.now });
}

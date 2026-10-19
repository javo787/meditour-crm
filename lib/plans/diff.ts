// Сколько полей правил координатор: число различающихся листовых путей между черновиком модели и текущим планом.
import type { PlanContent } from "./schema";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Массивы сравниваются по индексам. Лишний или пропавший элемент — одно изменение, каким бы сложным он ни был.
function countDiff(a: unknown, b: unknown): number {
  if (Object.is(a, b)) return 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    let changes = 0;
    const longer = Math.max(a.length, b.length);
    for (let i = 0; i < longer; i++) {
      changes += i < a.length && i < b.length ? countDiff(a[i], b[i]) : 1;
    }
    return changes;
  }
  if (isRecord(a) && isRecord(b)) {
    let changes = 0;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      changes += countDiff(a[key], b[key]);
    }
    return changes;
  }
  return 1;
}

// Без черновика модели (план создан вручную) сравнивать не с чем: 0.
export function countChangedFields(aiDraft: PlanContent | undefined, content: PlanContent): number {
  return aiDraft ? countDiff(aiDraft, content) : 0;
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { countChangedFields } from "@/lib/plans/diff";
import { effectiveGeneration, getPlan, startManualPlan } from "@/lib/plans/db";
import { kickPlanGeneration } from "@/lib/plans/runner";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  overwrite: z.boolean().optional(), // заменить правки координатора результатом модели
  manual: z.boolean().optional(), // пустой план для ручного заполнения
});

// Повторная генерация или ручное заполнение. Запуск в фоне: ответ приходит сразу, результат опрашивается через GET плана.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос", code: "invalid" }, { status: 400 });
  const { overwrite, manual } = parsed.data;

  const plan = await getPlan(params.id);
  if (!plan) return NextResponse.json({ error: "План не найден" }, { status: 404 });

  // Идущая генерация блокирует оба пути: и ручное заполнение, и повторный запуск.
  if (effectiveGeneration(plan.generation).state === "running") {
    return NextResponse.json({ error: "Идёт генерация плана. Дождитесь окончания.", code: "running" }, { status: 409 });
  }

  if (manual) {
    const filled = await startManualPlan(params.id);
    if (!filled) {
      return NextResponse.json({ error: "План уже заполнен — вручную заполнить можно только пустой", code: "not-empty" }, { status: 409 });
    }
    return NextResponse.json({ state: "manual" });
  }

  // Правки есть, если содержимое отличается от черновика модели или черновика модели нет (план заполнен вручную).
  const hasEdits =
    plan.content !== undefined && (plan.aiDraft === undefined || countChangedFields(plan.aiDraft, plan.content) > 0);
  if (hasEdits && !overwrite) {
    return NextResponse.json(
      { error: "В плане есть правки. Перегенерация заменит их — подтвердите замену.", code: "has-edits" },
      { status: 409 },
    );
  }

  // Двойной щелчок безвреден: второй запуск не займёт генерацию (claimGeneration в раннере вернёт null).
  kickPlanGeneration(params.id);
  return NextResponse.json({ state: "running" }, { status: 202 });
}

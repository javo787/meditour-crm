import { NextResponse } from "next/server";
import { z } from "zod";

import { getActorName } from "@/lib/plans/actor";
import { hasBlockingWarnings } from "@/lib/plans/checks";
import { effectiveGeneration, getPlan, markReviewed } from "@/lib/plans/db";
import { countChangedFields } from "@/lib/plans/diff";
import { evaluatePlan } from "@/lib/plans/evaluate";

export const dynamic = "force-dynamic";

// Три подтверждения координатора перед «Проверено»: суммы, клиники, пациент. Принимаются только эти ключи.
const CONFIRMATIONS = ["amounts", "clinics", "patient"];

const bodySchema = z.object({
  version: z.number().int().min(1), // версия, которую человек видел на экране
  confirmations: z.array(z.string()).default([]),
});

const CONFLICT_MESSAGE = "План изменился после того, как вы его открыли — обновите страницу";

// Отметка «Проверено»: человек подтверждает ровно ту версию, которую видел. Предупреждения пересчитываются, а не берутся из базы.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Укажите версию плана (version)", code: "invalid" }, { status: 400 });
  const { version, confirmations } = parsed.data;

  const plan = await getPlan(params.id);
  if (!plan) return NextResponse.json({ error: "План не найден" }, { status: 404 });

  // Ровно три ключа: при длине 3 и наличии всех трёх ключей повторов и лишних быть не может.
  const confirmed = confirmations.length === CONFIRMATIONS.length && CONFIRMATIONS.every((key) => confirmations.includes(key));
  if (!confirmed) {
    return NextResponse.json(
      { error: "Нужны три подтверждения: суммы, клиники и пациент", code: "confirmations" },
      { status: 400 },
    );
  }

  if (plan.version !== version) return NextResponse.json({ error: CONFLICT_MESSAGE, code: "conflict" }, { status: 409 });

  if (plan.status !== "draft" || !plan.content) {
    return NextResponse.json({ error: "Отмечать проверенным можно только черновик с содержимым", code: "not-draft" }, { status: 409 });
  }

  if (effectiveGeneration(plan.generation).state === "running") {
    return NextResponse.json({ error: "Идёт генерация плана. Дождитесь окончания.", code: "running" }, { status: 409 });
  }

  const warnings = await evaluatePlan({
    sourceText: plan.source.text,
    leadId: plan.leadId,
    content: plan.content,
    options: plan.options,
    now: new Date(),
  });
  if (hasBlockingWarnings(warnings)) {
    return NextResponse.json(
      {
        error: "Есть красные предупреждения — исправьте план перед отметкой «Проверено»",
        code: "blocked",
        warnings: warnings.filter((w) => w.level === "error"),
      },
      { status: 409 },
    );
  }

  const reviewed = await markReviewed(params.id, {
    version,
    by: await getActorName(),
    confirmations: CONFIRMATIONS,
    changedFields: countChangedFields(plan.aiDraft, plan.content),
    warnings,
  });
  // null: между проверкой и записью план уже изменил кто-то другой (фильтр по version не совпал).
  if (!reviewed) return NextResponse.json({ error: CONFLICT_MESSAGE, code: "conflict" }, { status: 409 });
  return NextResponse.json({ plan: reviewed });
}

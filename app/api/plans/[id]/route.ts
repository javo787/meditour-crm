import { NextResponse } from "next/server";
import { z, type ZodIssue } from "zod";

import { getLead } from "@/lib/db";
import { deletePlan, effectiveGeneration, getPlan, savePlan } from "@/lib/plans/db";
import { evaluatePlan } from "@/lib/plans/evaluate";
import { planContentSchema, planOptionsSchema } from "@/lib/plans/schema";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    version: z.number().int().min(1), // версия, которую человек видел на экране
    content: planContentSchema.optional(),
    options: planOptionsSchema.optional(),
    leadId: z.string().nullable().optional(),
  })
  .refine((body) => body.content !== undefined || body.options !== undefined || body.leadId !== undefined, {
    message: "Нет полей для сохранения: content, options или leadId",
  });

// Ошибка проверки тела: код invalid и путь поля, например «clinics.0.why».
function invalidBody(issue: ZodIssue | undefined) {
  const path = issue ? issue.path.join(".") : "";
  const error = path ? `Некорректные данные плана: ${path}` : "Некорректные данные плана";
  return NextResponse.json({ error, code: "invalid", path }, { status: 400 });
}

const notFound = () => NextResponse.json({ error: "План не найден" }, { status: 404 });

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const plan = await getPlan(params.id);
  if (!plan) return notFound();
  const lead = plan.leadId ? await getLead(plan.leadId) : undefined;
  return NextResponse.json({
    plan: { ...plan, generation: effectiveGeneration(plan.generation) },
    lead: lead ? { id: lead.id, name: lead.name } : null,
  });
}

// Сохранение правок. В базу уходит только то, что пришло в запросе; остальное остаётся как было.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues[0]);
  const body = parsed.data;

  const current = await getPlan(params.id);
  if (!current) return notFound();

  // Новый лид проверяем до записи. Имя прежнего лида evaluatePlan читает сам.
  let leadName: string | undefined;
  if (typeof body.leadId === "string") {
    const lead = await getLead(body.leadId);
    if (!lead) return NextResponse.json({ error: "Лид не найден", code: "lead-not-found" }, { status: 404 });
    leadName = lead.name;
  }

  // Предупреждения считаем по слитому состоянию: письмо из базы, содержимое и параметры — из запроса или из базы.
  const content = body.content ?? current.content;
  const options = body.options ?? current.options;
  const leadId = body.leadId !== undefined ? body.leadId : current.leadId;
  const warnings = await evaluatePlan({
    sourceText: current.source.text,
    leadId,
    content,
    options,
    leadName,
    now: new Date(),
  });

  const patch: Parameters<typeof savePlan>[1] = { version: body.version, warnings };
  if (body.content !== undefined) patch.content = body.content;
  if (body.options !== undefined) patch.options = body.options;
  if (body.leadId !== undefined) patch.leadId = body.leadId;

  const result = await savePlan(params.id, patch);
  if (result.ok) return NextResponse.json({ plan: result.plan });
  if (result.reason === "conflict") {
    return NextResponse.json(
      { error: "План изменён другим пользователем — обновите страницу", code: "conflict" },
      { status: 409 },
    );
  }
  if (result.reason === "generating") {
    return NextResponse.json({ error: "Идёт генерация плана. Дождитесь окончания.", code: "generating" }, { status: 409 });
  }
  return notFound();
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const deleted = await deletePlan(params.id);
  if (!deleted) return notFound();
  return new NextResponse(null, { status: 204 });
}

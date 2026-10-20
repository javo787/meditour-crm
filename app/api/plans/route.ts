import { NextResponse } from "next/server";
import { z } from "zod";

import { getLead } from "@/lib/db";
import { getActorName } from "@/lib/plans/actor";
import { createPlan, listPlans } from "@/lib/plans/db";
import { kickPlanGeneration } from "@/lib/plans/runner";
import { PLAN_LIMITS } from "@/lib/plans/schema";
import { docxToText, PlanInputError, prepareSource } from "@/lib/plans/source";

export const dynamic = "force-dynamic";

// Ошибка запроса с кодом для интерфейса (текст — по-русски).
class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type PlanInput = { sourceText: string; sourceKind: "paste" | "docx"; filename?: string; leadId?: string };

const jsonBodySchema = z.object({ sourceText: z.string(), leadId: z.string().optional() });

// Текст из JSON: проверяется так же, как вставка в форму (по длине как вставлено) и сохраняется с \n.
async function readText(request: Request): Promise<PlanInput> {
  const parsed = jsonBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new RequestError(400, "invalid", "Передайте текст письма в поле sourceText");
  prepareSource(parsed.data.sourceText);
  return {
    sourceText: parsed.data.sourceText.replace(/\r\n/g, "\n"),
    sourceKind: "paste",
    leadId: parsed.data.leadId,
  };
}

// Файл .docx: проверка имени и размера до чтения, затем текст через безопасный разбор.
async function readDocx(request: Request): Promise<PlanInput> {
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw new RequestError(400, "invalid", "Передайте файл .docx в поле file");
  const leadField = form.get("leadId");
  const leadId = typeof leadField === "string" && leadField !== "" ? leadField : undefined;
  if (!file.name.toLowerCase().endsWith(".docx")) throw new PlanInputError("bad-docx");
  if (file.size > PLAN_LIMITS.docxBytes) throw new PlanInputError("docx-too-big");
  const text = await docxToText(Buffer.from(await file.arrayBuffer()));
  prepareSource(text);
  return { sourceText: text, sourceKind: "docx", filename: file.name, leadId };
}

export async function GET() {
  const plans = await listPlans();
  return NextResponse.json({ plans });
}

export async function POST(request: Request) {
  // Размер тела проверяем по заголовку до чтения: большой запрос не загружаем в память.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > PLAN_LIMITS.requestBytes) {
    return NextResponse.json({ error: "Запрос больше 6 МБ. Сократите письмо.", code: "too-big" }, { status: 413 });
  }
  try {
    const isForm = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
    const input = isForm ? await readDocx(request) : await readText(request);
    if (input.leadId && !(await getLead(input.leadId))) {
      throw new RequestError(404, "lead-not-found", "Лид не найден");
    }
    const plan = await createPlan({ ...input, createdBy: await getActorName() });
    kickPlanGeneration(plan.id);
    return NextResponse.json({ id: plan.id }, { status: 201 });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof PlanInputError) {
      const status = err.code === "docx-too-big" ? 413 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

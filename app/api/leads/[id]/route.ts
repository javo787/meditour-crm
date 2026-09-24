import { NextResponse } from "next/server";
import { z } from "zod";
import { addMessage, getLead, updateLead } from "@/lib/db";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  stage: z
    .enum([
      "new",
      "first_contact",
      "consult_scheduled",
      "consult_done",
      "estimate_sent",
      "awaiting_decision",
      "won",
      "declined",
    ])
    .optional(),
  aiPaused: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
  declinedReason: z.string().max(500).optional(),
  source: z.string().max(200).optional(),
  campaign: z.string().max(300).optional(),
  homeLocation: z.string().max(200).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const lead = await getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }
  return NextResponse.json({ lead });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const lead = await updateLead(params.id, parsed.data);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }

  if (parsed.data.aiPaused !== undefined) {
    await addMessage(
      params.id,
      "coordinator",
      parsed.data.aiPaused
        ? "— ИИ поставлен на паузу координатором —"
        : "— ИИ снова ведёт диалог —"
    );
  }

  return NextResponse.json({ lead });
}

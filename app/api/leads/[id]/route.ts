import { NextResponse } from "next/server";
import { z } from "zod";
import { addMessage, getLead, updateLead } from "@/lib/db";
import { sendDay0 } from "@/lib/follow-up";

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

  const before = await getLead(params.id);
  if (!before) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }

  const enteringEstimateSent =
    parsed.data.stage === "estimate_sent" && before.stage !== "estimate_sent";

  const lead = await updateLead(params.id, {
    ...parsed.data,
    ...(enteringEstimateSent
      ? { estimateSentAt: new Date().toISOString(), followUpStep: 0 }
      : {}),
  });
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

  if (enteringEstimateSent) {
    await sendDay0(lead);
  }

  return NextResponse.json({ lead });
}

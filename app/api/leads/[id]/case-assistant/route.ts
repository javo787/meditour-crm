import { NextResponse } from "next/server";
import { z } from "zod";
import { addCaseAssistantMessage, getCaseAssistantMessages, getLead } from "@/lib/db";
import { askCaseAssistant } from "@/lib/gemini";
import { createLogger, newRequestId } from "@/lib/logger";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const log = createLogger("case-assistant");

// Лимит выше, чем у сообщений координатора в WhatsApp (2000) — сюда
// вставляют целые куски медицинских документов.
const bodySchema = z.object({ text: z.string().min(1).max(20000) });

function buildLeadContext(lead: Lead): string {
  const lines = [
    `Patient name: ${lead.name}`,
    `Diagnosis on file: ${lead.diagnosis || "not specified yet"}`,
  ];
  if (lead.anamnesis?.age) lines.push(`Age on file: ${lead.anamnesis.age}`);
  if (lead.homeLocation) lines.push(`Home location: ${lead.homeLocation}`);
  if (lead.anamnesis?.proceduresDone?.length) {
    lines.push(`Procedures already done: ${lead.anamnesis.proceduresDone.join(", ")}`);
  }
  if (lead.anamnesis?.summary) {
    lines.push(`Case summary on file: ${lead.anamnesis.summary}`);
  }
  return lines.join("\n");
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const lead = await getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }
  return NextResponse.json({ messages: await getCaseAssistantMessages(params.id) });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const requestId = newRequestId();
  const logger = log.child(requestId);

  const lead = await getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 });
  }

  // Сохраняем реплику координатора сразу, до вызова Gemini — она уже
  // валидный факт истории независимо от того, получится ли документ.
  const userMessage = await addCaseAssistantMessage(params.id, "user", parsed.data.text);
  const history = await getCaseAssistantMessages(params.id);

  logger.info("Запрос на Medical Opinion Request", {
    leadId: params.id,
    historyMessages: history.length,
  });

  try {
    const reply = await askCaseAssistant({
      history: history.map((m) => ({ role: m.role, text: m.text })),
      leadContext: buildLeadContext(lead),
      requestId,
    });
    const assistantMessage = await addCaseAssistantMessage(params.id, "assistant", reply);
    return NextResponse.json({ messages: [userMessage, assistantMessage] });
  } catch (err) {
    logger.error("Не удалось получить ответ ассистента по Medical Opinion Request", {
      leadId: params.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        messages: [userMessage],
        error: "Не удалось сгенерировать документ — попробуйте отправить ещё раз",
      },
      { status: 502 }
    );
  }
}

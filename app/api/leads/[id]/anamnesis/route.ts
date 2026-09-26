import { NextResponse } from "next/server";
import { getLead, getMessages, updateLead } from "@/lib/db";
import { extractAnamnesis } from "@/lib/gemini";
import { createLogger, newRequestId } from "@/lib/logger";
import type { MessageSender } from "@/lib/types";

export const dynamic = "force-dynamic";

const log = createLogger("anamnesis-extract");

function speakerLabel(from: MessageSender): string {
  return from === "patient" ? "Пациент" : "Meditour";
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const requestId = newRequestId();
  const logger = log.child(requestId);

  const lead = await getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }

  const messages = await getMessages(params.id);
  if (messages.length === 0) {
    return NextResponse.json(
      { error: "Переписки с пациентом пока нет — нечего анализировать" },
      { status: 400 }
    );
  }

  const transcript = messages.map((m) => `${speakerLabel(m.from)}: ${m.text}`).join("\n");

  logger.info("Извлечение анамнеза из переписки", {
    leadId: params.id,
    messageCount: messages.length,
  });

  try {
    const extracted = await extractAnamnesis({ transcript, requestId });
    const updated = await updateLead(params.id, {
      anamnesis: {
        age: extracted.age ?? undefined,
        proceduresDone: extracted.proceduresDone,
        summary: extracted.summary,
      },
    });
    return NextResponse.json({ lead: updated });
  } catch (err) {
    logger.error("Не удалось извлечь анамнез", {
      leadId: params.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Не удалось обновить анамнез — попробуйте ещё раз" },
      { status: 502 }
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { addCaseAssistantMessage, getCaseAssistantMessages, getLead, getMessages } from "@/lib/db";
import { askCaseAssistant } from "@/lib/gemini";
import { createLogger, newRequestId } from "@/lib/logger";
import type { ChatMessage, Lead } from "@/lib/types";

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

// Полный текст переписки с пациентом в WhatsApp — то, о чём спрашивал
// координатор ("возьмёт ли сама из чата"). Важная оговорка: тут только
// текст. Сами фото/голосовые нигде не сохраняются (см. app/api/whatsapp-webhook) —
// от них остаётся только метка "(+фото)"/"(+голосовое)" без содержимого,
// поэтому явно предупреждаем модель, а не выдаём это молча за полноту данных.
function buildConversationTranscript(messages: ChatMessage[]): string {
  if (messages.length === 0) return "";
  const lines = messages.map((m) => `${m.from === "patient" ? "Patient" : "Meditour"}: ${m.text}`);
  return (
    `# WHATSAPP CONVERSATION WITH THE PATIENT SO FAR\n` +
    `Extract any clinical facts already mentioned here instead of asking the coordinator to retype them. ` +
    `A "(+фото)"/"(+голосовое)" marker means a photo or voice note was sent, but its content is NOT included below — ` +
    `only the fact that something was sent. If such a marker sits where a medical document was likely shared, say so in your reply and ask the coordinator to paste the document's text.\n` +
    lines.join("\n")
  );
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
  const [history, whatsappMessages] = await Promise.all([
    getCaseAssistantMessages(params.id),
    getMessages(params.id),
  ]);

  const transcript = buildConversationTranscript(whatsappMessages);
  const leadContext = transcript ? `${buildLeadContext(lead)}\n\n${transcript}` : buildLeadContext(lead);

  logger.info("Запрос на Medical Opinion Request", {
    leadId: params.id,
    historyMessages: history.length,
    whatsappMessages: whatsappMessages.length,
  });

  try {
    const reply = await askCaseAssistant({
      history: history.map((m) => ({ role: m.role, text: m.text })),
      leadContext,
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

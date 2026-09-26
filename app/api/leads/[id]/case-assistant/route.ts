import { NextResponse } from "next/server";
import { z } from "zod";
import { addCaseAssistantMessage, getCaseAssistantMessages, getLead, getMediaAssetsForLead, getMessages } from "@/lib/db";
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
// координатор ("возьмёт ли сама из чата"). Сами фото/голосовые из этой
// переписки идут отдельно как настоящие inlineData-части (см. media ниже
// и MediaAssets в lib/db.ts) — тут только текстовый транскрипт с пометками
// "(+фото)"/"(+голосовое)", чтобы модель понимала, где именно во времени
// каждое вложение было отправлено относительно остального текста.
function buildConversationTranscript(messages: ChatMessage[]): string {
  if (messages.length === 0) return "";
  const lines = messages.map((m) => `${m.from === "patient" ? "Patient" : "Meditour"}: ${m.text}`);
  return (
    `# WHATSAPP CONVERSATION WITH THE PATIENT SO FAR\n` +
    `Extract any clinical facts already mentioned here instead of asking the coordinator to retype them. ` +
    `A "(+фото)"/"(+голосовое)" marker means a photo or voice note was sent at that point — the actual files ` +
    `are attached separately below/above as images or audio, in the same order they were sent.\n` +
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
  const [history, whatsappMessages, mediaAssets] = await Promise.all([
    getCaseAssistantMessages(params.id),
    getMessages(params.id),
    getMediaAssetsForLead(params.id),
  ]);

  const transcript = buildConversationTranscript(whatsappMessages);
  const leadContext = transcript ? `${buildLeadContext(lead)}\n\n${transcript}` : buildLeadContext(lead);

  logger.info("Запрос на Medical Opinion Request", {
    leadId: params.id,
    historyMessages: history.length,
    whatsappMessages: whatsappMessages.length,
    mediaAssets: mediaAssets.length,
  });

  try {
    const reply = await askCaseAssistant({
      history: history.map((m) => ({ role: m.role, text: m.text })),
      leadContext,
      media: mediaAssets.map((m) => ({ mimeType: m.mimeType, base64: m.base64 })),
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

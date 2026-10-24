import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addCaseAssistantMessage,
  getCaseAssistantMessages,
  getDocuments,
  getLead,
  getMediaAssetsForLead,
  getMessages,
} from "@/lib/db";
import { buildDocumentsContext } from "@/lib/dossier";
import { ensureTranscriptsForLead } from "@/lib/transcription";
import { buildConversationTranscript } from "@/lib/transcripts";
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
  await ensureTranscriptsForLead(params.id);

  const [history, whatsappMessages, allMediaAssets, documents] = await Promise.all([
    getCaseAssistantMessages(params.id),
    getMessages(params.id),
    getMediaAssetsForLead(params.id),
    getDocuments(params.id),
  ]);

  // Фото, которые уже разобраны в «Документах», идут в ассистент текстом
  // (перевод), а не картинкой: раньше каждая реплика координатора заново
  // отправляла в Gemini все фото лида целиком. Неразобранные фото и голосовые
  // по-прежнему прикладываются как есть.
  const processedMediaIds = new Set(
    documents.filter((d) => d.status === "done" && d.mediaMessageId).map((d) => d.mediaMessageId as string)
  );

  // Also filter out audio files that have transcripts, so we don't send both transcript and audio to Gemini
  const msgsWithTranscript = new Set(whatsappMessages.filter(m => m.transcript).map(m => m.id));
  const mediaAssets = allMediaAssets.filter((m) =>
    (m.kind === "audio" && !msgsWithTranscript.has(m.messageId)) ||
    (m.kind === "image" && !processedMediaIds.has(m.messageId))
  );

  const transcript = buildConversationTranscript(whatsappMessages);
  const documentsContext = buildDocumentsContext(documents);
  const leadContext = [buildLeadContext(lead), documentsContext, transcript].filter(Boolean).join("\n\n");

  logger.info("Запрос на Medical Opinion Request", {
    leadId: params.id,
    historyMessages: history.length,
    whatsappMessages: whatsappMessages.length,
    mediaAssets: mediaAssets.length,
    mediaAssetsSkippedAsText: allMediaAssets.length - mediaAssets.length,
    documentsTranslated: documents.filter((d) => d.status === "done" && d.include).length,
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

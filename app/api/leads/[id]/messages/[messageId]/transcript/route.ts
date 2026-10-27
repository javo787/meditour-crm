import { NextResponse } from "next/server";
import { z } from "zod";
import { getMessageById, setCoordinatorTranscript } from "@/lib/db";
import { ensureTranscript } from "@/lib/transcription";
import { newRequestId } from "@/lib/logger";
import type { ChatMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

// trim() стоит до min(1): строка из одних пробелов должна считаться пустой.
const patchBodySchema = z.object({
  text: z.string().trim().min(1).max(8000),
});

// Голосовое сообщение этого лида. Признак media снимается очисткой хранилища, а расшифровка остаётся,
// поэтому сообщение с расшифровкой тоже считается голосовым (её по-прежнему можно открыть и править).
async function findVoiceMessage(leadId: string, messageId: string): Promise<ChatMessage | null> {
  const message = await getMessageById(messageId);
  if (!message || message.leadId !== leadId) return null;
  if (message.media?.kind !== "audio" && !message.transcript) return null;
  return message;
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string; messageId: string } }
) {
  const message = await findVoiceMessage(params.id, params.messageId);
  if (!message) {
    return NextResponse.json({ error: "Голосовое сообщение не найдено" }, { status: 404 });
  }

  const transcript = await ensureTranscript(params.messageId, { requestId: newRequestId() });
  if (!transcript) {
    return NextResponse.json({ error: "Не удалось расшифровать голосовое" }, { status: 502 });
  }
  return NextResponse.json({ transcript });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; messageId: string } }
) {
  const message = await findVoiceMessage(params.id, params.messageId);
  if (!message) {
    return NextResponse.json({ error: "Голосовое сообщение не найдено" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Расшифровка не может быть пустой или длиннее 8000 символов" }, { status: 400 });
  }

  await setCoordinatorTranscript(params.messageId, parsed.data.text);
  const updated = await getMessageById(params.messageId);
  return NextResponse.json({ transcript: updated?.transcript });
}

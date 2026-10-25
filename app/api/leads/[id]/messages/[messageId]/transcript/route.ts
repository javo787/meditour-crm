import { NextResponse } from "next/server";
import { z } from "zod";
import { getMessageById, setCoordinatorTranscript } from "@/lib/db";
import { ensureTranscript } from "@/lib/transcription";
import { createLogger, newRequestId } from "@/lib/logger";

const log = createLogger("transcript-api");

const patchBodySchema = z.object({
  text: z.string().min(1).max(8000).trim(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string; messageId: string } }
) {
  const requestId = newRequestId();

  const m = await getMessageById(params.messageId);
  if (!m || m.leadId !== params.id || m.media?.kind !== "audio") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const transcript = await ensureTranscript(params.messageId, { requestId });
  if (!transcript) {
    return NextResponse.json({ error: "Failed to transcribe" }, { status: 502 });
  }

  return NextResponse.json({ transcript });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; messageId: string } }
) {
  const m = await getMessageById(params.messageId);
  if (!m || m.leadId !== params.id || m.media?.kind !== "audio") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await setCoordinatorTranscript(params.messageId, parsed.data.text);
  const updatedM = await getMessageById(params.messageId);

  return NextResponse.json({ transcript: updatedM?.transcript });
}

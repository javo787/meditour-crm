import { generateWithFallback } from "./gemini";
import { getMediaAssetByMessageId, setAiTranscript, getAudioMessagesWithoutTranscript, getMessageById } from "./db";
import { voiceLine } from "./transcripts";
import { createLogger, newRequestId } from "./logger";
import type { MessageTranscript } from "./types";

const log = createLogger("transcription");

export const TRANSCRIPTION_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
export const TRANSCRIPTION_TIMEOUT_MS = 20000; // 20s

export class TranscriptionSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionSizeError";
  }
}

export interface TranscribeAudioParams {
  base64: string;
  mimeType: string;
  requestId?: string;
}

export async function transcribeAudio({ base64, mimeType, requestId }: TranscribeAudioParams): Promise<{ text: string, model: string }> {
  // Check estimated size
  const sizeBytes = Buffer.from(base64, 'base64').length;
  if (sizeBytes > TRANSCRIPTION_MAX_BYTES) {
    throw new TranscriptionSizeError(`Audio size ${sizeBytes} exceeds limit of ${TRANSCRIPTION_MAX_BYTES}`);
  }

  const systemInstruction = "Запиши речь дословно на языке оригинала (таджикский, русский, узбекский, английский, в том числе вперемешку), не переводи и не комментируй, названия лекарств, дозы и цифры записывай как слышно, неразборчивое помечай «[неразборчиво]», при отсутствии речи верни «[речи не слышно]».";

  const contents = [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64
          }
        }
      ]
    }
  ];

  const options = {
    generationConfig: { temperature: 0.1 },
  };

  const reqId = requestId || newRequestId();
  const logger = log.child(reqId);
  const result = await generateWithFallback(contents, systemInstruction, logger, options);

  return {
    text: typeof result === "string" ? result : result.text,
    model: "flash"
  };
}

// Global map for pending transcriptions
export const pendingTranscripts = new Map<string, Promise<MessageTranscript | null>>();

export function startTranscription(messageId: string, audio: { base64: string, mimeType: string }): void {
  const promise = (async () => {
    try {
      const { text, model } = await transcribeAudio(audio);
      await setAiTranscript(messageId, { text, model });
      const m = await getMessageById(messageId);
      return m?.transcript || null;
    } catch (err) {
      log.error("Transcription failed", { messageId, error: err instanceof Error ? err.message : String(err) });
      return null;
    } finally {
      pendingTranscripts.delete(messageId);
    }
  })();
  pendingTranscripts.set(messageId, promise);
}

export async function waitForTranscript(messageId: string, timeoutMs: number): Promise<MessageTranscript | null> {
  const pending = pendingTranscripts.get(messageId);
  if (pending) {
    return Promise.race([
      pending,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  }
  const m = await getMessageById(messageId);
  return m?.transcript || null;
}

export async function ensureTranscript(messageId: string, { requestId }: { requestId?: string }): Promise<MessageTranscript | null> {
  const m = await getMessageById(messageId);
  if (m?.transcript) return m.transcript;

  const pending = pendingTranscripts.get(messageId);
  if (pending) return pending;

  const asset = await getMediaAssetByMessageId(messageId);
  if (!asset || asset.kind !== "audio") return null;

  try {
    const { text, model } = await transcribeAudio({
      base64: asset.base64,
      mimeType: asset.mimeType,
      requestId
    });
    await setAiTranscript(messageId, { text, model });
    const updated = await getMessageById(messageId);
    return updated?.transcript || null;
  } catch (err) {
     log.error("ensureTranscript failed", { messageId, error: err instanceof Error ? err.message : String(err) });
     return null;
  }
}

export async function ensureTranscriptsForLead(leadId: string, { limit = 10, concurrency = 3 }: { limit?: number, concurrency?: number } = {}): Promise<void> {
  const messages = await getAudioMessagesWithoutTranscript(leadId, limit);

  for (let i = 0; i < messages.length; i += concurrency) {
    const batch = messages.slice(i, i + concurrency);
    await Promise.all(batch.map(m => ensureTranscript(m.id, {})));
  }
}

export interface ResolveVoiceItem {
  messageId?: string;
  text: string;
  audio?: { base64: string, mimeType: string };
  // ... other properties from item that we don't care about here
  [key: string]: any;
}

export interface ResolveDeps {
  waitForTranscript: (id: string, timeout: number) => Promise<MessageTranscript | null>;
  timeoutMs: number;
}

export async function resolveVoiceItems(items: ResolveVoiceItem[], deps: ResolveDeps): Promise<ResolveVoiceItem[]> {
  const results: ResolveVoiceItem[] = [];

  for (const item of items) {
    if (item.audio && item.messageId) {
      const transcript = await deps.waitForTranscript(item.messageId, deps.timeoutMs);
      if (transcript) {
        // Success: replace text and remove audio
        const newItem = { ...item, text: voiceLine(transcript.text) };
        delete newItem.audio;
        results.push(newItem);
        continue;
      }
    }
    results.push(item);
  }

  return results;
}

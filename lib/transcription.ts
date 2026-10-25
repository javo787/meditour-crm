// Расшифровка голосовых сообщений WhatsApp: один раз при получении, текст хранится в сообщении (поле transcript)
// и дальше читается вместо аудио. Подробности и причины решений: docs/superpowers/specs/2026-10-24-voice-transcripts-design.md.
import { generateWithFallback } from "./gemini";
import { getAudioMessagesWithoutTranscript, getMediaAssetByMessageId, getMessageById, setAiTranscript } from "./db";
import { createLogger, newRequestId } from "./logger";
import { voiceLine } from "./transcripts";
import type { MessageTranscript } from "./types";

const log = createLogger("transcription");

export const TRANSCRIPTION_MAX_BYTES = 15 * 1024 * 1024; // 15 МБ после декодирования
export const TRANSCRIPTION_TIMEOUT_MS = 20000; // сколько пачка ждёт расшифровку перед ответом ИИ

const TRANSCRIPTION_INSTRUCTION =
  "Запиши речь дословно на языке оригинала (таджикский, русский, узбекский, английский, в том числе вперемешку), " +
  "не переводи и не комментируй, названия лекарств, дозы и цифры записывай как слышно, " +
  "неразборчивое помечай «[неразборчиво]», при отсутствии речи верни «[речи не слышно]».";

export class TranscriptionSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionSizeError";
  }
}

export interface AudioInput {
  base64: string;
  mimeType: string;
}

export interface TranscribeAudioParams extends AudioInput {
  requestId?: string;
}

export async function transcribeAudio({
  base64,
  mimeType,
  requestId,
}: TranscribeAudioParams): Promise<{ text: string; model: string }> {
  // Размер оцениваем по длине base64 (3 байта на 4 символа), без декодирования в память.
  const approxBytes = Math.floor(base64.length * 0.75);
  if (approxBytes > TRANSCRIPTION_MAX_BYTES) {
    throw new TranscriptionSizeError(`Размер аудио ${approxBytes} байт больше лимита ${TRANSCRIPTION_MAX_BYTES}`);
  }

  const contents = [
    {
      role: "user",
      parts: [{ text: "Расшифруй это голосовое сообщение." }, { inlineData: { mimeType, data: base64 } }],
    },
  ];
  const logger = log.child(requestId ?? newRequestId());
  const result = await generateWithFallback(contents, TRANSCRIPTION_INSTRUCTION, logger, {
    generationConfig: { temperature: 0.1 },
  });

  // Пустой ответ не сохраняем: пустая расшифровка выглядела бы как готовая и блокировала бы повторную попытку.
  const text = result.text.trim();
  if (!text) throw new Error("Модель вернула пустую расшифровку");
  return { text, model: result.model };
}

// Идущие расшифровки по id сообщения. Процесс один (WEB_CONCURRENCY=1), как и у pendingBatches в вебхуке.
export const pendingTranscripts = new Map<string, Promise<MessageTranscript | null>>();

// Одна расшифровка на сообщение: фоновый запуск, ручной запрос координатора и ленивая расшифровка присоединяются к одной.
function transcribeAndStore(messageId: string, audio: AudioInput, requestId?: string): Promise<MessageTranscript | null> {
  const existing = pendingTranscripts.get(messageId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { text, model } = await transcribeAudio({ ...audio, requestId });
      await setAiTranscript(messageId, { text, model });
      return (await getMessageById(messageId))?.transcript ?? null;
    } catch (err) {
      // В журнал только причина сбоя: текст расшифровки сюда не попадает.
      log.error("не удалось расшифровать голосовое", {
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      pendingTranscripts.delete(messageId);
    }
  })();
  pendingTranscripts.set(messageId, promise);
  return promise;
}

// Фоновый запуск при получении сообщения. Не бросает ошибок.
export function startTranscription(messageId: string, audio: AudioInput): void {
  void transcribeAndStore(messageId, audio);
}

// Ждёт идущую расшифровку не дольше timeoutMs; если её нет, читает готовую из базы.
export async function waitForTranscript(messageId: string, timeoutMs: number): Promise<MessageTranscript | null> {
  const pending = pendingTranscripts.get(messageId);
  if (pending) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  return (await getMessageById(messageId))?.transcript ?? null;
}

// Есть расшифровка: вернуть. Идёт: присоединиться. Иначе взять байты из MediaAssets и расшифровать.
export async function ensureTranscript(
  messageId: string,
  { requestId }: { requestId?: string } = {}
): Promise<MessageTranscript | null> {
  const message = await getMessageById(messageId);
  if (message?.transcript) return message.transcript;

  const pending = pendingTranscripts.get(messageId);
  if (pending) return pending;

  const asset = await getMediaAssetByMessageId(messageId);
  if (!asset || asset.kind !== "audio") return null;
  return transcribeAndStore(messageId, { base64: asset.base64, mimeType: asset.mimeType }, requestId);
}

// Для анамнеза и запроса мнения: расшифровывает недостающие голосовые (самые свежие первыми), остальные остаются как аудио.
export async function ensureTranscriptsForLead(
  leadId: string,
  { limit = 10, concurrency = 3 }: { limit?: number; concurrency?: number } = {}
): Promise<void> {
  let messages: Array<{ id: string }>;
  try {
    messages = await getAudioMessagesWithoutTranscript(leadId, limit);
  } catch (err) {
    log.error("не удалось получить голосовые без расшифровки", {
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  for (let i = 0; i < messages.length; i += concurrency) {
    const batch = messages.slice(i, i + concurrency);
    await Promise.all(batch.map((m) => ensureTranscript(m.id).catch(() => null)));
  }
}

export interface ResolveVoiceItem {
  messageId?: string;
  text: string;
  audio?: AudioInput;
  [key: string]: unknown;
}

export interface ResolveDeps {
  waitForTranscript: (id: string, timeoutMs: number) => Promise<MessageTranscript | null>;
  timeoutMs: number;
}

// Шаг пачки перед ответом ИИ: голосовое с готовой расшифровкой идёт в модель текстом вместо аудио.
// Ожидания идут параллельно (несколько голосовых не складывают таймауты). Сбой или таймаут оставляют элемент как есть.
export async function resolveVoiceItems<T extends ResolveVoiceItem>(items: T[], deps: ResolveDeps): Promise<T[]> {
  return Promise.all(
    items.map(async (item) => {
      if (!item.audio || !item.messageId) return item;
      try {
        const transcript = await deps.waitForTranscript(item.messageId, deps.timeoutMs);
        if (!transcript) return item;
        const resolved = { ...item, text: voiceLine(transcript.text) };
        delete resolved.audio;
        return resolved;
      } catch {
        return item;
      }
    })
  );
}

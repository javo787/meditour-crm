// Разбор вебхуков Instagram (объект "instagram", поля comments и messages)
// и проверка подписи X-Hub-Signature-256. Разбор терпимый: мусор даёт пустой список, исключений нет.
import { createHmac, timingSafeEqual } from "crypto";

export type InstagramEvent =
  | {
      type: "comment";
      accountId: string;
      commentId: string;
      mediaId?: string;
      fromId: string;
      fromUsername?: string;
      text: string;
      parentId?: string;
    }
  | { type: "dm"; accountId: string; mid: string; senderId: string; text?: string; hasAttachment: boolean }
  | { type: "echo"; accountId: string; mid: string; recipientId: string };

type Json = Record<string, unknown>;

const SIGNATURE_PREFIX = "sha256=";
const SHA256_HEX_LENGTH = 64;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Подпись X-Hub-Signature-256: HMAC-SHA256 от сырого тела запроса, секрет приложения.
export function verifySignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const received = header.slice(SIGNATURE_PREFIX.length);
  if (received.length !== SHA256_HEX_LENGTH || !/^[0-9a-f]+$/i.test(received)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(received, "hex"));
}

function parseComment(accountId: string, change: unknown): InstagramEvent | null {
  if (!isRecord(change) || change.field !== "comments" || !isRecord(change.value)) return null;
  const value = change.value;
  if (typeof value.id !== "string" || !isRecord(value.from) || typeof value.from.id !== "string") return null;

  const event: InstagramEvent = {
    type: "comment",
    accountId,
    commentId: value.id,
    fromId: value.from.id,
    text: typeof value.text === "string" ? value.text : "",
  };
  if (typeof value.from.username === "string") event.fromUsername = value.from.username;
  if (typeof value.parent_id === "string") event.parentId = value.parent_id;
  if (isRecord(value.media) && typeof value.media.id === "string") event.mediaId = value.media.id;
  return event;
}

function parseMessaging(accountId: string, item: unknown): InstagramEvent | null {
  // Подтверждения прочтения, реакции и постбэки не содержат message — пропускаем.
  if (!isRecord(item) || !isRecord(item.message)) return null;
  const message = item.message;
  if (typeof message.mid !== "string") return null;

  if (message.is_echo === true) {
    if (!isRecord(item.recipient) || typeof item.recipient.id !== "string") return null;
    return { type: "echo", accountId, mid: message.mid, recipientId: item.recipient.id };
  }

  if (!isRecord(item.sender) || typeof item.sender.id !== "string") return null;
  const event: InstagramEvent = {
    type: "dm",
    accountId,
    mid: message.mid,
    senderId: item.sender.id,
    hasAttachment: Array.isArray(message.attachments) && message.attachments.length > 0,
  };
  if (typeof message.text === "string") event.text = message.text;
  return event;
}

export function parseInstagramWebhook(body: unknown): InstagramEvent[] {
  if (!isRecord(body) || body.object !== "instagram" || !Array.isArray(body.entry)) return [];

  const events: InstagramEvent[] = [];
  for (const entry of body.entry) {
    // id записи — это id нашего аккаунта Instagram.
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const accountId = entry.id;

    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        const event = parseComment(accountId, change);
        if (event) events.push(event);
      }
    }
    if (Array.isArray(entry.messaging)) {
      for (const item of entry.messaging) {
        const event = parseMessaging(accountId, item);
        if (event) events.push(event);
      }
    }
  }
  return events;
}

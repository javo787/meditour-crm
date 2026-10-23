// Хранение бота Instagram в MongoDB (база meditur, коллекции без индексов, как lib/plans/db.ts):
// журнал событий для дедупликации вебхуков, контакты (cooldown и пауза ИИ), переписка для ИИ,
// токен Graph API с продлением.
import { createHash } from "crypto";
import type { Document, ObjectId } from "mongodb";

import { getDb } from "@/lib/mongodb";
import type { ChatMessage } from "@/lib/types";
import type { GraphResult } from "./graph";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TOKEN_REFRESH_AFTER_MS = 30 * DAY_MS;
const REFRESH_ATTEMPT_GAP_MS = 12 * HOUR_MS;
const DUPLICATE_KEY_CODE = 11000;
const TOKEN_DOC_ID = "token";

interface EventDoc {
  _id: string;
  at: string;
}

export interface InstagramContact {
  _id: string; // id пользователя Instagram
  lastDmInviteAt?: string;
  lastCommentReplyAt?: string;
  aiPausedUntil?: string; // до этого момента ИИ не отвечает в личке (ISO)
}

export type IgMessageFrom = "patient" | "ai" | "coordinator";

// Переписка в личке Instagram: сообщения пациента, ответы бота и координатора.
interface IgMessageDoc {
  _id: ObjectId;
  igUserId: string;
  from: IgMessageFrom;
  text: string;
  at: string; // ISO
  mid?: string; // id сообщения в Instagram, если он известен
}

// Единственная запись токена. source — отпечаток токена окружения, по которому понятно, какой токен сохранён.
interface AuthDoc {
  _id: string;
  accessToken: string;
  source: string;
  refreshedAt?: string;
  lastAttemptAt?: string;
}

async function collection<T extends Document>(name: string) {
  const db = await getDb();
  return db.collection<T>(name);
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === DUPLICATE_KEY_CODE;
}

// Занимает ключ события. false — такое событие уже обработано (дубликат), вебхук повторно не отвечает.
export async function claimEvent(key: string, now: Date = new Date()): Promise<boolean> {
  const events = await collection<EventDoc>("InstagramEvents");
  try {
    await events.insertOne({ _id: key, at: now.toISOString() });
    return true;
  } catch (err) {
    if (isDuplicateKeyError(err)) return false;
    throw err;
  }
}

export async function getContact(id: string): Promise<InstagramContact | null> {
  const contacts = await collection<InstagramContact>("InstagramContacts");
  return contacts.findOne({ _id: id });
}

export async function markDmInvited(id: string, now: Date = new Date()): Promise<void> {
  const contacts = await collection<InstagramContact>("InstagramContacts");
  await contacts.updateOne({ _id: id }, { $set: { lastDmInviteAt: now.toISOString() } }, { upsert: true });
}

export async function markCommentReplied(id: string, now: Date = new Date()): Promise<void> {
  const contacts = await collection<InstagramContact>("InstagramContacts");
  await contacts.updateOne({ _id: id }, { $set: { lastCommentReplyAt: now.toISOString() } }, { upsert: true });
}

export async function pauseAi(igUserId: string, until: Date): Promise<void> {
  const contacts = await collection<InstagramContact>("InstagramContacts");
  await contacts.updateOne({ _id: igUserId }, { $set: { aiPausedUntil: until.toISOString() } }, { upsert: true });
}

export async function addIgMessage(m: {
  igUserId: string;
  from: IgMessageFrom;
  text: string;
  at?: Date;
  mid?: string;
}): Promise<void> {
  const messages = await collection<Omit<IgMessageDoc, "_id">>("InstagramMessages");
  await messages.insertOne({
    igUserId: m.igUserId,
    from: m.from,
    text: m.text,
    at: (m.at ?? new Date()).toISOString(),
    ...(m.mid !== undefined ? { mid: m.mid } : {}),
  });
}

// Последние limit сообщений собеседника, по возрастанию времени.
export async function getIgMessages(igUserId: string, limit = 30): Promise<ChatMessage[]> {
  const messages = await collection<IgMessageDoc>("InstagramMessages");
  const docs = await messages.find({ igUserId }).sort({ at: -1, _id: -1 }).limit(limit).toArray();
  return docs.reverse().map((d) => ({
    id: d._id.toString(),
    leadId: igUserId,
    from: d.from,
    text: d.text,
    at: d.at,
  }));
}

export async function findIgMessageByMid(mid: string): Promise<boolean> {
  const messages = await collection<IgMessageDoc>("InstagramMessages");
  return (await messages.findOne({ mid })) !== null;
}

export async function countIgAiMessagesSince(igUserId: string, sinceIso: string): Promise<number> {
  const messages = await collection<IgMessageDoc>("InstagramMessages");
  return messages.countDocuments({ igUserId, from: "ai", at: { $gte: sinceIso } });
}

function sourceOf(envToken: string): string {
  return createHash("sha256").update(envToken).digest("hex").slice(0, 16);
}

// Сохранённая запись, только если она получена из текущего токена окружения. Иначе это запись от старого токена.
async function currentAuth(envToken: string): Promise<AuthDoc | null> {
  const auth = await collection<AuthDoc>("InstagramAuth");
  const doc = await auth.findOne({ _id: TOKEN_DOC_ID });
  return doc && doc.source === sourceOf(envToken) ? doc : null;
}

// Токен для работы: сохранённый (продлённый), если он от текущего токена окружения, иначе токен из окружения.
// Новый токен, вставленный в окружение, всегда побеждает.
export async function getEffectiveToken(envToken: string): Promise<string> {
  if (!envToken) return envToken;
  const doc = await currentAuth(envToken);
  return doc ? doc.accessToken : envToken;
}

// Продление токена раз в 30 дней, не чаще одной попытки в 12 часов. Ошибки продления не выбрасываются:
// при неудаче возвращается прежний токен.
export async function ensureFreshToken(
  envToken: string,
  refresh: (token: string) => Promise<GraphResult<{ access_token: string }>>,
  now: Date = new Date(),
): Promise<string> {
  if (!envToken) return envToken;

  const current = await currentAuth(envToken);
  const token = current ? current.accessToken : envToken;
  const refreshedMs = current?.refreshedAt ? Date.parse(current.refreshedAt) : null;
  const attemptMs = current?.lastAttemptAt ? Date.parse(current.lastAttemptAt) : null;
  const ageDue = refreshedMs === null || refreshedMs < now.getTime() - TOKEN_REFRESH_AFTER_MS;
  const attemptDue = attemptMs === null || attemptMs < now.getTime() - REFRESH_ATTEMPT_GAP_MS;
  if (!ageDue || !attemptDue) return token;

  let fresh: string | null = null;
  try {
    const result = await refresh(token);
    if (result.ok && typeof result.data?.access_token === "string" && result.data.access_token !== "") {
      fresh = result.data.access_token;
    }
  } catch {
    fresh = null;
  }

  const auth = await collection<AuthDoc>("InstagramAuth");
  const source = sourceOf(envToken);
  const iso = now.toISOString();
  if (fresh) {
    await auth.replaceOne({ _id: TOKEN_DOC_ID }, { accessToken: fresh, source, refreshedAt: iso }, { upsert: true });
    return fresh;
  }

  // Неудача: запоминаем время попытки. Прежнее refreshedAt сохраняем только для того же токена.
  await auth.replaceOne(
    { _id: TOKEN_DOC_ID },
    {
      accessToken: token,
      source,
      ...(current?.refreshedAt ? { refreshedAt: current.refreshedAt } : {}),
      lastAttemptAt: iso,
    },
    { upsert: true },
  );
  return token;
}

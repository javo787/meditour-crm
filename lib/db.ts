import { createHash } from "node:crypto";
import { ObjectId, type Collection, type Filter } from "mongodb";

import { getDb } from "@/lib/mongodb";
import { createLogger } from "@/lib/logger";
import { ECHO_WINDOW_MS, findEchoMatch } from "@/lib/outgoing-echo";
import { applyTeamPatch, UNASSIGNED, type TeamPatch, type TeamSettings } from "@/lib/team";
import { DEFAULT_CRM_TIMEZONE, endOfDayInZone } from "@/lib/touches";
import { isMostlyIllegible, MAX_DOCUMENT_ATTEMPTS } from "@/lib/documents";
import type {
  CaseAssistantMessage,
  CaseAssistantRole,
  ChatMessage,
  DocumentCategory,
  DocumentSource,
  DocumentStatus,
  DossierProfile,
  Lead,
  MessageSender,
  PatientDocument,
  Stage,
} from "@/lib/types";

const log = createLogger("db");

// Слой данных поверх MongoDB Atlas (коллекции Leads и Messages из Этапа 1
// плана). Раньше (Этап 2) здесь был массив в памяти процесса — сигнатуры
// функций намеренно не поменялись, только стали асинхронными, поэтому весь
// интерфейс из Этапа 2 (канбан, таблица, карточка пациента) продолжает
// работать без изменений, просто теперь читает и пишет в реальную базу.

interface LeadDoc {
  _id: ObjectId;
  name: string;
  phone: string;
  diagnosis: string;
  stage: Stage;
  assignee: string;
  nextTouch: string;
  createdAt: string;
  hospital?: string;
  aiPaused: boolean;
  anamnesis?: Lead["anamnesis"];
  source?: string;
  campaign?: string;
  homeLocation?: string;
  declinedReason?: string;
  notes?: string;
  estimateSentAt?: string;
  followUpStep?: number;
  tags?: string[];
  lastMessageFrom?: MessageSender;
  lastMessageAt?: string;
  noResponse?: boolean;
}

interface MessageDoc {
  _id: ObjectId;
  leadId: ObjectId;
  from: MessageSender;
  text: string;
  at: string;
  media?: { kind: "image" | "audio"; mimeType: string };
  deliveryFailed?: boolean;
  // Идентификатор сообщения в WhatsApp (key.id). Есть у сообщений, которые
  // мы сопоставили с событием из вебхука: так эхо и повторные доставки не
  // превращаются в дубли.
  waId?: string;
}

// Отдельная коллекция от Messages: это переписка координатора с
// ассистентом подготовки Medical Opinion Request, а не с пациентом.
interface CaseAssistantMessageDoc {
  _id: ObjectId;
  leadId: ObjectId;
  role: CaseAssistantRole;
  text: string;
  at: string;
}

// Реальные байты фото/голосовых из WhatsApp — раньше нигде не сохранялись
// (fetchMediaBase64 доставал их из Evolution API один раз для ответа
// Gemini и тут же терял). Отдельная коллекция, а не поле на самом
// MessageDoc — чтобы getMessages() не тянул бинарные данные там, где
// нужен только текст.
interface MediaAssetDoc {
  _id: ObjectId;
  leadId: ObjectId;
  messageId: ObjectId;
  kind: "image" | "audio";
  mimeType: string;
  data: Buffer;
  at: string;
}

async function leadsCollection(): Promise<Collection<LeadDoc>> {
  const db = await getDb();
  return db.collection<LeadDoc>("Leads");
}

async function messagesCollection(): Promise<Collection<MessageDoc>> {
  const db = await getDb();
  return db.collection<MessageDoc>("Messages");
}

async function caseAssistantMessagesCollection(): Promise<Collection<CaseAssistantMessageDoc>> {
  const db = await getDb();
  return db.collection<CaseAssistantMessageDoc>("CaseAssistantMessages");
}

interface TeamSettingsDoc {
  _id: string;
  members: string[];
  defaultAssignee: string | null;
}

const TEAM_DOC_ID = "team";

async function teamCollection(): Promise<Collection<TeamSettingsDoc>> {
  const db = await getDb();
  return db.collection<TeamSettingsDoc>("Settings");
}

async function mediaAssetsCollection(): Promise<Collection<MediaAssetDoc>> {
  const db = await getDb();
  return db.collection<MediaAssetDoc>("MediaAssets");
}

function toLead(doc: LeadDoc): Lead {
  return {
    id: doc._id.toString(),
    name: doc.name,
    phone: doc.phone,
    diagnosis: doc.diagnosis,
    stage: doc.stage,
    assignee: doc.assignee,
    nextTouch: doc.nextTouch,
    createdAt: doc.createdAt,
    hospital: doc.hospital,
    aiPaused: doc.aiPaused,
    anamnesis: doc.anamnesis,
    source: doc.source,
    campaign: doc.campaign,
    homeLocation: doc.homeLocation,
    declinedReason: doc.declinedReason,
    notes: doc.notes,
    estimateSentAt: doc.estimateSentAt,
    followUpStep: doc.followUpStep,
    tags: doc.tags,
    lastMessageFrom: doc.lastMessageFrom,
    lastMessageAt: doc.lastMessageAt,
    noResponse: doc.noResponse,
  };
}

function toMessage(doc: MessageDoc): ChatMessage {
  return {
    id: doc._id.toString(),
    leadId: doc.leadId.toString(),
    from: doc.from,
    text: doc.text,
    at: doc.at,
    media: doc.media,
    deliveryFailed: doc.deliveryFailed,
  };
}

function toCaseAssistantMessage(doc: CaseAssistantMessageDoc): CaseAssistantMessage {
  return {
    id: doc._id.toString(),
    leadId: doc.leadId.toString(),
    role: doc.role,
    text: doc.text,
    at: doc.at,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getLeads(filter?: {
  q?: string;
  stage?: Stage | "all";
}): Promise<Lead[]> {
  const col = await leadsCollection();
  const mongoFilter: Record<string, unknown> = {};

  if (filter?.stage && filter.stage !== "all") {
    mongoFilter.stage = filter.stage;
  }
  if (filter?.q?.trim()) {
    const re = new RegExp(escapeRegExp(filter.q.trim()), "i");
    mongoFilter.$or = [
      { name: re },
      { phone: re },
      { diagnosis: re },
      { homeLocation: re },
    ];
  }

  const docs = await col.find(mongoFilter).sort({ createdAt: -1 }).toArray();
  return docs.map(toLead);
}

/**
 * Сколько активных лидов с касанием «сегодня или раньше» — число в меню и
 * на значке приложения. Даты хранятся как ISO (UTC), поэтому сравнение строк
 * корректно. Никогда не бросает: сбой БД не должен ломать весь layout.
 */
export async function getDueTouchCount(now: Date = new Date()): Promise<number> {
  try {
    const cutoff = endOfDayInZone(now, process.env.CRM_TIMEZONE || DEFAULT_CRM_TIMEZONE);
    const col = await leadsCollection();
    return await col.countDocuments({
      stage: { $nin: ["won", "declined"] },
      noResponse: { $ne: true },
      nextTouch: { $lte: cutoff.toISOString() },
    });
  } catch (err) {
    log.error("getDueTouchCount failed", { err: String(err) });
    return 0;
  }
}

export async function getLeadsByStage(): Promise<Record<Stage, Lead[]>> {
  const leads = await getLeads();
  const grouped: Record<Stage, Lead[]> = {
    new: [],
    first_contact: [],
    consult_scheduled: [],
    consult_done: [],
    estimate_sent: [],
    awaiting_decision: [],
    won: [],
    declined: [],
  };
  for (const lead of leads) grouped[lead.stage].push(lead);
  return grouped;
}

export async function getLead(id: string): Promise<Lead | undefined> {
  if (!ObjectId.isValid(id)) return undefined;
  const col = await leadsCollection();
  const doc = await col.findOne({ _id: new ObjectId(id) });
  return doc ? toLead(doc) : undefined;
}

export async function findLeadByPhone(phone: string): Promise<Lead | undefined> {
  const col = await leadsCollection();
  const doc = await col.findOne({ phone });
  return doc ? toLead(doc) : undefined;
}

export async function createLead(input: {
  name: string;
  phone: string;
  diagnosis?: string;
  stage?: Stage;
  assignee?: string;
  source?: string;
  campaign?: string;
  homeLocation?: string;
  createdAt?: string;
  nextTouch?: string;
  notes?: string;
  anamnesis?: Lead["anamnesis"];
}): Promise<Lead> {
  const col = await leadsCollection();
  const now = new Date().toISOString();
  const doc = {
    name: input.name,
    phone: input.phone,
    diagnosis: input.diagnosis ?? "Уточняется в переписке",
    stage: input.stage ?? "new",
    assignee: input.assignee ?? (await getDefaultAssignee()) ?? UNASSIGNED,
    nextTouch: input.nextTouch ?? now,
    createdAt: input.createdAt ?? now,
    aiPaused: false,
    source: input.source,
    campaign: input.campaign,
    homeLocation: input.homeLocation,
    notes: input.notes,
    anamnesis: input.anamnesis,
  } satisfies Omit<LeadDoc, "_id">;

  const result = await col.insertOne(doc as LeadDoc);
  return toLead({ _id: result.insertedId, ...doc });
}

/** Лиды без ответственного (кроме закрытых — выигранных и отказов). */
const UNASSIGNED_ACTIVE_FILTER: Filter<LeadDoc> = {
  stage: { $nin: ["won", "declined"] },
  $or: [{ assignee: UNASSIGNED }, { assignee: "" }, { assignee: { $exists: false } }],
};

export async function getTeamSettings(): Promise<TeamSettings> {
  const col = await teamCollection();
  const doc = await col.findOne({ _id: TEAM_DOC_ID });
  return { members: doc?.members ?? [], defaultAssignee: doc?.defaultAssignee ?? null };
}

/**
 * Ответственный для нового лида. Никогда не бросает: сбой чтения настроек
 * не должен мешать заводить лидов из вебхука WhatsApp.
 */
export async function getDefaultAssignee(): Promise<string | null> {
  try {
    return (await getTeamSettings()).defaultAssignee;
  } catch (err) {
    log.error("getDefaultAssignee failed", { err: String(err) });
    return null;
  }
}

export async function updateTeamSettings(patch: TeamPatch): Promise<TeamSettings> {
  const next = applyTeamPatch(await getTeamSettings(), patch);
  const col = await teamCollection();
  await col.updateOne({ _id: TEAM_DOC_ID }, { $set: next }, { upsert: true });
  return next;
}

export async function countUnassignedLeads(): Promise<number> {
  const col = await leadsCollection();
  return col.countDocuments(UNASSIGNED_ACTIVE_FILTER);
}

/** Назначает name всем активным лидам без ответственного. Возвращает, скольким. */
export async function assignUnassignedLeads(name: string): Promise<number> {
  const col = await leadsCollection();
  const res = await col.updateMany(UNASSIGNED_ACTIVE_FILTER, { $set: { assignee: name } });
  return res.modifiedCount;
}

export async function updateLead(
  id: string,
  patch: Partial<
    Pick<
      Lead,
      | "stage"
      | "aiPaused"
      | "nextTouch"
      | "assignee"
      | "notes"
      | "declinedReason"
      | "source"
      | "campaign"
      | "homeLocation"
      | "estimateSentAt"
      | "followUpStep"
      | "anamnesis"
      | "tags"
      | "noResponse"
    >
  >
): Promise<Lead | undefined> {
  if (!ObjectId.isValid(id)) return undefined;
  const col = await leadsCollection();
  const _id = new ObjectId(id);
  const doc = await col.findOneAndUpdate(
    { _id },
    { $set: patch },
    { returnDocument: "after" }
  );
  return doc ? toLead(doc as LeadDoc) : undefined;
}

export async function getMessages(leadId: string): Promise<ChatMessage[]> {
  if (!ObjectId.isValid(leadId)) return [];
  const col = await messagesCollection();
  const docs = await col
    .find({ leadId: new ObjectId(leadId) })
    .sort({ at: 1 })
    .toArray();
  return docs.map(toMessage);
}

/**
 * Сообщения за период для статистики (lib/chat-analysis.ts): только нужные
 * поля — без медиа и служебных идентификаторов. Берём самые свежие, но не
 * больше limit; truncated говорит, что более ранние в выборку не вошли.
 */
export async function getMessagesSince(
  sinceIso: string,
  limit = 20000
): Promise<{
  messages: Array<{ leadId: string; from: MessageSender; text: string; at: string; deliveryFailed?: boolean }>;
  truncated: boolean;
}> {
  const col = await messagesCollection();
  const docs = await col
    .find(
      { at: { $gte: sinceIso } },
      { projection: { leadId: 1, from: 1, text: 1, at: 1, deliveryFailed: 1 } }
    )
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
  return {
    truncated: docs.length >= limit,
    messages: docs.reverse().map((d) => ({
      leadId: d.leadId.toString(),
      from: d.from,
      text: d.text,
      at: d.at,
      deliveryFailed: d.deliveryFailed,
    })),
  };
}

export async function addMessage(
  leadId: string,
  from: MessageSender,
  text: string,
  media?: { kind: "image" | "audio"; mimeType: string },
  options?: { waId?: string }
): Promise<ChatMessage> {
  const col = await messagesCollection();
  const at = new Date().toISOString();
  const doc = {
    leadId: new ObjectId(leadId),
    from,
    text,
    at,
    media,
    // Только если задан: драйвер пишет undefined как null, а «нет waId»
    // должно оставаться именно отсутствием поля.
    ...(options?.waId ? { waId: options.waId } : {}),
  } satisfies Omit<MessageDoc, "_id">;

  const result = await col.insertOne(doc as MessageDoc);

  // Денормализовано на сам лид — иначе канбан/таблица (десятки карточек
  // разом) делали бы отдельный запрос на лида только чтобы понять, кто
  // написал последним. На этом строится "ждёт ответа от нас/от пациента"
  // (см. lib/status.ts) — всегда актуально само по себе, без ручных пометок.
  // Best-effort: если это обновление не удастся, само сообщение уже
  // сохранено и не теряется — страдает только индикатор в списках.
  try {
    const leadsCol = await leadsCollection();
    await leadsCol.updateOne(
      { _id: new ObjectId(leadId) },
      {
        $set: {
          lastMessageFrom: from,
          lastMessageAt: at,
          // Пациент снова написал — лид «без ответа» оживает и возвращается
          // в «Касания» сам, без ручных действий.
          ...(from === "patient" ? { noResponse: false } : {}),
        },
      }
    );
  } catch (err) {
    log.error("addMessage: не удалось обновить lastMessageFrom/At на лиде", {
      leadId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return toMessage({ _id: result.insertedId, ...doc });
}

/** Есть ли уже в переписке сообщение с таким идентификатором WhatsApp. */
export async function hasMessageWithWaId(leadId: string, waId: string): Promise<boolean> {
  if (!ObjectId.isValid(leadId)) return false;
  const col = await messagesCollection();
  const doc = await col.findOne({ leadId: new ObjectId(leadId), waId }, { projection: { _id: 1 } });
  return doc !== null;
}

/**
 * Эхо исходящего сообщения из WhatsApp (fromMe). Если это то, что мы сами
 * только что отправили (CRM или ИИ сохраняют сообщение ДО отправки), —
 * закрепляем за ним waId и возвращаем true: добавлять в историю нечего.
 * Если подходящего нет — значит, координатор написал с телефона (false).
 */
export async function claimOutgoingEcho(
  leadId: string,
  text: string,
  waId: string,
  now: number = Date.now()
): Promise<boolean> {
  if (!ObjectId.isValid(leadId)) return false;
  const col = await messagesCollection();
  const since = new Date(now - ECHO_WINDOW_MS).toISOString();
  const recent = await col
    .find({
      leadId: new ObjectId(leadId),
      from: { $in: ["ai", "coordinator"] },
      at: { $gte: since },
      deliveryFailed: { $ne: true },
    })
    .sort({ at: 1 })
    .limit(50)
    .toArray();

  const match = findEchoMatch(
    recent.filter((m) => !m.waId),
    text
  );
  if (!match) return false;

  await col.updateOne({ _id: match._id }, { $set: { waId } });
  return true;
}

// Единственный документ-"пульс": обновляется БЕЗУСЛОВНО на каждый вызов
// вебхука Evolution, независимо от типа события, авторизации или того, что
// произошло дальше. Единственный способ достоверно отличить "Evolution не
// шлёт нам вебхуки вообще" (обрыв между WhatsApp и Evolution — вне
// досягаемости этого кода) от "вебхуки приходят, но что-то ломается
// внутри нашей обработки".
interface WebhookHeartbeatDoc {
  _id: string;
  lastReceivedAt: string;
  lastEventType: string;
}

export async function recordWebhookHeartbeat(eventType: string): Promise<void> {
  const db = await getDb();
  const col = db.collection<WebhookHeartbeatDoc>("WebhookHeartbeat");
  await col.updateOne(
    { _id: "singleton" },
    { $set: { lastReceivedAt: new Date().toISOString(), lastEventType: eventType || "unknown" } },
    { upsert: true }
  );
}

export async function getWebhookHeartbeat(): Promise<{
  lastReceivedAt: string | null;
  lastEventType: string | null;
}> {
  const db = await getDb();
  const col = db.collection<WebhookHeartbeatDoc>("WebhookHeartbeat");
  const doc = await col.findOne({ _id: "singleton" });
  return { lastReceivedAt: doc?.lastReceivedAt ?? null, lastEventType: doc?.lastEventType ?? null };
}

// Пометка "не доставлено" — ставится, когда сообщение уже лежит в истории,
// а отправка в WhatsApp упала (см. processBatch в вебхуке и роут
// /api/leads/[id]/messages).
export async function markMessageDeliveryFailed(messageId: string): Promise<void> {
  if (!ObjectId.isValid(messageId)) return;
  const col = await messagesCollection();
  await col.updateOne({ _id: new ObjectId(messageId) }, { $set: { deliveryFailed: true } });
}

// Для страницы настроек: когда последний раз пациент писал нам и сколько
// ответов не удалось доставить за сутки. "Connected" у шлюза WhatsApp
// говорит только о сохранённом состоянии сессии, а не о том, что сообщения
// реально идут — эти два числа показывают реальную картину.
export async function getWhatsAppActivity(): Promise<{
  lastInboundAt: string | null;
  failedDeliveries24h: number;
}> {
  const col = await messagesCollection();
  const last = await col.find({ from: "patient" }).sort({ at: -1 }).limit(1).next();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const failedDeliveries24h = await col.countDocuments({ deliveryFailed: true, at: { $gte: since } });
  return { lastInboundAt: last?.at ?? null, failedDeliveries24h };
}

// Сохраняет реальные байты (после того как сообщение уже создано через
// addMessage выше и известен его id). base64 приходит как есть из
// fetchMediaBase64 (Evolution API) — декодируем один раз здесь, чтобы в
// Mongo лежал компактный BSON Binary, а не текстовая base64-строка на
// треть больше.
export async function saveMediaAsset(params: {
  leadId: string;
  messageId: string;
  kind: "image" | "audio";
  mimeType: string;
  base64: string;
}): Promise<void> {
  const col = await mediaAssetsCollection();
  await col.insertOne({
    leadId: new ObjectId(params.leadId),
    messageId: new ObjectId(params.messageId),
    kind: params.kind,
    mimeType: params.mimeType,
    data: Buffer.from(params.base64, "base64"),
    at: new Date().toISOString(),
  } as MediaAssetDoc);
}

export async function getMediaAssetByMessageId(
  messageId: string
): Promise<{ kind: "image" | "audio"; mimeType: string; base64: string } | undefined> {
  if (!ObjectId.isValid(messageId)) return undefined;
  const col = await mediaAssetsCollection();
  const doc = await col.findOne({ messageId: new ObjectId(messageId) });
  if (!doc) return undefined;
  return { kind: doc.kind, mimeType: doc.mimeType, base64: doc.data.toString("base64") };
}

// Для Medical Opinion Request — все фото/голосовые пациента по лиду
// разом, чтобы передать их в Gemini как есть, а не только текстовым
// плейсхолдером "(+фото)".
export async function getMediaAssetsForLead(
  leadId: string
): Promise<Array<{ messageId: string; kind: "image" | "audio"; mimeType: string; base64: string }>> {
  if (!ObjectId.isValid(leadId)) return [];
  const col = await mediaAssetsCollection();
  const docs = await col.find({ leadId: new ObjectId(leadId) }).sort({ at: 1 }).toArray();
  return docs.map((doc) => ({
    messageId: doc.messageId.toString(),
    kind: doc.kind,
    mimeType: doc.mimeType,
    base64: doc.data.toString("base64"),
  }));
}

// Общий кусок для двух ручных вариантов очистки ниже — удаляет сами байты
// из MediaAssets и снимает индикатор media у сообщений, которые на них
// ссылались (иначе chat-panel продолжит пытаться отрисовать <img>/<audio>
// на 404 после удаления). Текст переписки/пометка "(+фото)" не трогается —
// удаляется только копия файла.
async function deleteMediaAssetsMatching(
  filter: Filter<MediaAssetDoc>
): Promise<{ deletedCount: number }> {
  const mediaCol = await mediaAssetsCollection();
  const messagesCol = await messagesCollection();

  const toDelete = await mediaCol.find(filter, { projection: { messageId: 1 } }).toArray();
  const messageIds = toDelete.map((doc) => doc.messageId);

  const result = await mediaCol.deleteMany(filter);

  if (messageIds.length > 0) {
    await messagesCol.updateMany({ _id: { $in: messageIds } }, { $unset: { media: "" } });
  }

  return { deletedCount: result.deletedCount };
}

export async function deleteAllMediaAssets(): Promise<{ deletedCount: number }> {
  return deleteMediaAssetsMatching({});
}

export async function deleteMediaAssetsOlderThan(days: number): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return deleteMediaAssetsMatching({ at: { $lt: cutoff } });
}

// Для страницы настроек — сколько всего занято в MongoDB и по каким
// коллекциям, чтобы было видно, что именно растёт (обычно MediaAssets).
// Цифры приблизительные (storageSize после сжатия WiredTiger) — точная
// цифра для тарифа всегда в самой Atlas, тут только ориентир.
export async function getStorageStats(): Promise<{
  totalBytes: number;
  collections: Array<{ name: string; sizeBytes: number; count: number }>;
}> {
  const db = await getDb();
  const dbStats = await db.command({ dbStats: 1 });

  const collectionNames = ["Leads", "Messages", "MediaAssets", "CaseAssistantMessages", "Documents"];
  const collections = await Promise.all(
    collectionNames.map(async (name) => {
      try {
        const stats = await db.command({ collStats: name });
        return {
          name,
          sizeBytes: stats.storageSize ?? stats.size ?? 0,
          count: stats.count ?? 0,
        };
      } catch {
        // Коллекция может ещё не существовать (например, MediaAssets на
        // свежей базе без единого фото) — collStats на неё падает с ошибкой.
        return { name, sizeBytes: 0, count: 0 };
      }
    })
  );

  return {
    totalBytes: dbStats.storageSize ?? dbStats.dataSize ?? 0,
    collections,
  };
}

export async function getCaseAssistantMessages(leadId: string): Promise<CaseAssistantMessage[]> {
  if (!ObjectId.isValid(leadId)) return [];
  const col = await caseAssistantMessagesCollection();
  const docs = await col
    .find({ leadId: new ObjectId(leadId) })
    .sort({ at: 1 })
    .toArray();
  return docs.map(toCaseAssistantMessage);
}

export async function addCaseAssistantMessage(
  leadId: string,
  role: CaseAssistantRole,
  text: string
): Promise<CaseAssistantMessage> {
  const col = await caseAssistantMessagesCollection();
  const doc = {
    leadId: new ObjectId(leadId),
    role,
    text,
    at: new Date().toISOString(),
  } satisfies Omit<CaseAssistantMessageDoc, "_id">;

  const result = await col.insertOne(doc as CaseAssistantMessageDoc);
  return toCaseAssistantMessage({ _id: result.insertedId, ...doc });
}


// ───────────────────────── Документы пациента ─────────────────────────
// Файлы (фото/PDF), которые координатор загрузил или импортировал из
// переписки, и результат их разбора Gemini (классификация, оригинал,
// перевод). Байты хранятся в самом документе, но во всех списках исключаются
// проекцией — иначе панель тянула бы мегабайты.

interface DocumentDoc {
  _id: ObjectId;
  leadId: ObjectId;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  data?: Buffer;
  source: DocumentSource;
  at: string;
  status: DocumentStatus;
  attempts: number;
  startedAt?: string;
  error?: string;
  category?: DocumentCategory;
  title?: string;
  docDate?: string;
  sourceLanguage?: string;
  patientNameOnDoc?: string;
  originalText?: string;
  translationEn?: string;
  uncertain?: string[];
  warnings?: string[];
  reviewed: boolean;
  include: boolean;
  mediaMessageId?: ObjectId;
  handwritten?: boolean;
  patientDob?: string;
  patientGender?: "Male" | "Female";
  mergedInto?: ObjectId;
  pageNo?: number;
}

// Если разбор завис дольше (например, Render перезапустил сервис посреди
// запроса) — документ снова берётся в работу.
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const NO_BYTES = { data: 0 } as const;

async function documentsCollection(): Promise<Collection<DocumentDoc>> {
  const db = await getDb();
  return db.collection<DocumentDoc>("Documents");
}

function toPatientDocument(doc: DocumentDoc): PatientDocument {
  return {
    id: doc._id.toString(),
    leadId: doc.leadId.toString(),
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    source: doc.source,
    at: doc.at,
    status: doc.status,
    attempts: doc.attempts,
    error: doc.error,
    category: doc.category,
    title: doc.title,
    docDate: doc.docDate,
    sourceLanguage: doc.sourceLanguage,
    patientNameOnDoc: doc.patientNameOnDoc,
    originalText: doc.originalText,
    translationEn: doc.translationEn,
    uncertain: doc.uncertain,
    warnings: doc.warnings,
    reviewed: doc.reviewed,
    include: doc.include,
    mediaMessageId: doc.mediaMessageId?.toString(),
    handwritten: doc.handwritten,
    patientDob: doc.patientDob,
    patientGender: doc.patientGender,
    mergedInto: doc.mergedInto?.toString(),
    pageNo: doc.pageNo,
  };
}

export async function getDocuments(leadId: string): Promise<PatientDocument[]> {
  if (!ObjectId.isValid(leadId)) return [];
  const col = await documentsCollection();
  const docs = await col
    .find({ leadId: new ObjectId(leadId) }, { projection: NO_BYTES })
    .sort({ at: 1 })
    .toArray();
  return docs.map(toPatientDocument);
}

/** Создаёт документ; тот же файл (по хэшу) у того же лида второй раз не добавляется. */
export async function createDocument(params: {
  leadId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  source: DocumentSource;
  status: "new" | "pending";
  mediaMessageId?: string;
}): Promise<{ document: PatientDocument; duplicate: boolean }> {
  const col = await documentsCollection();
  const leadObjectId = new ObjectId(params.leadId);
  const sha256 = createHash("sha256").update(params.data).digest("hex");

  const existing = await col.findOne({ leadId: leadObjectId, sha256 }, { projection: NO_BYTES });
  if (existing) return { document: toPatientDocument(existing), duplicate: true };

  const doc: DocumentDoc = {
    _id: new ObjectId(),
    leadId: leadObjectId,
    filename: params.filename.slice(0, 200),
    mimeType: params.mimeType,
    sizeBytes: params.data.length,
    sha256,
    data: params.data,
    source: params.source,
    at: new Date().toISOString(),
    status: params.status,
    attempts: 0,
    reviewed: false,
    include: false,
    ...(params.mediaMessageId && ObjectId.isValid(params.mediaMessageId)
      ? { mediaMessageId: new ObjectId(params.mediaMessageId) }
      : {}),
  };
  await col.insertOne(doc);
  const { data: _data, ...withoutBytes } = doc;
  return { document: toPatientDocument(withoutBytes as DocumentDoc), duplicate: false };
}

/** Копирует в документы фото из переписки, которых там ещё нет. */
export async function importChatPhotosAsDocuments(leadId: string): Promise<{ added: number; skipped: number }> {
  if (!ObjectId.isValid(leadId)) return { added: 0, skipped: 0 };
  const media = await mediaAssetsCollection();
  const docs = await documentsCollection();
  const leadObjectId = new ObjectId(leadId);

  const alreadyImported = new Set(
    (
      await docs
        .find({ leadId: leadObjectId, mediaMessageId: { $exists: true } }, { projection: { mediaMessageId: 1 } })
        .toArray()
    ).map((d) => d.mediaMessageId?.toString())
  );

  let added = 0;
  let skipped = 0;
  const cursor = media.find({ leadId: leadObjectId, kind: "image" }).sort({ at: 1 });
  for await (const asset of cursor) {
    const messageId = asset.messageId.toString();
    if (alreadyImported.has(messageId)) continue;
    const ext = asset.mimeType.split("/")[1]?.split(";")[0] ?? "jpg";
    const result = await createDocument({
      leadId,
      filename: `chat-photo-${messageId.slice(-6)}.${ext}`,
      mimeType: asset.mimeType.split(";")[0].trim(),
      data: Buffer.from(asset.data.buffer, asset.data.byteOffset, asset.data.length),
      source: "chat",
      status: "pending",
      mediaMessageId: messageId,
    });
    if (result.duplicate) skipped++;
    else added++;
  }
  return { added, skipped };
}

export async function getDocumentFile(
  leadId: string,
  docId: string
): Promise<{ filename: string; mimeType: string; data: Buffer } | undefined> {
  if (!ObjectId.isValid(leadId) || !ObjectId.isValid(docId)) return undefined;
  const col = await documentsCollection();
  const doc = await col.findOne({ _id: new ObjectId(docId), leadId: new ObjectId(leadId) });
  if (!doc?.data) return undefined;
  return { filename: doc.filename, mimeType: doc.mimeType, data: Buffer.from(doc.data.buffer, doc.data.byteOffset, doc.data.length) };
}

export interface DocumentPatch {
  title?: string;
  docDate?: string;
  category?: DocumentCategory;
  translationEn?: string;
  include?: boolean;
  reviewed?: boolean;
  /** «pending» — поставить в очередь (разбор или повтор после ошибки). */
  queue?: boolean;
  /** Отделить страницу от документа, с которым она была объединена. */
  unmerge?: boolean;
}

export async function updateDocument(
  leadId: string,
  docId: string,
  patch: DocumentPatch
): Promise<PatientDocument | undefined> {
  if (!ObjectId.isValid(leadId) || !ObjectId.isValid(docId)) return undefined;
  const col = await documentsCollection();
  const { queue, unmerge, ...fields } = patch;
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) set[k] = v;
  const unset: Record<string, ""> = {};
  if (unmerge) {
    unset.mergedInto = "";
    unset.pageNo = "";
  }
  if (queue) {
    set.status = "pending";
    set.attempts = 0;
    unset.error = "";
  }
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  if (Object.keys(update).length === 0) {
    const same = await col.findOne({ _id: new ObjectId(docId), leadId: new ObjectId(leadId) }, { projection: NO_BYTES });
    return same ? toPatientDocument(same) : undefined;
  }
  const doc = await col.findOneAndUpdate(
    { _id: new ObjectId(docId), leadId: new ObjectId(leadId) },
    update,
    { returnDocument: "after", projection: NO_BYTES }
  );
  return doc ? toPatientDocument(doc) : undefined;
}

export async function deleteDocument(leadId: string, docId: string): Promise<boolean> {
  if (!ObjectId.isValid(leadId) || !ObjectId.isValid(docId)) return false;
  const col = await documentsCollection();
  const res = await col.deleteOne({ _id: new ObjectId(docId), leadId: new ObjectId(leadId) });
  if (res.deletedCount > 0) {
    // Страницы удалённого документа становятся самостоятельными документами.
    await col.updateMany({ mergedInto: new ObjectId(docId) }, { $unset: { mergedInto: "", pageNo: "" } });
  }
  return res.deletedCount > 0;
}

/**
 * Склеивает документы в один: первый id — главный (название, дата, категория),
 * остальные становятся его страницами по порядку. Нельзя клеить документы,
 * у которых уже есть свои страницы или которые сами чья-то страница.
 */
export async function mergeDocuments(
  leadId: string,
  ids: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unique = Array.from(new Set(ids));
  if (unique.length < 2 || !unique.every((id) => ObjectId.isValid(id)) || !ObjectId.isValid(leadId)) {
    return { ok: false, error: "Выберите два и больше документов" };
  }
  const col = await documentsCollection();
  const leadObjectId = new ObjectId(leadId);
  const objectIds = unique.map((id) => new ObjectId(id));
  const found = await col.find({ _id: { $in: objectIds }, leadId: leadObjectId }, { projection: NO_BYTES }).toArray();
  if (found.length !== unique.length) return { ok: false, error: "Документ не найден" };

  const [primaryId, ...pageIds] = objectIds;
  const primary = found.find((d) => d._id.equals(primaryId));
  if (primary?.mergedInto) return { ok: false, error: "Главный документ сам является страницей — сначала отделите его" };
  const others = found.filter((d) => !d._id.equals(primaryId));
  if (others.some((d) => d.mergedInto)) return { ok: false, error: "Часть документов уже объединена — сначала отделите их" };
  const hasOwnPages = await col.findOne({ mergedInto: { $in: pageIds } }, { projection: { _id: 1 } });
  if (hasOwnPages) return { ok: false, error: "У одного из документов уже есть страницы — сначала отделите их" };

  const existing = await col.find({ mergedInto: primaryId }, { projection: { pageNo: 1 } }).toArray();
  let nextPage = existing.reduce((max, d) => Math.max(max, d.pageNo ?? 1), 1) + 1;
  for (const id of pageIds) {
    await col.updateOne({ _id: id }, { $set: { mergedInto: primaryId, pageNo: nextPage++ } });
  }
  return { ok: true };
}

export async function unmergeDocument(leadId: string, docId: string): Promise<void> {
  if (!ObjectId.isValid(leadId) || !ObjectId.isValid(docId)) return;
  const col = await documentsCollection();
  await col.updateOne(
    { _id: new ObjectId(docId), leadId: new ObjectId(leadId) },
    { $unset: { mergedInto: "", pageNo: "" } }
  );
}

// ───────────────────────── Профиль досье ─────────────────────────
// Имя латиницей, дата рождения и пол для титульной страницы. Хранятся отдельно
// от Leads, чтобы не трогать схему лидов; имя также подсказывается модели при
// разборе, чтобы во всех документах оно писалось одинаково.

interface DossierProfileDoc extends DossierProfile {
  _id: ObjectId; // = _id лида
}

export async function getDossierProfile(leadId: string): Promise<DossierProfile> {
  if (!ObjectId.isValid(leadId)) return {};
  const db = await getDb();
  const doc = await db.collection<DossierProfileDoc>("DossierProfiles").findOne({ _id: new ObjectId(leadId) });
  return doc ? { name: doc.name, dob: doc.dob, gender: doc.gender } : {};
}

export async function saveDossierProfile(leadId: string, profile: DossierProfile): Promise<void> {
  if (!ObjectId.isValid(leadId)) return;
  const db = await getDb();
  await db
    .collection<DossierProfileDoc>("DossierProfiles")
    .updateOne(
      { _id: new ObjectId(leadId) },
      { $set: { name: profile.name ?? "", dob: profile.dob ?? "", gender: profile.gender } },
      { upsert: true }
    );
}

/** Есть ли что разбирать (в очереди или зависшее) — чтобы запустить очередь после рестарта. */
export async function hasQueuedDocuments(): Promise<boolean> {
  const col = await documentsCollection();
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const found = await col.findOne(
    { $or: [{ status: "pending" }, { status: "processing", startedAt: { $lt: staleBefore } }] },
    { projection: { _id: 1 } }
  );
  return Boolean(found);
}

/** Забирает следующий документ в работу (по одному — экономит память и лимиты Gemini). */
export async function claimNextDocument(): Promise<
  { id: string; leadId: string; mimeType: string; data: Buffer; attempts: number } | undefined
> {
  const col = await documentsCollection();
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const doc = await col.findOneAndUpdate(
    { $or: [{ status: "pending" }, { status: "processing", startedAt: { $lt: staleBefore } }] },
    { $set: { status: "processing", startedAt: new Date().toISOString() }, $inc: { attempts: 1 } },
    { sort: { at: 1 }, returnDocument: "after" }
  );
  if (!doc?.data) {
    if (doc) await col.updateOne({ _id: doc._id }, { $set: { status: "failed", error: "Файл не найден" } });
    return undefined;
  }
  return {
    id: doc._id.toString(),
    leadId: doc.leadId.toString(),
    mimeType: doc.mimeType,
    data: Buffer.from(doc.data.buffer, doc.data.byteOffset, doc.data.length),
    attempts: doc.attempts,
  };
}

export async function completeDocument(
  docId: string,
  result: {
    category: DocumentCategory;
    title: string;
    docDate?: string;
    sourceLanguage?: string;
    patientNameOnDoc?: string;
    patientDob?: string;
    patientGender?: "Male" | "Female";
    handwritten?: boolean;
    originalText: string;
    translationEn: string;
    uncertain: string[];
    warnings: string[];
  }
): Promise<void> {
  const col = await documentsCollection();
  await col.updateOne(
    { _id: new ObjectId(docId) },
    {
      $set: {
        ...result,
        status: "done",
        // Документы-отчёты и снимки по умолчанию попадают в PDF, «прочее» и
        // почти нечитаемые листы — нет (координатор может включить вручную).
        include: result.category !== "other" && !isMostlyIllegible(result.translationEn),
        reviewed: false,
      },
      $unset: { error: "", startedAt: "" },
    }
  );
}

/** Ошибка разбора: пока есть попытки — обратно в очередь, иначе «failed». */
export async function failDocument(docId: string, error: string, attempts: number): Promise<void> {
  const col = await documentsCollection();
  const final = attempts >= MAX_DOCUMENT_ATTEMPTS;
  await col.updateOne(
    { _id: new ObjectId(docId) },
    { $set: { status: final ? "failed" : "pending", error: error.slice(0, 300) }, $unset: { startedAt: "" } }
  );
}

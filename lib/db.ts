import { ObjectId, type Collection } from "mongodb";

import { getDb } from "@/lib/mongodb";
import type { CaseAssistantMessage, CaseAssistantRole, ChatMessage, Lead, MessageSender, Stage } from "@/lib/types";

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
}

interface MessageDoc {
  _id: ObjectId;
  leadId: ObjectId;
  from: MessageSender;
  text: string;
  at: string;
  media?: { kind: "image" | "audio"; mimeType: string };
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
    assignee: input.assignee ?? "Не назначен",
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

export async function addMessage(
  leadId: string,
  from: MessageSender,
  text: string,
  media?: { kind: "image" | "audio"; mimeType: string }
): Promise<ChatMessage> {
  const col = await messagesCollection();
  const doc = {
    leadId: new ObjectId(leadId),
    from,
    text,
    at: new Date().toISOString(),
    media,
  } satisfies Omit<MessageDoc, "_id">;

  const result = await col.insertOne(doc as MessageDoc);
  return toMessage({ _id: result.insertedId, ...doc });
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

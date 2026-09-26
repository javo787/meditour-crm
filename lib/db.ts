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
  text: string
): Promise<ChatMessage> {
  const col = await messagesCollection();
  const doc = {
    leadId: new ObjectId(leadId),
    from,
    text,
    at: new Date().toISOString(),
  } satisfies Omit<MessageDoc, "_id">;

  const result = await col.insertOne(doc as MessageDoc);
  return toMessage({ _id: result.insertedId, ...doc });
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

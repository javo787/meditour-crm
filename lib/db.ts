import { seedLeads, seedMessages } from "@/lib/mock-data";
import type { ChatMessage, Lead, Stage } from "@/lib/types";

// Простое in-memory «хранилище» для демонстрации интерфейса Этапа 2.
// Данные живут в памяти процесса Node и сбрасываются при перезапуске
// сервера. На Этапе 1/3 этот модуль заменяется запросами к MongoDB Atlas
// (коллекции Leads и Messages из плана).

const leads: Lead[] = seedLeads.map((l) => ({ ...l }));
const messages: ChatMessage[] = seedMessages.map((m) => ({ ...m }));

export function getLeads(filter?: { q?: string; stage?: Stage | "all" }): Lead[] {
  let result = leads;
  if (filter?.stage && filter.stage !== "all") {
    result = result.filter((l) => l.stage === filter.stage);
  }
  if (filter?.q) {
    const q = filter.q.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.phone.toLowerCase().includes(q) ||
          l.diagnosis.toLowerCase().includes(q)
      );
    }
  }
  return [...result].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getLeadsByStage(): Record<Stage, Lead[]> {
  const grouped: Record<Stage, Lead[]> = {
    new: [],
    data_collection: [],
    waiting_india: [],
    plan_sent: [],
    declined: [],
    won: [],
  };
  for (const lead of leads) grouped[lead.stage].push(lead);
  return grouped;
}

export function getLead(id: string): Lead | undefined {
  return leads.find((l) => l.id === id);
}

export function updateLead(
  id: string,
  patch: Partial<Pick<Lead, "stage" | "aiPaused" | "nextTouch" | "assignee">>
): Lead | undefined {
  const lead = leads.find((l) => l.id === id);
  if (!lead) return undefined;
  Object.assign(lead, patch);
  return lead;
}

export function getMessages(leadId: string): ChatMessage[] {
  return messages
    .filter((m) => m.leadId === leadId)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function addMessage(
  leadId: string,
  from: ChatMessage["from"],
  text: string
): ChatMessage {
  const msg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    leadId,
    from,
    text,
    at: new Date().toISOString(),
  };
  messages.push(msg);
  return msg;
}

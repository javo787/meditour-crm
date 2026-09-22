export type Stage =
  | "new"
  | "data_collection"
  | "waiting_india"
  | "plan_sent"
  | "declined"
  | "won";

export interface Anamnesis {
  age?: number;
  proceduresDone?: string[];
  summary?: string;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  diagnosis: string;
  stage: Stage;
  assignee: string;
  nextTouch: string; // ISO date
  createdAt: string; // ISO date
  hospital?: string;
  aiPaused: boolean;
  anamnesis?: Anamnesis;
}

export type MessageSender = "patient" | "ai" | "coordinator";

export interface ChatMessage {
  id: string;
  leadId: string;
  from: MessageSender;
  text: string;
  at: string; // ISO datetime
}

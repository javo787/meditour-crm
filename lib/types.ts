// Пайплайн синхронизирован с реальной таблицей координатора
// (Meditur-Учёт_лидов.xlsx, лист «Дашборд» → «По статусу») — это его
// фактический процесс на сегодня, более подробный, чем в исходном плане.
export type Stage =
  | "new"
  | "first_contact"
  | "consult_scheduled"
  | "consult_done"
  | "estimate_sent"
  | "awaiting_decision"
  | "won"
  | "declined";

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
  // Поля из реальной таблицы координатора — отсутствовали в моке Этапа 2.
  source?: string; // Источник: WhatsApp, Instagram Direct, Комментарий к посту, ...
  campaign?: string; // Пост/реклама (тема) — привязка к контент-плану
  homeLocation?: string; // Город, страна проживания пациента
  declinedReason?: string; // Причина отказа
  notes?: string; // Свободные заметки координатора (не переписка с ИИ)
  // Для автоматической каденции follow-up после «Сметы» (см. lib/follow-up.ts)
  estimateSentAt?: string; // ISO — когда лид зашёл в estimate_sent
  followUpStep?: number; // 0 = ничего не отправлено, 1..4 = какой шаг каденции уже сделан
}

export type MessageSender = "patient" | "ai" | "coordinator";

export interface ChatMessage {
  id: string;
  leadId: string;
  from: MessageSender;
  text: string;
  at: string; // ISO datetime
  // Лёгкий индикатор: тип и mimetype есть тут, сами байты — в отдельной
  // коллекции MediaAssets (см. lib/db.ts), чтобы getMessages() оставался
  // быстрым и не тянул бинарные данные там, где нужен только текст
  // (транскрипт для Medical Opinion Request, извлечение анамнеза и т.п.).
  media?: { kind: "image" | "audio"; mimeType: string };
}

// Отдельный тред координатора с ассистентом подготовки Medical Opinion
// Request (Этап 4) — намеренно не смешан с ChatMessage/MessageSender выше,
// это внутренняя переписка с ИИ по документу, а не с пациентом в WhatsApp.
export type CaseAssistantRole = "user" | "assistant";

export interface CaseAssistantMessage {
  id: string;
  leadId: string;
  role: CaseAssistantRole;
  text: string;
  at: string; // ISO datetime
}

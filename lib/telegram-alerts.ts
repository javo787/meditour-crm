import { createLogger } from "@/lib/logger";

const log = createLogger("telegram");

// Уведомления координатору в Telegram: когда ИИ передал диалог человеку или
// лид давно без ответа. В сообщении — кнопка «Перейти в WhatsApp», которая
// открывает чат именно этого лида (https://wa.me/<номер>), и кнопка «Открыть в
// CRM». Без медицинских данных: только имя лида и причина — сообщения Telegram
// хранит на своих серверах.
//
// Настройка: TELEGRAM_BOT_TOKEN (из @BotFather) и TELEGRAM_CHAT_ID (число, можно
// несколько через запятую). Пока переменных нет, функции молча ничего не делают.

export type AlertKind = "handoff" | "escalation" | "test";

export interface AlertLead {
  id: string;
  name: string;
  phone: string;
}

export type AlertResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "not-configured" | "cooldown" }
  | { status: "failed"; error: string };

interface UrlButton {
  text: string;
  url: string;
}

const TITLES: Record<AlertKind, string> = {
  handoff: "🔔 Нужен координатор",
  escalation: "⏰ Лид давно без ответа",
  test: "✅ Проверка Telegram",
};

const REASONS: Record<AlertKind, string> = {
  handoff: "ИИ передал диалог координатору и поставлен на паузу.",
  escalation: "Нет ответа 10+ дней после сметы. ИИ на паузе, нужен координатор.",
  test: "Это проверочное сообщение. Кнопка ниже открывает WhatsApp-чат этого лида.",
};

/** Повторное уведомление по тому же лиду и причине не чаще раза в 10 минут. */
const COOLDOWN_MS = 10 * 60 * 1000;
const lastSentAt = new Map<string, number>();

/** Ссылка на чат в WhatsApp по номеру лида; без номера (например, лид из Instagram) — undefined. */
export function whatsAppChatUrl(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : undefined;
}

/**
 * Ссылка на карточку лида в CRM. Telegram принимает в кнопках только публичные
 * https-адреса, поэтому для http/localhost (разработка) кнопки не будет.
 */
export function crmLeadUrl(leadId: string, baseUrl: string | undefined = process.env.NEXTAUTH_URL): string | undefined {
  if (!leadId || !baseUrl || !/^https:\/\/[^/]+\.[^/]+/.test(baseUrl)) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}/dashboard/leads/${leadId}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Текст (HTML для Telegram) и кнопки уведомления. Ничего, кроме имени лида и причины. */
export function buildAlert(
  kind: AlertKind,
  lead: AlertLead,
  crmUrl: string | undefined = crmLeadUrl(lead.id)
): { text: string; buttons: UrlButton[][] } {
  const name = lead.name.trim() || "Без имени";
  const text = `<b>${TITLES[kind]}</b>\nЛид: <b>${escapeHtml(name)}</b>\n${REASONS[kind]}`;

  const buttons: UrlButton[][] = [];
  const whatsapp = whatsAppChatUrl(lead.phone);
  if (whatsapp) buttons.push([{ text: "💬 Перейти в WhatsApp", url: whatsapp }]);
  if (crmUrl) buttons.push([{ text: "📋 Открыть в CRM", url: crmUrl }]);
  return { text, buttons };
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()) && chatIds().length > 0;
}

function chatIds(): string[] {
  return (process.env.TELEGRAM_CHAT_ID ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function onCooldown(key: string, now: number): boolean {
  const last = lastSentAt.get(key);
  return last !== undefined && now - last < COOLDOWN_MS;
}

async function sendOne(token: string, chatId: string, alert: ReturnType<typeof buildAlert>): Promise<string | null> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: alert.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (alert.buttons.length > 0) body.reply_markup = { inline_keyboard: alert.buttons };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) return null;
    // Токен в адресе запроса — в лог и в ответ его не выводим, только описание от Telegram.
    const data = (await res.json().catch(() => null)) as { description?: string } | null;
    return data?.description ?? `HTTP ${res.status}`;
  } catch (err) {
    return err instanceof Error && err.name === "TimeoutError" ? "Telegram не ответил за 7 секунд" : "нет связи с Telegram";
  }
}

/**
 * Отправляет уведомление координатору. Никогда не бросает исключение: сбой
 * Telegram не должен ломать ответ пациенту или обработку вебхука.
 */
export async function notifyCoordinator(kind: AlertKind, lead: AlertLead): Promise<AlertResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chats = chatIds();
  if (!token || chats.length === 0) return { status: "skipped", reason: "not-configured" };

  const now = Date.now();
  const key = `${kind}:${lead.id}`;
  if (kind !== "test" && onCooldown(key, now)) return { status: "skipped", reason: "cooldown" };
  if (lastSentAt.size > 500) {
    for (const [k, t] of lastSentAt) if (now - t >= COOLDOWN_MS) lastSentAt.delete(k);
  }
  lastSentAt.set(key, now);

  const alert = buildAlert(kind, lead);
  const errors = (await Promise.all(chats.map((chatId) => sendOne(token, chatId, alert)))).filter(
    (e): e is string => e !== null
  );

  if (errors.length === chats.length) {
    lastSentAt.delete(key); // не дошло ни до кого — следующая попытка не должна ждать 10 минут
    log.error("не удалось отправить уведомление в Telegram", { kind, leadId: lead.id, error: errors[0] });
    return { status: "failed", error: errors[0] };
  }
  log.info("уведомление в Telegram отправлено", { kind, leadId: lead.id, failedChats: errors.length });
  return { status: "sent" };
}

/** Только для тестов. */
export function __resetAlertCooldowns() {
  lastSentAt.clear();
}

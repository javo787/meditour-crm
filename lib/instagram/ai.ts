// ИИ в личке Instagram: те же модель и регламент, что у WhatsApp-бота (askGemini), но ответ
// короче и без markdown, а в конце — мягкое приглашение в WhatsApp. Здесь только чистые помощники
// и сборка ответа; запись в базу и отправка — в process.ts.
import { askGemini } from "@/lib/gemini";
import type { ChatMessage } from "@/lib/types";
import { detectLanguage, type TextCtx } from "./replies";

const MAX_BUBBLE = 900; // запас до лимита Instagram в 1000 символов
const MAX_BUBBLES = 3;
const WA_MARK = /992|wa\.me/;

export type DirectReply =
  | { kind: "reply"; bubbles: string[] }
  | { kind: "handoff" }
  | { kind: "none"; reason: "empty" | "duplicate" | "arabic-script" };

// Служебная заметка модели: канал, стиль и мягкое приглашение в WhatsApp.
export function instagramChannelHint(ctx: TextCtx): string {
  return (
    "Канал: Instagram Direct (не WhatsApp). Пиши коротко: 1–3 коротких сообщения, без markdown, без звёздочек и списков. " +
    "Отвечай по существу на вопрос человека по регламенту. " +
    `Подробное обсуждение и любые документы или фото — в WhatsApp: ${ctx.whatsappNumber} (https://wa.me/${ctx.whatsappDigits}); ` +
    "приглашай туда мягко и не в каждом сообщении. " +
    "Не проси присылать документы, фото или анализы в Instagram и не предлагай звонок."
  );
}

// Убирает markdown, который модель иногда пишет вопреки просьбе: жирный, обратные кавычки, заголовки и маркеры списка.
function cleanBubble(raw: string): string {
  const plain = raw.replace(/\*\*|__/g, "").replace(/`/g, "");
  return plain
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*#+\s*/, "")
        .replace(/^\s*\*\s+/, "")
        .replace(/^\s*-\s+/, "— "),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Пузырь длиннее MAX_BUBBLE режется по последнему пробелу до лимита и получает многоточие (итог не длиннее MAX_BUBBLE).
function capBubble(s: string): string {
  if (s.length <= MAX_BUBBLE) return s;
  const head = s.slice(0, MAX_BUBBLE);
  const ws = head.search(/\s\S*$/);
  const cut = ws > 0 ? ws : MAX_BUBBLE - 1;
  return `${head.slice(0, cut).trimEnd()}…`;
}

export function sanitizeBubbles(bubbles: string[]): string[] {
  const cleaned = bubbles.map((b) => capBubble(cleanBubble(b))).filter((b) => b !== "");
  if (cleaned.length <= MAX_BUBBLES) return cleaned;
  // Лишние пузыри не теряем: дописываем к третьему через пустую строку и снова обрезаем.
  const head = cleaned.slice(0, MAX_BUBBLES - 1);
  const merged = cleaned.slice(MAX_BUBBLES - 1).join("\n\n");
  return [...head, capBubble(merged)];
}

export function whatsappLine(lang: "ru" | "en", ctx: TextCtx): string {
  const link = `${ctx.whatsappNumber} (https://wa.me/${ctx.whatsappDigits})`;
  return lang === "ru"
    ? `Подробнее и документы — в WhatsApp: ${link}`
    : `More details and documents — on WhatsApp: ${link}`;
}

// Строку с WhatsApp добавляем, если ни в новых пузырях, ни в последних (everyN - 1) ответах ИИ её не было.
export function needsWhatsAppLine(history: ChatMessage[], bubbles: string[], everyN = 3): boolean {
  if (bubbles.some((b) => WA_MARK.test(b))) return false;
  const lookback = Math.max(everyN - 1, 0);
  if (lookback === 0) return true;
  const recentAi = history.filter((m) => m.from === "ai").slice(-lookback);
  return !recentAi.some((m) => WA_MARK.test(m.text));
}

export async function composeDirectReply(p: {
  history: ChatMessage[];
  items: Array<{ text: string }>;
  ctx: TextCtx;
  now: Date;
  requestId?: string;
  ask?: typeof askGemini;
}): Promise<DirectReply> {
  const ask = p.ask ?? askGemini;
  const reply = await ask({
    history: p.history,
    items: p.items,
    requestId: p.requestId,
    now: p.now,
    channelHint: instagramChannelHint(p.ctx),
  });

  if (reply.handoff) return { kind: "handoff" };
  if (reply.suppressed) return { kind: "none", reason: reply.suppressed };

  const bubbles = sanitizeBubbles(reply.messages);
  if (bubbles.length === 0) return { kind: "none", reason: "empty" };

  if (needsWhatsAppLine(p.history, bubbles)) {
    const lang = detectLanguage(p.items[p.items.length - 1]?.text ?? "");
    bubbles[bubbles.length - 1] += `\n\n${whatsappLine(lang, p.ctx)}`;
  }
  return { kind: "reply", bubbles };
}

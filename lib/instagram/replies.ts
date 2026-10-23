// Тексты ответов бота Instagram. Без ИИ: фиксированные шаблоны, выбор варианта детерминированный.
// {n} — номер WhatsApp для людей, {d} — цифры для ссылки https://wa.me/{d}.

export type TextCtx = { whatsappNumber: string; whatsappDigits: string };
export type Language = "ru" | "en";

// Публичный ответ под комментарием: без ссылки, только номер.
const COMMENT_RU_GENERAL = [
  "Здравствуйте! 🌿 Спасибо за интерес к Meditur HBG. Подробно расскажем про лечение в Индии и стоимость в WhatsApp: {n} — будем рады помочь! 💙",
  "Добрый день! 💙 Благодарим за комментарий. Для консультации и расчёта стоимости напишите нам в WhatsApp: {n} — личный координатор ответит на все вопросы.",
  "Здравствуйте! ✨ Чтобы ответить подробно (диагноз, клиники, стоимость), приглашаем вас в WhatsApp: {n}. Мы на связи!",
];
const COMMENT_RU_PRICE =
  "Здравствуйте! 💙 Стоимость зависит от диагноза и выбранной клиники — мы рассчитаем её бесплатно после изучения ваших документов. Напишите нам в WhatsApp: {n}.";
const COMMENT_EN_GENERAL = [
  "Hello! 🌿 Thank you for your interest in Meditur HBG. We'll gladly explain the treatment options in India and the costs on WhatsApp: {n} 💙",
  "Hi! 💙 For a personal consultation and a cost estimate, please message us on WhatsApp: {n} — our coordinator will help you.",
];
const COMMENT_EN_PRICE =
  "Hello! 💙 The cost depends on the diagnosis and the hospital — we'll calculate it for free once we review your documents. Please message us on WhatsApp: {n}.";

// Личное сообщение (Direct) и приватный ответ автору комментария: номер и ссылка.
const PRIVATE_RU = [
  "Здравствуйте! 👋 Спасибо за ваш комментарий. Это Meditur HBG — международное лечение без посредников.",
  "",
  "Подробно расскажем про лечение, клиники и стоимость в WhatsApp:",
  "📱 {n}",
  "👉 https://wa.me/{d}",
  "",
  "Будем рады помочь! 💙",
].join("\n");
const PRIVATE_EN = [
  "Hello! 👋 Thank you for your comment. This is Meditur HBG — international treatment without intermediaries.",
  "",
  "We'll gladly tell you about treatment, hospitals and costs on WhatsApp:",
  "📱 {n}",
  "👉 https://wa.me/{d}",
  "",
  "We'll be happy to help! 💙",
].join("\n");
const DIRECT_RU = [
  "Здравствуйте! 👋 Это Meditur HBG — международное лечение без посредников.",
  "",
  "Чтобы быстро и подробно ответить на ваш вопрос (диагноз, клиники в Индии, стоимость, документы), напишите нам в WhatsApp:",
  "📱 {n}",
  "👉 https://wa.me/{d}",
  "",
  "Там с вами свяжется личный координатор. Будем рады помочь! 💙",
].join("\n");
const DIRECT_EN = [
  "Hello! 👋 This is Meditur HBG — international treatment without intermediaries.",
  "",
  "To answer you quickly and in detail (diagnosis, hospitals in India, costs, documents), please message us on WhatsApp:",
  "📱 {n}",
  "👉 https://wa.me/{d}",
  "",
  "A personal coordinator will take it from there. We'll be happy to help! 💙",
].join("\n");

// Ё приводится к е, чтобы «почем» без точки над ё тоже считалось вопросом о цене.
function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

const PRICE_WORDS = ["цен", "стоим", "сколько", "почем", "price", "cost", "how much", "нарх"].map(normalize);

// Язык: любая кириллица — ru; иначе не меньше трёх латинских букв — en; иначе ru.
export function detectLanguage(text: string): Language {
  if (/\p{Script=Cyrillic}/u.test(text)) return "ru";
  const latin = text.match(/\p{Script=Latin}/gu) ?? [];
  return latin.length >= 3 ? "en" : "ru";
}

export function isPriceQuestion(text: string): boolean {
  const lower = normalize(text);
  return PRICE_WORDS.some((word) => lower.includes(word));
}

// Стоит ли отвечать на комментарий: нет ссылок, не больше двух отметок @, есть хотя бы две буквы или цифры вне отметок и хештегов.
export function isWorthReplying(text: string): boolean {
  if (/http|www\./i.test(text)) return false;
  const mentions = text.match(/@[\p{L}\p{N}_.]+/gu) ?? [];
  if (mentions.length > 2) return false;
  const rest = text.replace(/@[\p{L}\p{N}_.]+/gu, " ").replace(/#[\p{L}\p{N}_]+/gu, " ");
  const meaningful = rest.match(/[\p{L}\p{N}]/gu) ?? [];
  return meaningful.length >= 2;
}

function fill(template: string, ctx: TextCtx): string {
  return template.split("{n}").join(ctx.whatsappNumber).split("{d}").join(ctx.whatsappDigits);
}

// Вариант по сумме кодов символов commentId: один и тот же комментарий всегда получает один и тот же ответ.
function pickVariant(commentId: string, count: number): number {
  let sum = 0;
  for (let i = 0; i < commentId.length; i++) sum += commentId.charCodeAt(i);
  return sum % count;
}

export function buildCommentReply(p: { text: string; commentId: string } & TextCtx): string {
  const ru = detectLanguage(p.text) === "ru";
  const price = isPriceQuestion(p.text);
  let template: string;
  if (ru) {
    template = price ? COMMENT_RU_PRICE : COMMENT_RU_GENERAL[pickVariant(p.commentId, COMMENT_RU_GENERAL.length)];
  } else {
    template = price ? COMMENT_EN_PRICE : COMMENT_EN_GENERAL[pickVariant(p.commentId, COMMENT_EN_GENERAL.length)];
  }
  return fill(template, p);
}

export function buildCommentPrivateReply(p: { text: string } & TextCtx): string {
  return fill(detectLanguage(p.text) === "ru" ? PRIVATE_RU : PRIVATE_EN, p);
}

export function buildDirectInvite(p: { text: string } & TextCtx): string {
  return fill(detectLanguage(p.text) === "ru" ? DIRECT_RU : DIRECT_EN, p);
}

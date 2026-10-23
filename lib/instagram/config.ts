// Настройки бота Instagram. Все значения читаются из окружения один раз при вызове.
// Секреты (токен, app secret) сюда попадают только как значения, нигде не логируются.

export interface InstagramConfig {
  enabled: boolean;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  graphVersion: string;
  whatsappNumber: string; // для людей, например "+992 00 550 77 77"
  whatsappDigits: string; // для ссылки wa.me, например "992005507777"
  dmCooldownMs: number;
  commentCooldownMs: number;
  replyDelay: boolean;
}

const DEFAULT_GRAPH_VERSION = "v23.0";
const DEFAULT_WHATSAPP_NUMBER = "+992005507777";
const DEFAULT_DM_COOLDOWN_HOURS = 12;
const DEFAULT_COMMENT_COOLDOWN_HOURS = 6;
const HOUR_MS = 60 * 60 * 1000;

// Номер для людей и для ссылки wa.me. Для 12-значного номера с кодом 992
// группы после кода страны: 2 + 3 + 2 + 2 цифры.
export function formatWhatsAppNumber(raw: string): { pretty: string; digits: string } {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("992")) {
    const local = digits.slice(3);
    const pretty = `+992 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`;
    return { pretty, digits };
  }
  return { pretty: `+${digits}`, digits };
}

// Часы из окружения в миллисекунды. Пустое, нечисловое, неположительное или бесконечное значение — значение по умолчанию.
function hoursToMs(raw: string | undefined, fallbackHours: number): number {
  const trimmed = (raw ?? "").trim();
  const hours = trimmed === "" ? NaN : Number(trimmed);
  return Number.isFinite(hours) && hours > 0 ? hours * HOUR_MS : fallbackHours * HOUR_MS;
}

export function getInstagramConfig(env: Record<string, string | undefined> = process.env): InstagramConfig {
  const whatsappRaw = (env.INSTAGRAM_WHATSAPP_NUMBER ?? "").trim() || DEFAULT_WHATSAPP_NUMBER;
  let whatsapp = formatWhatsAppNumber(whatsappRaw);
  // Номер без цифр не должен попадать в ссылку wa.me: берём номер по умолчанию.
  if (whatsapp.digits === "") whatsapp = formatWhatsAppNumber(DEFAULT_WHATSAPP_NUMBER);

  return {
    enabled: (env.INSTAGRAM_AUTOREPLY ?? "").trim().toLowerCase() !== "off",
    accessToken: (env.INSTAGRAM_ACCESS_TOKEN ?? "").trim(),
    appSecret: (env.INSTAGRAM_APP_SECRET ?? "").trim(),
    verifyToken: (env.INSTAGRAM_VERIFY_TOKEN ?? "").trim(),
    graphVersion: (env.INSTAGRAM_GRAPH_VERSION ?? "").trim() || DEFAULT_GRAPH_VERSION,
    whatsappNumber: whatsapp.pretty,
    whatsappDigits: whatsapp.digits,
    dmCooldownMs: hoursToMs(env.INSTAGRAM_DM_COOLDOWN_HOURS, DEFAULT_DM_COOLDOWN_HOURS),
    commentCooldownMs: hoursToMs(env.INSTAGRAM_COMMENT_COOLDOWN_HOURS, DEFAULT_COMMENT_COOLDOWN_HOURS),
    replyDelay: (env.INSTAGRAM_REPLY_DELAY ?? "").trim().toLowerCase() !== "off",
  };
}

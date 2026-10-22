import { formatWhatsAppNumber, getInstagramConfig } from "./config";

const HOUR_MS = 60 * 60 * 1000;

describe("formatWhatsAppNumber", () => {
  it("форматирует 12-значный номер с кодом 992 как +992 XX XXX XX XX", () => {
    expect(formatWhatsAppNumber("992005507777")).toEqual({ pretty: "+992 00 550 77 77", digits: "992005507777" });
  });

  it("принимает уже отформатированный номер и оставляет только цифры", () => {
    expect(formatWhatsAppNumber("+992 00 550 77 77")).toEqual({ pretty: "+992 00 550 77 77", digits: "992005507777" });
    expect(formatWhatsAppNumber("+992-00-550-77-77").digits).toBe("992005507777");
  });

  it("для остальных номеров возвращает + и неизменные цифры", () => {
    expect(formatWhatsAppNumber("+7 999 123-45-67")).toEqual({ pretty: "+79991234567", digits: "79991234567" });
  });

  it("не группирует номер с кодом 992, если длина не 12 цифр", () => {
    expect(formatWhatsAppNumber("99200550777")).toEqual({ pretty: "+99200550777", digits: "99200550777" });
  });
});

describe("getInstagramConfig", () => {
  it("без переменных окружения использует значения по умолчанию", () => {
    expect(getInstagramConfig({})).toEqual({
      enabled: true,
      accessToken: "",
      appSecret: "",
      verifyToken: "",
      graphVersion: "v23.0",
      whatsappNumber: "+992 00 550 77 77",
      whatsappDigits: "992005507777",
      dmCooldownMs: 12 * HOUR_MS,
      commentCooldownMs: 6 * HOUR_MS,
      replyDelay: true,
    });
  });

  it("читает токены и версию Graph API из окружения", () => {
    const cfg = getInstagramConfig({
      INSTAGRAM_ACCESS_TOKEN: "test-access-token",
      INSTAGRAM_APP_SECRET: "test-app-secret",
      INSTAGRAM_VERIFY_TOKEN: "test-verify-token",
      INSTAGRAM_GRAPH_VERSION: "v24.0",
    });
    expect(cfg).toMatchObject({
      accessToken: "test-access-token",
      appSecret: "test-app-secret",
      verifyToken: "test-verify-token",
      graphVersion: "v24.0",
    });
  });

  it("обрезает пробелы и переносы строк у вставленных значений", () => {
    const cfg = getInstagramConfig({ INSTAGRAM_ACCESS_TOKEN: " test-token\n", INSTAGRAM_APP_SECRET: "test-secret " });
    expect(cfg.accessToken).toBe("test-token");
    expect(cfg.appSecret).toBe("test-secret");
  });

  it("выключает ответы только при INSTAGRAM_AUTOREPLY=off без учёта регистра", () => {
    expect(getInstagramConfig({ INSTAGRAM_AUTOREPLY: "off" }).enabled).toBe(false);
    expect(getInstagramConfig({ INSTAGRAM_AUTOREPLY: "OFF" }).enabled).toBe(false);
    expect(getInstagramConfig({ INSTAGRAM_AUTOREPLY: "on" }).enabled).toBe(true);
    expect(getInstagramConfig({ INSTAGRAM_AUTOREPLY: "" }).enabled).toBe(true);
  });

  it("форматирует номер WhatsApp из окружения", () => {
    const cfg = getInstagramConfig({ INSTAGRAM_WHATSAPP_NUMBER: "+7 999 123-45-67" });
    expect(cfg.whatsappNumber).toBe("+79991234567");
    expect(cfg.whatsappDigits).toBe("79991234567");
  });

  it("пустой или пустой по цифрам номер WhatsApp заменяет номером по умолчанию", () => {
    expect(getInstagramConfig({ INSTAGRAM_WHATSAPP_NUMBER: "  " }).whatsappDigits).toBe("992005507777");
    expect(getInstagramConfig({ INSTAGRAM_WHATSAPP_NUMBER: "нет номера" }).whatsappDigits).toBe("992005507777");
  });

  it("переводит часы cooldown в миллисекунды", () => {
    const cfg = getInstagramConfig({ INSTAGRAM_DM_COOLDOWN_HOURS: "2", INSTAGRAM_COMMENT_COOLDOWN_HOURS: "0.5" });
    expect(cfg.dmCooldownMs).toBe(2 * HOUR_MS);
    expect(cfg.commentCooldownMs).toBe(HOUR_MS / 2);
  });

  it("некорректные или неположительные часы заменяются значениями по умолчанию", () => {
    for (const bad of ["abc", "0", "-3", "", "   ", "Infinity"]) {
      const cfg = getInstagramConfig({ INSTAGRAM_DM_COOLDOWN_HOURS: bad, INSTAGRAM_COMMENT_COOLDOWN_HOURS: bad });
      expect(cfg.dmCooldownMs).toBe(12 * HOUR_MS);
      expect(cfg.commentCooldownMs).toBe(6 * HOUR_MS);
    }
  });

  it("задержку человеческого ответа выключает только значение off", () => {
    expect(getInstagramConfig({ INSTAGRAM_REPLY_DELAY: "off" }).replyDelay).toBe(false);
    expect(getInstagramConfig({ INSTAGRAM_REPLY_DELAY: "Off" }).replyDelay).toBe(false);
    expect(getInstagramConfig({ INSTAGRAM_REPLY_DELAY: "on" }).replyDelay).toBe(true);
    expect(getInstagramConfig({}).replyDelay).toBe(true);
  });
});

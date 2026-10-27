jest.mock("./logger", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn().mockReturnThis() }),
  newRequestId: () => "req",
}));

import {
  __resetAlertCooldowns,
  buildAlert,
  crmLeadUrl,
  escapeHtml,
  notifyCoordinator,
  telegramConfigured,
  whatsAppChatUrl,
} from "./telegram-alerts";

const LEAD = { id: "lead1", name: "Рахимов Изатулло", phone: "992 90 123-45-67" };

describe("links", () => {
  it("builds a wa.me chat link from any phone formatting", () => {
    expect(whatsAppChatUrl("992 90 123-45-67")).toBe("https://wa.me/992901234567");
    expect(whatsAppChatUrl("+992901234567")).toBe("https://wa.me/992901234567");
  });

  it("gives no WhatsApp link when there is no usable number (e.g. an Instagram lead)", () => {
    expect(whatsAppChatUrl("")).toBeUndefined();
    expect(whatsAppChatUrl("ig_12345")).toBeUndefined(); // слишком мало цифр
    expect(whatsAppChatUrl("1234567890123456789")).toBeUndefined();
  });

  it("links to the lead card in the CRM only over a public https address", () => {
    expect(crmLeadUrl("abc", "https://meditur.onrender.com/")).toBe("https://meditur.onrender.com/dashboard/leads/abc");
    expect(crmLeadUrl("abc", "http://localhost:3000")).toBeUndefined();
    expect(crmLeadUrl("abc", undefined)).toBeUndefined();
    expect(crmLeadUrl("", "https://meditur.onrender.com")).toBeUndefined();
  });
});

describe("buildAlert", () => {
  it("has a WhatsApp button for the lead's chat and a CRM button", () => {
    const { text, buttons } = buildAlert("handoff", LEAD, "https://example.com/dashboard/leads/lead1");
    expect(text).toContain("Нужен координатор");
    expect(text).toContain("Рахимов Изатулло");
    expect(buttons).toEqual([
      [{ text: "💬 Перейти в WhatsApp", url: "https://wa.me/992901234567" }],
      [{ text: "📋 Открыть в CRM", url: "https://example.com/dashboard/leads/lead1" }],
    ]);
  });

  it("escapes the lead name and never includes the phone number or medical details in the text", () => {
    const { text } = buildAlert("escalation", { ...LEAD, name: "<b>Hacker</b> & Co" }, undefined);
    expect(text).toContain("&lt;b&gt;Hacker&lt;/b&gt; &amp; Co");
    expect(text).not.toContain("992");
    expect(escapeHtml("a<b>&")).toBe("a&lt;b&gt;&amp;");
  });

  it("leaves out the WhatsApp button when the lead has no number", () => {
    const { buttons } = buildAlert("handoff", { ...LEAD, phone: "" }, "https://example.com/dashboard/leads/lead1");
    expect(buttons).toHaveLength(1);
    expect(buttons[0][0].text).toContain("CRM");
  });
});

describe("notifyCoordinator", () => {
  const original = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    __resetAlertCooldowns();
    process.env.TELEGRAM_BOT_TOKEN = "123:SECRET-TOKEN";
    process.env.TELEGRAM_CHAT_ID = "111, 222";
    process.env.NEXTAUTH_URL = "https://meditur.onrender.com";
    fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    process.env = original;
  });

  it("does nothing until the bot is configured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(telegramConfigured()).toBe(false);
    expect(await notifyCoordinator("handoff", LEAD)).toEqual({ status: "skipped", reason: "not-configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to every chat with the inline buttons", async () => {
    expect(await notifyCoordinator("handoff", LEAD)).toEqual({ status: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:SECRET-TOKEN/sendMessage");
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe("111");
    expect(body.parse_mode).toBe("HTML");
    expect(body.reply_markup.inline_keyboard[0][0].url).toBe("https://wa.me/992901234567");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).chat_id).toBe("222");
  });

  it("does not repeat the same alert for the same lead within ten minutes, but a test always goes", async () => {
    await notifyCoordinator("handoff", LEAD);
    fetchMock.mockClear();
    expect(await notifyCoordinator("handoff", LEAD)).toEqual({ status: "skipped", reason: "cooldown" });
    expect(await notifyCoordinator("escalation", LEAD)).toEqual({ status: "sent" }); // другая причина
    expect(await notifyCoordinator("test", LEAD)).toEqual({ status: "sent" });
    expect(await notifyCoordinator("test", LEAD)).toEqual({ status: "sent" });
  });

  it("never throws and never leaks the token when Telegram rejects the message", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ description: "Bad Request: chat not found" }),
    }));
    const result = await notifyCoordinator("handoff", LEAD);
    expect(result).toEqual({ status: "failed", error: "Bad Request: chat not found" });
    expect(JSON.stringify(result)).not.toContain("SECRET-TOKEN");
    // после неудачи повтор не ждёт 10 минут
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await notifyCoordinator("handoff", LEAD)).toEqual({ status: "sent" });
  });

  it("reports a network failure instead of throwing", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.telegram.org SECRET-TOKEN");
    });
    const result = await notifyCoordinator("handoff", LEAD);
    expect(result).toEqual({ status: "failed", error: "нет связи с Telegram" });
  });

  it("succeeds if at least one of several chats receives the message", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 403, json: async () => ({ description: "Forbidden" }) }));
    expect(await notifyCoordinator("handoff", LEAD)).toEqual({ status: "sent" });
  });
});

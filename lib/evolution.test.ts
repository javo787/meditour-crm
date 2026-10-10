// Mock the logger to avoid console output during tests
jest.mock("./logger", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

describe("sendWhatsAppText", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("should throw if environment variables are missing", async () => {
    delete process.env.EVOLUTION_API_URL;

    // Dynamically import the module so that it picks up the current process.env
    const { sendWhatsAppText } = await import("./evolution");

    await expect(sendWhatsAppText("123", "test")).rejects.toThrow(
      "Evolution API не настроен — заполните EVOLUTION_API_URL, EVOLUTION_API_KEY и EVOLUTION_INSTANCE в .env.local"
    );
  });

  it("передаёт delay (время «печатает…») в теле запроса, только если задан", async () => {
    process.env.EVOLUTION_API_URL = "http://api.evolution.local";
    process.env.EVOLUTION_API_KEY = "test-api-key";
    process.env.EVOLUTION_INSTANCE = "test-instance";

    const { sendWhatsAppText } = await import("./evolution");
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    await sendWhatsAppText("79991234567", "Привет", "req-1", { typingDelayMs: 2500 });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({ number: "79991234567", text: "Привет", delay: 2500 });

    (global.fetch as jest.Mock).mockClear();
    await sendWhatsAppText("79991234567", "Привет", "req-2");
    const body2 = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body2).not.toHaveProperty("delay");
  });

  it("should successfully send text message", async () => {
    process.env.EVOLUTION_API_URL = "http://api.evolution.local";
    process.env.EVOLUTION_API_KEY = "test-api-key";
    process.env.EVOLUTION_INSTANCE = "test-instance";

    const { sendWhatsAppText } = await import("./evolution");

    // Mock fetch response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    await sendWhatsAppText("79991234567", "Hello world!", "req-123");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://api.evolution.local/message/sendText/test-instance",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: "test-api-key",
        },
        body: JSON.stringify({ number: "79991234567", text: "Hello world!" }),
      }
    );
  });

  it("should retry and eventually succeed after transient failures", async () => {
    process.env.EVOLUTION_API_URL = "http://api.evolution.local";
    process.env.EVOLUTION_API_KEY = "test-api-key";
    process.env.EVOLUTION_INSTANCE = "test-instance";

    const { sendWhatsAppText } = await import("./evolution");

    // "Connection Closed" — типичный временный обрыв WebSocket-сессии
    // Baileys внутри Evolution, из-за которого один и тот же ручной
    // ответ координатора падал три раза подряд с одной и той же ошибкой.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValueOnce('{"error":"Connection Closed"}'),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    jest.useFakeTimers();
    const result = sendWhatsAppText("79991234567", "Hello world!");
    await jest.runAllTimersAsync();
    await result;
    jest.useRealTimers();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("should throw network error if fetch fails on every attempt", async () => {
    process.env.EVOLUTION_API_URL = "http://api.evolution.local";
    process.env.EVOLUTION_API_KEY = "test-api-key";
    process.env.EVOLUTION_INSTANCE = "test-instance";

    const { sendWhatsAppText } = await import("./evolution");

    const networkError = new Error("Network offline");
    (global.fetch as jest.Mock).mockRejectedValue(networkError);

    jest.useFakeTimers();
    const assertion = expect(sendWhatsAppText("79991234567", "Hello world!")).rejects.toThrow(
      "Network offline"
    );
    await jest.runAllTimersAsync();
    await assertion;
    jest.useRealTimers();

    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("should throw if response is not ok on every attempt", async () => {
    process.env.EVOLUTION_API_URL = "http://api.evolution.local";
    process.env.EVOLUTION_API_KEY = "test-api-key";
    process.env.EVOLUTION_INSTANCE = "test-instance";

    const { sendWhatsAppText } = await import("./evolution");

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue("Bad Request: invalid number"),
    });

    jest.useFakeTimers();
    const assertion = expect(sendWhatsAppText("invalid", "text")).rejects.toThrow(
      "Evolution API sendText вернул 400: Bad Request: invalid number"
    );
    await jest.runAllTimersAsync();
    await assertion;
    jest.useRealTimers();

    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

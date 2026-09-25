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

  it("should throw network error if fetch fails", async () => {
    process.env.EVOLUTION_API_URL = "http://api.evolution.local";
    process.env.EVOLUTION_API_KEY = "test-api-key";
    process.env.EVOLUTION_INSTANCE = "test-instance";

    const { sendWhatsAppText } = await import("./evolution");

    const networkError = new Error("Network offline");
    (global.fetch as jest.Mock).mockRejectedValueOnce(networkError);

    await expect(sendWhatsAppText("79991234567", "Hello world!")).rejects.toThrow("Network offline");
  });

  it("should throw if response is not ok", async () => {
    process.env.EVOLUTION_API_URL = "http://api.evolution.local";
    process.env.EVOLUTION_API_KEY = "test-api-key";
    process.env.EVOLUTION_INSTANCE = "test-instance";

    const { sendWhatsAppText } = await import("./evolution");

    // Mock non-ok response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValueOnce("Bad Request: invalid number"),
    });

    await expect(sendWhatsAppText("invalid", "text")).rejects.toThrow(
      "Evolution API sendText вернул 400: Bad Request: invalid number"
    );
  });
});

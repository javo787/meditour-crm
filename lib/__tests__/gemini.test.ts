import { askGemini } from "../gemini";

// Mocks
jest.mock("@/lib/logger", () => ({
  createLogger: jest.fn(() => ({
    child: jest.fn().mockReturnThis(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("askGemini", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const getSuccessResponse = (text: string) => ({
    ok: true,
    json: jest.fn().mockResolvedValue({
      candidates: [
        {
          content: { parts: [{ text }] },
          finishReason: "STOP",
        },
      ],
    }),
  });

  it("throws an error if GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    // We must isolate modules because API_KEY is evaluated at module load time in gemini.ts
    const { askGemini: askGeminiLocal } = await import("../gemini");
    await expect(askGeminiLocal({ history: [], items: [] })).rejects.toThrow(
      "GEMINI_API_KEY не задан — добавьте его в .env.local"
    );
  });

  it("handles a successful response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mockFetch.mockResolvedValue(getSuccessResponse("Hello, world!"));

    const { askGemini: askGeminiLocal } = await import("../gemini");

    const result = await askGeminiLocal({
      history: [{ from: "user", text: "Hi" }],
      items: [{ text: "What's up?" }],
    });

    expect(result).toBe("Hello, world!");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next model if the first returns a 404 (or 429/500)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { askGemini: askGeminiLocal } = await import("../gemini");

    // First call fails with 404
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: jest.fn().mockResolvedValue("Not Found"),
    });
    // Second call succeeds
    mockFetch.mockResolvedValueOnce(getSuccessResponse("Fallback success"));

    const result = await askGeminiLocal({ history: [], items: [{ text: "test" }] });

    expect(result).toBe("Fallback success");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries if models are exhausted and cycle is within MAX_CYCLES", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    // We import dynamically to apply the env var
    const { askGemini: askGeminiLocal } = await import("../gemini");

    const MODELS = [
      process.env.GEMINI_MODEL || "gemini-3.8-flash",
      process.env.GEMINI_MODEL_FALLBACK_1 || "gemini-3.7-flash",
      process.env.GEMINI_MODEL_FALLBACK_2 || "gemini-3.5-flash-lite",
    ].filter(Boolean);

    for (let i = 0; i < MODELS.length; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue("Rate Limit"),
      });
    }

    mockFetch.mockResolvedValueOnce(getSuccessResponse("Recovered"));

    // We don't use fake timers as wait loops with Promise in Jest can be flaky
    // Instead we will overwrite global.setTimeout in a specific way or just let it wait.
    // The delay is 2000ms. Test timeout is 5000ms by default.
    // So 2000ms wait will finish well within 5000ms.

    const promise = askGeminiLocal({ history: [], items: [{ text: "test" }] });
    const result = await promise;
    expect(result).toBe("Recovered");
    expect(mockFetch).toHaveBeenCalledTimes(MODELS.length + 1);
  }, 10000); // give 10 seconds just in case

  it("throws an error if all cycles and models are exhausted", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { askGemini: askGeminiLocal } = await import("../gemini");

    mockFetch.mockReset();
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue("Internal Server Error"),
    }));

    // Wait will take 2000ms total.
    await expect(askGeminiLocal({ history: [], items: [{ text: "test" }] })).rejects.toThrow("Gemini API вернул 500: Internal Server Error");
  }, 10000);

  it("throws immediately on a non-retryable error (e.g., 400)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { askGemini: askGeminiLocal } = await import("../gemini");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue("Bad Request"),
    });

    await expect(askGeminiLocal({ history: [], items: [{ text: "bad request" }] })).rejects.toThrow(
      "Gemini API вернул 400: Bad Request"
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("handles empty text response by returning a fallback message", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { askGemini: askGeminiLocal } = await import("../gemini");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          {
            content: { parts: [{ text: "" }] },
            finishReason: "SAFETY",
          },
        ],
      }),
    });

    const result = await askGeminiLocal({ history: [], items: [{ text: "test" }] });
    expect(result).toBe("Извините, не получилось сформировать ответ — уточните, пожалуйста, вопрос.");
  });

  it("adds empty text message placeholder if items have no text but have image", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      const { askGemini: askGeminiLocal } = await import("../gemini");

      mockFetch.mockResolvedValueOnce(getSuccessResponse("Cool image!"));

      await askGeminiLocal({ history: [], items: [{ text: "", image: { base64: "base64", mimeType: "image/jpeg" } }] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
            body: expect.stringContaining("(сообщение пришло без текста)")
        })
      );
  });
});

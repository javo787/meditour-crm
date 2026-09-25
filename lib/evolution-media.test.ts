// Mock the logger to avoid console output during tests
jest.mock("./logger", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

describe("fetchMediaBase64", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      EVOLUTION_API_URL: "http://example.com",
      EVOLUTION_API_KEY: "test-key",
      EVOLUTION_INSTANCE: "test-instance",
    };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("should throw an error and log if fetch fails with a network error", async () => {
    const errorMsg = "Network connection lost";
    (global.fetch as jest.Mock).mockRejectedValue(new Error(errorMsg));

    const { fetchMediaBase64 } = require("./evolution");

    await expect(fetchMediaBase64("dummy-key")).rejects.toThrow(errorMsg);
  });
});

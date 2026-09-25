import { POST } from "../route";

// Mock the db and evolution libs since they are imported in the route
jest.mock("@/lib/db", () => ({
  addMessage: jest.fn(),
  createLead: jest.fn(),
  findLeadByPhone: jest.fn(),
  getLead: jest.fn(),
  getMessages: jest.fn(),
  updateLead: jest.fn(),
}));

jest.mock("@/lib/evolution", () => ({
  fetchMediaBase64: jest.fn(),
  sendWhatsAppText: jest.fn(),
}));

jest.mock("@/lib/gemini", () => ({
  askGemini: jest.fn(),
}));

// Mock logger to avoid noisy output during tests
jest.mock("@/lib/logger", () => ({
  createLogger: jest.fn(() => ({
    child: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
  })),
  newRequestId: jest.fn(() => "test-req-id"),
}));

describe("WhatsApp Webhook POST", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV }; // Make a copy
  });

  afterAll(() => {
    process.env = OLD_ENV; // Restore old env
  });

  it("should reject request with 401 when apikey does not match", async () => {
    // 1. Setup the environment with an expected API key
    process.env.EVOLUTION_API_KEY = "expected-secret-key";

    // 2. Create a mock request with an invalid apikey
    const mockPayload = {
      event: "messages.upsert",
      apikey: "invalid-key",
      data: {
        key: { remoteJid: "1234567890@s.whatsapp.net", fromMe: false },
        messageType: "conversation",
        message: { conversation: "Hello" }
      }
    };

    const req = new Request("http://localhost:3000/api/whatsapp-webhook", {
      method: "POST",
      body: JSON.stringify(mockPayload),
    });

    // 3. Call the POST handler
    const response = await POST(req);

    // 4. Assert the response is 401 and contains the expected error message
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("Неверный apikey");
  });
});

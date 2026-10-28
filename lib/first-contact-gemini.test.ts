export {};

jest.mock("./logger", () => {
  const logger: Record<string, jest.Mock> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return { createLogger: () => logger, newRequestId: () => "req" };
});

function mockGemini(texts: string[]) {
  const calls: Array<Record<string, any>> = [];
  let i = 0;
  global.fetch = jest.fn(async (url: string, init: { body: string }) => {
    if (String(url).includes("cachedContents")) return { ok: false, status: 500, text: async () => "no cache" } as unknown as Response;
    calls.push(JSON.parse(init.body));
    const text = texts[Math.min(i++, texts.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

async function loadGemini() {
  jest.resetModules();
  process.env.GEMINI_API_KEY = "test-key";
  return import("./gemini");
}

describe("summarizeLeadBrief", () => {
  it("sends the chat once with the brief prompt and returns a trimmed summary", async () => {
    const calls = mockGemini(["  Родственник пациента, интересуется операцией на колене. Получил видео.  "]);
    const { summarizeLeadBrief } = await loadGemini();

    const brief = await summarizeLeadBrief({ transcript: "Meditur: Ассалому алейкум! Видео ниже." });

    expect(brief).toBe("Родственник пациента, интересуется операцией на колене. Получил видео.");
    expect(calls).toHaveLength(1);
    expect(calls[0].contents[0].parts[0].text).toContain("Видео ниже");
    expect(calls[0].systemInstruction.parts[0].text).toContain("КРАТКУЮ сводку лида");
  });

  it("fails loudly on an empty answer so the cycle is not advanced", async () => {
    mockGemini(["   "]);
    const { summarizeLeadBrief } = await loadGemini();
    await expect(summarizeLeadBrief({ transcript: "x" })).rejects.toThrow("пустую сводку");
  });
});

describe("composeFirstContactMessage", () => {
  it("passes the saved brief and the latest messages, with the follow-up rules as the system prompt", async () => {
    const calls = mockGemini(["Ассалому алейкум! Это Meditur HBG. Чем можем помочь?"]);
    const { composeFirstContactMessage } = await loadGemini();

    const text = await composeFirstContactMessage({ brief: "Интересуется лечением суставов", transcript: "Пациент: Салом" });

    expect(text).toContain("Meditur HBG");
    const userText = calls[0].contents[0].parts[0].text as string;
    expect(userText).toContain("СВОДКА ЛИДА:\nИнтересуется лечением суставов");
    expect(userText).toContain("Пациент: Салом");
    const system = calls[0].systemInstruction.parts[0].text as string;
    expect(system).toContain("Ассалому алейкум");
    expect(system).toContain("не называй цены");
  });

  it("says so when there is no brief", async () => {
    const calls = mockGemini(["Ассалому алейкум!"]);
    const { composeFirstContactMessage } = await loadGemini();
    await composeFirstContactMessage({ transcript: "Meditur: Привет" });
    expect(calls[0].contents[0].parts[0].text).toContain("СВОДКИ НЕТ.");
  });
});

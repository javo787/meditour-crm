jest.mock("./logger", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

type FetchCall = { url: string; body: any };

// Мок Gemini: кэш промпта всегда «не создался» (шлём инструкцию инлайном),
// на generateContent отдаём ответы по очереди.
function mockGemini(replies: Array<{ ok?: boolean; status?: number; text?: string }>) {
  const calls: FetchCall[] = [];
  let i = 0;
  global.fetch = jest.fn(async (url: string, init: any) => {
    if (String(url).includes("cachedContents")) {
      return { ok: false, status: 500, text: async () => "no cache" } as any;
    }
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r.ok === false) {
      return { ok: false, status: r.status ?? 400, text: async () => "bad request" } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: r.text ?? "" }] } }],
      }),
    } as any;
  }) as any;
  return calls;
}

const json = (messages: string[], handoff = false, language = "ru") =>
  JSON.stringify({ language, messages, handoff });

async function load() {
  jest.resetModules();
  process.env.GEMINI_API_KEY = "test-key";
  return import("./gemini");
}

const items = [{ text: "Здравствуйте, вот МРТ" }];
const aiMsg = (text: string) => ({ id: "1", leadId: "l", from: "ai" as const, text, at: "2026-01-01T00:00:00Z" });

describe("askGemini (structured output)", () => {
  it("запрашивает JSON по схеме без tools и возвращает пузыри + handoff", async () => {
    const calls = mockGemini([{ text: json(["Вижу заключение, спасибо.", "Передаю врачам в Индии."], true) }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [], items });

    expect(r.messages).toEqual(["Вижу заключение, спасибо.", "Передаю врачам в Индии."]);
    expect(r.handoff).toBe(true);
    expect(r.suppressed).toBeUndefined();
    const sent = calls[0].body;
    expect(sent.generationConfig.responseMimeType).toBe("application/json");
    expect(sent.generationConfig.responseSchema.required).toEqual(["language", "messages", "handoff"]);
    expect(sent.tools).toBeUndefined();
  });

  it("если запрос со схемой отклонён — повторяет без схемы и разбирает обычный текст", async () => {
    const calls = mockGemini([{ ok: false, status: 400 }, { text: "Здравствуйте! Чем могу помочь?" }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [], items });

    expect(r.messages).toEqual(["Здравствуйте! Чем могу помочь?"]);
    expect(calls[calls.length - 1].body.generationConfig).toBeUndefined();
  });

  it("пустой ответ: один повтор с подсказкой, подсказка не попадает в историю", async () => {
    const calls = mockGemini([{ text: json([], true) }, { text: json(["Документы получил, спасибо."], false) }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [], items });

    expect(r.messages).toEqual(["Документы получил, спасибо."]);
    expect(r.handoff).toBe(true); // handoff из первой попытки не теряется
    expect(calls).toHaveLength(2);
    const lastTurn = calls[1].body.contents.at(-1);
    expect(lastTurn.role).toBe("user");
    expect(lastTurn.parts.at(-1).text).toContain("Служебная подсказка");
  });

  it("два пустых ответа подряд: отправлять нечего, запасной фразы нет", async () => {
    mockGemini([{ text: json([]) }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [], items });

    expect(r.messages).toEqual([]);
    expect(r.suppressed).toBe("empty");
  });

  it("выбрасывает только повторяющиеся пузыри, остальное отправляет", async () => {
    const said = "Спасибо, документы получил. Передам индийским врачам и напишу вам, как только будет ответ.";
    mockGemini([{ text: json([said, "Какой диагноз указан в заключении?"]) }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [aiMsg(said)], items });

    expect(r.messages).toEqual(["Какой диагноз указан в заключении?"]);
  });

  it("весь ответ — повтор: одна повторная попытка, затем подавление", async () => {
    const said = "Спасибо, документы получил. Передам индийским врачам и напишу вам, как только будет ответ.";
    const calls = mockGemini([{ text: json([said]) }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [aiMsg(said)], items });

    expect(calls).toHaveLength(2);
    expect(r.messages).toEqual([]);
    expect(r.suppressed).toBe("duplicate");
  });

  it("весь ответ — повтор, но повтор вернул новое: отправляем новое", async () => {
    const said = "Спасибо, документы получил. Передам индийским врачам и напишу вам, как только будет ответ.";
    mockGemini([{ text: json([said]) }, { text: json(["Уточните, пожалуйста, возраст пациента?"]) }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [aiMsg(said)], items });

    expect(r.messages).toEqual(["Уточните, пожалуйста, возраст пациента?"]);
    expect(r.suppressed).toBeUndefined();
  });
});

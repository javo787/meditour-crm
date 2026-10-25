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

// 13:00 и 19:00 по Душанбе (UTC+5) — внутри и вне окна 12:00–17:00.
const IN_WINDOW = new Date("2026-10-15T08:00:00Z");
const OUT_OF_WINDOW = new Date("2026-10-15T14:00:00Z");
const lastTurnTexts = (call: FetchCall): string[] =>
  call.body.contents.at(-1).parts.map((p: any) => p.text ?? "");

describe("askGemini: арабская графика", () => {
  it("ответ с арабскими буквами возвращается на переписывание, уходит чистый вариант", async () => {
    const calls = mockGemini([
      { text: json(["سلام، ممنون"], false, "tg") },
      { text: json(["Салом, ташаккур"], false, "tg") },
    ]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [], items, now: OUT_OF_WINDOW });

    expect(r.messages).toEqual(["Салом, ташаккур"]);
    expect(r.suppressed).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(lastTurnTexts(calls[1]).at(-1)).toContain("арабск");
    // подсказка — только в запросе, в историю диалога не попадает
    expect(calls[1].body.contents).toHaveLength(calls[0].body.contents.length);
  });

  it("арабская графика не ушла после повторов: пузырь не отправляется, диалог — координатору", async () => {
    const calls = mockGemini([{ text: json(["سلام"], false, "tg") }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [], items, now: OUT_OF_WINDOW });

    expect(calls).toHaveLength(3); // исходный запрос + 2 повтора
    expect(r.messages).toEqual([]);
    expect(r.suppressed).toBe("arabic-script");
  });

  it("частично арабский ответ: чистые пузыри уходят, с арабскими буквами — нет", async () => {
    mockGemini([{ text: json(["Салом", "سلام"], false, "tg") }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [], items, now: OUT_OF_WINDOW });

    expect(r.messages).toEqual(["Салом"]);
    expect(r.suppressed).toBeUndefined();
  });

  it("handoff из отклонённого ответа не теряется", async () => {
    mockGemini([
      { text: json(["سلام"], true, "tg") },
      { text: json(["Салом, ташаккур"], false, "tg") },
    ]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [], items, now: OUT_OF_WINDOW });

    expect(r.messages).toEqual(["Салом, ташаккур"]);
    expect(r.handoff).toBe(true);
  });
});

describe("askGemini: приглашение на звонок в рабочее окно", () => {
  it("в окне 12:00–17:00 подсказка дописывается к последнему сообщению пациента, а не в системный промпт", async () => {
    const inCalls = mockGemini([{ text: json(["Салом! Чӣ тавр кӯмак карда метавонам?"], false, "tg") }]);
    const { askGemini } = await load();
    await askGemini({ history: [], items, now: IN_WINDOW });

    const outCalls = mockGemini([{ text: json(["Салом! Чӣ тавр кӯмак карда метавонам?"], false, "tg") }]);
    await askGemini({ history: [], items, now: OUT_OF_WINDOW });

    const inTexts = lastTurnTexts(inCalls[0]);
    expect(inTexts[0]).toBe(items[0].text);
    expect(inTexts.at(-1)).toContain("Служебная подсказка");
    expect(inTexts.at(-1)).toContain("созвониться");

    const outTexts = lastTurnTexts(outCalls[0]);
    expect(outTexts).toEqual([items[0].text]);

    // системный промпт одинаков в обоих случаях — его кэш подсказка не ломает
    expect(inCalls[0].body.systemInstruction).toEqual(outCalls[0].body.systemInstruction);
  });

  it("подсказка про звонок и служебная подсказка повтора идут вместе, порядок сохранён", async () => {
    const said = "Спасибо, документы получил. Передам индийским врачам и напишу вам, как только будет ответ.";
    const calls = mockGemini([{ text: json([said]) }, { text: json(["Уточните, пожалуйста, возраст пациента?"]) }]);
    const { askGemini } = await load();

    const r = await askGemini({ history: [aiMsg(said)], items, now: IN_WINDOW });

    expect(r.messages).toEqual(["Уточните, пожалуйста, возраст пациента?"]);
    const retryTexts = lastTurnTexts(calls[1]);
    expect(retryTexts.some((t) => t.includes("созвониться"))).toBe(true);
    expect(retryTexts.at(-1)).toContain("Не повторяй ни одну прежнюю мысль");
  });
});

// Контекст переписки: кто что сказал и сколько прошло времени.
const NOW_CTX = new Date("2026-10-16T14:00:00Z"); // 19:00 по Душанбе — вне окна звонков
const msgAt = (from: "patient" | "ai" | "coordinator", text: string, at: string) => ({
  id: text,
  leadId: "l",
  from,
  text,
  at,
});

describe("askGemini: контекст переписки", () => {
  it("сообщение координатора — служебная пометка, а не реплика пациента", async () => {
    const calls = mockGemini([{ text: json(["Хорошо."]) }]);
    const { askGemini } = await load();
    await askGemini({
      history: [
        msgAt("patient", "Салом", "2026-10-16T10:00:00Z"),
        msgAt("coordinator", "Позвоним вам завтра в 12:00", "2026-10-16T11:00:00Z"),
        msgAt("ai", "Хорошо, жду.", "2026-10-16T11:05:00Z"),
      ],
      items,
      now: NOW_CTX,
    });

    const turns = calls[0].body.contents;
    expect(turns[0]).toEqual({ role: "user", parts: [{ text: "Салом" }] });
    expect(turns[1].role).toBe("user");
    expect(turns[1].parts[0].text).toContain("Позвоним вам завтра в 12:00");
    expect(turns[1].parts[0].text).toContain("координатор");
    expect(turns[1].parts[0].text).toContain("не реплика пациента");
    expect(turns[2]).toEqual({ role: "model", parts: [{ text: "Хорошо, жду." }] });
  });

  it("пациент вернулся через 2 недели: подсказка с числом дней дописана к его сообщению, системный промпт тот же", async () => {
    const backCalls = mockGemini([{ text: json(["Салом."]) }]);
    const { askGemini } = await load();
    await askGemini({
      history: [msgAt("ai", "Жду документы.", "2026-10-02T10:00:00Z")],
      items,
      now: NOW_CTX,
    });

    const freshCalls = mockGemini([{ text: json(["Салом."]) }]);
    await askGemini({
      history: [msgAt("ai", "Жду документы.", "2026-10-16T13:00:00Z")],
      items,
      now: NOW_CTX,
    });

    const back = lastTurnTexts(backCalls[0]);
    expect(back[0]).toBe(items[0].text);
    expect(back.at(-1)).toContain("Служебная подсказка");
    expect(back.at(-1)).toContain("14 дней");
    expect(lastTurnTexts(freshCalls[0])).toEqual([items[0].text]);
    expect(backCalls[0].body.systemInstruction).toEqual(freshCalls[0].body.systemInstruction);
  });

  it("первое сообщение в диалоге — подсказки о паузе нет", async () => {
    const calls = mockGemini([{ text: json(["Салом."]) }]);
    const { askGemini } = await load();
    await askGemini({ history: [], items, now: NOW_CTX });
    expect(lastTurnTexts(calls[0])).toEqual([items[0].text]);
  });

  it("возврат после паузы в рабочее окно: обе подсказки на месте, подсказка про паузу первой", async () => {
    const calls = mockGemini([{ text: json(["Салом."]) }]);
    const { askGemini } = await load();
    await askGemini({
      history: [msgAt("ai", "Жду документы.", "2026-10-02T10:00:00Z")],
      items,
      now: IN_WINDOW,
    });
    const texts = lastTurnTexts(calls[0]);
    expect(texts).toHaveLength(3);
    expect(texts[1]).toContain("после паузы");
    expect(texts[2]).toContain("созвониться");
  });
});

// Канальная подсказка (Instagram Direct): вместо приглашения на звонок модели
// передаётся служебная заметка о канале, и она первая среди подсказок.
describe("askGemini: канальная подсказка", () => {
  const CHANNEL = "Канал: Instagram Direct (не WhatsApp). Тестовая подсказка канала.";

  it("channelHint дописывается к последнему сообщению пациента первой из подсказок", async () => {
    const calls = mockGemini([{ text: json(["Салом."], false, "tg") }]);
    const { askGemini } = await load();

    await askGemini({
      history: [msgAt("ai", "Жду документы.", "2026-10-02T10:00:00Z")],
      items,
      now: NOW_CTX,
      channelHint: CHANNEL,
    });

    const texts = lastTurnTexts(calls[0]);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toBe(items[0].text);
    expect(texts[1]).toBe(CHANNEL);
    expect(texts[2]).toContain("после паузы");
  });

  it("в рабочее окно channelHint заменяет подсказку про звонок", async () => {
    const calls = mockGemini([{ text: json(["Салом."], false, "tg") }]);
    const { askGemini } = await load();

    await askGemini({ history: [], items, now: IN_WINDOW, channelHint: CHANNEL });

    const texts = lastTurnTexts(calls[0]);
    expect(texts).toEqual([items[0].text, CHANNEL]);
    expect(texts.some((t) => t.includes("созвониться"))).toBe(false);
  });

  it("без channelHint в рабочее окно подсказка про звонок на месте (регрессия)", async () => {
    const calls = mockGemini([{ text: json(["Салом."], false, "tg") }]);
    const { askGemini } = await load();

    await askGemini({ history: [], items, now: IN_WINDOW });

    expect(lastTurnTexts(calls[0]).some((t) => t.includes("созвониться"))).toBe(true);
  });
});


// Режим keepGenerationConfig (раздел «Планы»): ответ обязан быть JSON, поэтому запрос без generationConfig
// не отправляется никогда; схему снимает только 400, и только на той же модели.
describe("generateWithFallback: keepGenerationConfig", () => {
  const cfg = {
    temperature: 0.2,
    responseMimeType: "application/json",
    responseSchema: { type: "OBJECT", properties: {} },
    maxOutputTokens: 16000,
  };
  const contents = [{ role: "user", parts: [{ text: "x" }] }];
  const stubLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  const call = async (replies: Parameters<typeof mockGemini>[0]) => {
    const calls = mockGemini(replies);
    const { generateWithFallback } = await load();
    const result = await generateWithFallback(contents, "sys", stubLogger(), {
      generationConfig: cfg,
      keepGenerationConfig: true,
    });
    return { calls, result };
  };

  it("a rejected schema (400) is retried on the same model as JSON mode without the schema, never as free text", async () => {
    const { calls, result } = await call([{ ok: false, status: 400 }, { text: "{}" }]);
    expect(calls).toHaveLength(2);
    expect(calls[0].body.generationConfig.responseSchema).toBeDefined();
    expect(calls[1].body.generationConfig).toEqual({
      temperature: 0.2,
      responseMimeType: "application/json",
      maxOutputTokens: 16000,
    });
    expect(calls[1].body.tools).toBeUndefined();
    expect(calls[1].url).toBe(calls[0].url);
    expect(result.text).toBe("{}");
  });

  it("an overloaded model (503) moves to the next model with the schema intact", async () => {
    const { calls, result } = await call([{ ok: false, status: 503 }, { text: "{}" }]);
    expect(calls[1].body.generationConfig.responseSchema).toBeDefined();
    expect(calls[1].url).not.toBe(calls[0].url);
    expect(calls[1].url).toContain(result.model);
  });

  it("the model that answered is returned: the first one when it answers at once", async () => {
    const { calls, result } = await call([{ text: "{}" }]);
    expect(calls).toHaveLength(1);
    expect(result.model).not.toBe("");
    expect(calls[0].url).toContain(result.model);
  });

  it("a second 400 is final: it throws, and no request ever goes out without generationConfig", async () => {
    const calls = mockGemini([{ ok: false, status: 400 }]);
    const { generateWithFallback } = await load();
    await expect(
      generateWithFallback(contents, "sys", stubLogger(), { generationConfig: cfg, keepGenerationConfig: true }),
    ).rejects.toThrow("400");
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.body.generationConfig !== undefined)).toBe(true);
  });

  it("a 400 when the config has no schema to drop is final at once: one request, then the error", async () => {
    const calls = mockGemini([{ ok: false, status: 400 }]);
    const { generateWithFallback } = await load();
    const noSchema = { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 16000 };
    await expect(
      generateWithFallback(contents, "sys", stubLogger(), { generationConfig: noSchema, keepGenerationConfig: true }),
    ).rejects.toThrow("400");
    expect(calls).toHaveLength(1);
  });

  it("without the flag the old behaviour stays: a failed request is retried with no config at all", async () => {
    const calls = mockGemini([{ ok: false, status: 400 }, { text: "ok" }]);
    const { generateWithFallback } = await load();
    await generateWithFallback(contents, "sys", stubLogger(), { generationConfig: cfg });
    expect(calls[1].body.generationConfig).toBeUndefined();
  });
});

describe("historyText", () => {
  it("formats history using messageTextForModel for non-coordinator", () => {
    const { historyText } = require("./gemini");
    const m = {
      from: "patient",
      text: "🎤 [голосовое сообщение] (+голосовое)",
      transcript: { text: "hello" }
    };
    expect(historyText(m)).toContain("🎤 Голосовое сообщение (расшифровка): «hello»");
  });
});

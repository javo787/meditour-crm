export {}; // модуль, а не глобальный скрипт: иначе имена конфликтуют с lib/gemini.test.ts
jest.mock("./logger", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
  newRequestId: () => "req",
}));

const REPORT_JSON = JSON.stringify({
  category: "report",
  title: "MRI of the hip joints – report",
  docDate: "12 Mar 2026",
  sourceLanguage: "ru",
  patientNameOnDoc: "Джамолов С.",
  originalText: "Заключение: признаки АВН, 12,5 мм",
  translationEn: "Conclusion: signs of AVN, 12.5 mm",
  uncertain: [],
});

function mockGemini(replies: Array<{ ok?: boolean; status?: number; text?: string }>) {
  const calls: any[] = [];
  let i = 0;
  global.fetch = jest.fn(async (url: string, init: any) => {
    if (String(url).includes("cachedContents")) return { ok: false, status: 500, text: async () => "no cache" } as any;
    calls.push(JSON.parse(init.body));
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r.ok === false) return { ok: false, status: r.status ?? 400, text: async () => "bad" } as any;
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: r.text ?? "" }] } }] }),
    } as any;
  }) as any;
  return calls;
}

async function loadGemini() {
  jest.resetModules();
  process.env.GEMINI_API_KEY = "test-key";
  return import("./gemini");
}

describe("extractMedicalDocument", () => {
  it("sends the file once with the extraction prompt and parses the JSON", async () => {
    const calls = mockGemini([{ text: REPORT_JSON }]);
    const { extractMedicalDocument } = await loadGemini();

    const r = await extractMedicalDocument({ base64: "AAAA", mimeType: "application/pdf" });

    expect(r.category).toBe("report");
    expect(r.translationEn).toContain("12.5 mm");
    expect(calls).toHaveLength(1);
    const parts = calls[0].contents[0].parts;
    expect(parts[0].inlineData).toEqual({ mimeType: "application/pdf", data: "AAAA" });
    expect(calls[0].systemInstruction.parts[0].text).toContain("medical document reader and translator");
    expect(calls[0].generationConfig.temperature).toBe(0);
  });

  it("throws on invalid JSON so the queue can retry", async () => {
    mockGemini([{ text: "sorry, I cannot read this" }]);
    const { extractMedicalDocument } = await loadGemini();
    await expect(extractMedicalDocument({ base64: "AAAA", mimeType: "image/jpeg" })).rejects.toThrow("невалидный JSON");
  });
});

describe("extraction prompt", () => {
  it("carries the Latin patient name hint into the system prompt only when known", async () => {
    const calls = mockGemini([{ text: REPORT_JSON }, { text: REPORT_JSON }]);
    const { extractMedicalDocument } = await loadGemini();

    await extractMedicalDocument({ base64: "AAAA", mimeType: "image/jpeg", patientName: "Bobojonov Mirali" });
    await extractMedicalDocument({ base64: "AAAA", mimeType: "image/jpeg" });

    expect(calls[0].systemInstruction.parts[0].text).toContain('"Bobojonov Mirali"');
    expect(calls[1].systemInstruction.parts[0].text).not.toContain("PATIENT NAME");
    // правила про таблицы, бланки и рукописный текст на месте
    expect(calls[1].systemInstruction.parts[0].text).toContain("row by row");
    expect(calls[1].systemInstruction.parts[0].text).toContain("pre-printed text");
  });
});

describe("document queue", () => {
  const doc = (id: string, attempts = 1) => ({
    id,
    leadId: "lead1",
    mimeType: "image/jpeg",
    data: Buffer.from("x"),
    attempts,
  });

  async function loadQueue(claims: any[], extract: jest.Mock) {
    jest.resetModules();
    const completeDocument = jest.fn(async () => {});
    const failDocument = jest.fn(async () => {});
    const queue = [...claims];
    jest.doMock("@/lib/db", () => ({
      claimNextDocument: jest.fn(async () => queue.shift()),
      completeDocument,
      failDocument,
      getLead: jest.fn(async () => ({ id: "lead1", name: "Рахимов Изатулло" })),
      getDossierProfile: jest.fn(async () => ({})),
      hasQueuedDocuments: jest.fn(async () => true),
    }));
    jest.doMock("@/lib/gemini", () => ({ extractMedicalDocument: extract }));
    const mod = await import("@/lib/document-queue");
    return { ...mod, completeDocument, failDocument };
  }

  const settle = () => new Promise((r) => setTimeout(r, 30));

  it("processes documents one by one and stores warnings", async () => {
    const extract = jest.fn(async () => ({
      category: "report",
      title: "Blood test",
      originalText: "Глюкоза 5,4 холестерин 6,1",
      translationEn: "Glucose 5.4",
      uncertain: [],
      handwritten: false,
      patientNameOnDoc: "Каримова Мадина",
    }));
    const { kickDocumentQueue, completeDocument, failDocument } = await loadQueue([doc("a"), doc("b")], extract);

    kickDocumentQueue();
    await settle();

    expect(extract).toHaveBeenCalledTimes(2);
    expect(failDocument).not.toHaveBeenCalled();
    const firstCall = (completeDocument.mock.calls as any[])[0];
    expect(firstCall[0]).toBe("a");
    expect(firstCall[1].warnings).toHaveLength(2); // пропавшее число + чужое имя
  });

  it("hands a failed document back with its attempt count", async () => {
    const extract = jest.fn(async () => {
      throw new Error("Gemini API вернул 503");
    });
    const { kickDocumentQueue, completeDocument, failDocument } = await loadQueue([doc("a", 2)], extract);

    kickDocumentQueue();
    await settle();

    expect(completeDocument).not.toHaveBeenCalled();
    expect(failDocument).toHaveBeenCalledWith("a", expect.stringContaining("503"), 2);
  });
});

import JSZip from "jszip";
import { testApiHandler } from "next-test-api-route-handler";

import { getLead } from "@/lib/db";
import { getActorName } from "@/lib/plans/actor";
import { createPlan, listPlans } from "@/lib/plans/db";
import { makeDocx } from "@/lib/plans/docx-test-utils";
import { kickPlanGeneration } from "@/lib/plans/runner";
import { FICTIONAL_LETTER } from "@/lib/plans/test-fixtures";
import { GET, POST } from "../route";

jest.mock("@/lib/mongodb", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/db", () => ({ getLead: jest.fn() }));
jest.mock("@/lib/plans/actor", () => ({ getActorName: jest.fn() }));
jest.mock("@/lib/plans/runner", () => ({ kickPlanGeneration: jest.fn(), runPlanGeneration: jest.fn() }));
jest.mock("@/lib/plans/db", () => ({
  ...jest.requireActual("@/lib/plans/db"),
  createPlan: jest.fn(),
  listPlans: jest.fn(),
}));

const lead = getLead as jest.Mock;
const actor = getActorName as jest.Mock;
const create = createPlan as jest.Mock;
const list = listPlans as jest.Mock;
const kick = kickPlanGeneration as jest.Mock;

const ID = "665f1c2e9b1d4a0012ab34cd";
const LEAD_ID = "665f1c2e9b1d4a0012ab34ce";
const WHO = "Тестовый координатор";

type Reply = { status: number; body: Record<string, unknown> | null };

// Один запрос к POST /api/plans: статус и разобранное тело.
async function postPlan(init: RequestInit): Promise<Reply> {
  const out: Reply = { status: 0, body: null };
  await testApiHandler({
    appHandler: { POST },
    url: "/api/plans",
    test: async ({ fetch }) => {
      const res = await fetch(init);
      out.status = res.status;
      out.body = await res.json();
    },
  });
  return out;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const upload = (file: Blob, name: string): RequestInit => {
  const body = new FormData();
  body.append("file", file, name);
  return { method: "POST", body };
};

// .docx, в котором внутри сжатый файл на 25 МБ: сам архив меньше 1 МБ.
async function zipBomb() {
  const zip = new JSZip();
  zip.file("word/document.xml", Buffer.alloc(25 * 1024 * 1024));
  return new Uint8Array(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

beforeEach(() => {
  jest.resetAllMocks();
  actor.mockResolvedValue(WHO);
});

describe("POST /api/plans", () => {
  it("POST json creates a plan, starts generation and returns 201 { id }", async () => {
    create.mockResolvedValueOnce({ id: ID });
    const reply = await postPlan(json({ sourceText: FICTIONAL_LETTER.replace(/\n/g, "\r\n") }));
    expect(reply).toEqual({ status: 201, body: { id: ID } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: "paste", createdBy: WHO }));
    expect(create.mock.calls[0][0].sourceText).not.toContain("\r");
    expect(kick).toHaveBeenCalledWith(ID);
  });

  it("POST maps input errors to 400 and 413 codes and never creates a plan", async () => {
    const cases: { name: string; init: RequestInit; status: number; code: string }[] = [
      { name: "empty text", init: json({ sourceText: "" }), status: 400, code: "empty" },
      { name: "text over 40 000 characters", init: json({ sourceText: "a".repeat(40001) }), status: 400, code: "too-long" },
      { name: "not a zip inside .docx", init: upload(new Blob(["not a zip at all"]), "letter.docx"), status: 400, code: "bad-docx" },
      { name: "a .pdf file", init: upload(new Blob(["%PDF-1.4 test"]), "letter.pdf"), status: 400, code: "bad-docx" },
      {
        name: "a .docx over 5 MB",
        init: upload(new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)]), "letter.docx"),
        status: 413,
        code: "docx-too-big",
      },
      { name: "a zip bomb", init: upload(new Blob([await zipBomb()]), "letter.docx"), status: 400, code: "docx-unsafe" },
      { name: "a body over 6 MB", init: json({ sourceText: "a".repeat(7 * 1024 * 1024) }), status: 413, code: "too-big" },
    ];
    for (const c of cases) {
      const reply = await postPlan(c.init);
      expect({ case: c.name, status: reply.status, code: reply.body?.code }).toEqual({ case: c.name, status: c.status, code: c.code });
    }
    expect(create).not.toHaveBeenCalled();
    expect(kick).not.toHaveBeenCalled();
  });

  it("POST multipart with a real .docx stores kind 'docx', the converted text and the filename", async () => {
    create.mockResolvedValueOnce({ id: ID });
    const docx = await makeDocx({ paragraphs: ["Findings: test kidney stones letter, the patient is stable.".padEnd(40, ".")] });
    const reply = await postPlan(upload(new Blob([new Uint8Array(docx)]), "letter.docx"));
    expect(reply).toEqual({ status: 201, body: { id: ID } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: "docx", filename: "letter.docx", createdBy: WHO }),
    );
    expect(create.mock.calls[0][0].sourceText).toContain("Findings: test");
    expect(kick).toHaveBeenCalledWith(ID);
  });

  it("POST with an unknown leadId → 404 and nothing is created", async () => {
    lead.mockResolvedValueOnce(undefined);
    const reply = await postPlan(json({ sourceText: FICTIONAL_LETTER, leadId: LEAD_ID }));
    expect(reply).toEqual({ status: 404, body: { error: expect.any(String), code: "lead-not-found" } });
    expect(lead).toHaveBeenCalledWith(LEAD_ID);
    expect(create).not.toHaveBeenCalled();
    expect(kick).not.toHaveBeenCalled();
  });
});

describe("GET /api/plans", () => {
  it("GET list → { plans }", async () => {
    const item = { id: ID, patientName: "Testov Test", status: "draft", errorCount: 0, generationState: "done" };
    list.mockResolvedValueOnce([item]);
    await testApiHandler({
      appHandler: { GET },
      url: "/api/plans",
      test: async ({ fetch }) => {
        const res = await fetch();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ plans: [item] });
      },
    });
  });
});

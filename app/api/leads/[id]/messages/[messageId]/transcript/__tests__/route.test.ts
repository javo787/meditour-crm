import { testApiHandler } from "next-test-api-route-handler";
import { POST, PATCH } from "../route";
import * as db from "@/lib/db";
import * as transcription from "@/lib/transcription";

jest.mock("@/lib/db", () => ({
  getMessageById: jest.fn(),
  setCoordinatorTranscript: jest.fn(),
}));

jest.mock("@/lib/transcription", () => ({
  ensureTranscript: jest.fn(),
}));

describe("Transcript API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST", () => {
    it("returns 404 if message not found", async () => {
      (db.getMessageById as jest.Mock).mockResolvedValue(null);
      await testApiHandler({
        appHandler: { POST },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "POST" });
          expect(res.status).toBe(404);
        }
      });
    });

    it("returns 404 if leadId mismatch", async () => {
      (db.getMessageById as jest.Mock).mockResolvedValue({ leadId: "wrong", media: { kind: "audio" } });
      await testApiHandler({
        appHandler: { POST },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "POST" });
          expect(res.status).toBe(404);
        }
      });
    });

    it("returns 404 if not audio", async () => {
      (db.getMessageById as jest.Mock).mockResolvedValue({ leadId: "1", media: { kind: "image" } });
      await testApiHandler({
        appHandler: { POST },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "POST" });
          expect(res.status).toBe(404);
        }
      });
    });

    it("returns transcript on success", async () => {
      (db.getMessageById as jest.Mock).mockResolvedValue({ leadId: "1", media: { kind: "audio" } });
      const transcript = { text: "hello" };
      (transcription.ensureTranscript as jest.Mock).mockResolvedValue(transcript);

      await testApiHandler({
        appHandler: { POST },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "POST" });
          expect(res.status).toBe(200);
          const data = await res.json();
          expect(data.transcript).toEqual(transcript);
        }
      });
    });
  });

  describe("messages whose audio was removed by the storage cleanup", () => {
    const cleaned = { leadId: "1", transcript: { text: "сохранённый текст", source: "ai" } };

    it("PATCH still edits the transcript", async () => {
      (db.getMessageById as jest.Mock)
        .mockResolvedValueOnce(cleaned)
        .mockResolvedValueOnce({ ...cleaned, transcript: { text: "исправлено", source: "coordinator" } });

      await testApiHandler({
        appHandler: { PATCH },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "PATCH", body: JSON.stringify({ text: "исправлено" }) });
          expect(res.status).toBe(200);
          expect(db.setCoordinatorTranscript).toHaveBeenCalledWith("2", "исправлено");
        },
      });
    });

    it("POST returns the stored transcript", async () => {
      (db.getMessageById as jest.Mock).mockResolvedValue(cleaned);
      (transcription.ensureTranscript as jest.Mock).mockResolvedValue(cleaned.transcript);

      await testApiHandler({
        appHandler: { POST },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "POST" });
          expect(res.status).toBe(200);
          expect((await res.json()).transcript.text).toBe("сохранённый текст");
        },
      });
    });
  });

  describe("PATCH body validation", () => {
    it.each([["only spaces", "   "], ["empty", ""], ["too long", "x".repeat(8001)]])("rejects %s", async (_name, text) => {
      (db.getMessageById as jest.Mock).mockResolvedValue({ leadId: "1", media: { kind: "audio" } });

      await testApiHandler({
        appHandler: { PATCH },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "PATCH", body: JSON.stringify({ text }) });
          expect(res.status).toBe(400);
          expect(db.setCoordinatorTranscript).not.toHaveBeenCalled();
        },
      });
    });

    it("trims the text before saving", async () => {
      (db.getMessageById as jest.Mock)
        .mockResolvedValueOnce({ leadId: "1", media: { kind: "audio" } })
        .mockResolvedValueOnce({ transcript: { text: "текст" } });

      await testApiHandler({
        appHandler: { PATCH },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          await fetch({ method: "PATCH", body: JSON.stringify({ text: "  текст \n" }) });
          expect(db.setCoordinatorTranscript).toHaveBeenCalledWith("2", "текст");
        },
      });
    });
  });

  describe("PATCH", () => {
    it("returns 404 if not audio", async () => {
      (db.getMessageById as jest.Mock).mockResolvedValue({ leadId: "1", media: { kind: "image" } });
      await testApiHandler({
        appHandler: { PATCH },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "PATCH" });
          expect(res.status).toBe(404);
        }
      });
    });

    it("returns 400 on invalid body", async () => {
      (db.getMessageById as jest.Mock).mockResolvedValue({ leadId: "1", media: { kind: "audio" } });
      await testApiHandler({
        appHandler: { PATCH },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "PATCH", body: JSON.stringify({}) });
          expect(res.status).toBe(400);
        }
      });
    });

    it("updates transcript on valid body", async () => {
      (db.getMessageById as jest.Mock)
        .mockResolvedValueOnce({ leadId: "1", media: { kind: "audio" } })
        .mockResolvedValueOnce({ transcript: { text: "updated" } });

      await testApiHandler({
        appHandler: { PATCH },
        params: { id: "1", messageId: "2" },
        test: async ({ fetch }) => {
          const res = await fetch({ method: "PATCH", body: JSON.stringify({ text: "updated" }) });
          expect(res.status).toBe(200);
          const data = await res.json();
          expect(data.transcript.text).toBe("updated");
          expect(db.setCoordinatorTranscript).toHaveBeenCalledWith("2", "updated");
        }
      });
    });
  });
});

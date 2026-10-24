import { transcribeAudio, startTranscription, waitForTranscript, ensureTranscript, ensureTranscriptsForLead, resolveVoiceItems, pendingTranscripts } from "./transcription";
import * as gemini from "./gemini";
import * as db from "./db";

jest.mock("./gemini", () => ({
  generateWithFallback: jest.fn(),
}));

jest.mock("./db", () => ({
  setAiTranscript: jest.fn(),
  getMessageById: jest.fn(),
  getMediaAssetByMessageId: jest.fn(),
  getAudioMessagesWithoutTranscript: jest.fn(),
}));

describe("transcription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pendingTranscripts.clear();
  });

  describe("transcribeAudio", () => {
    it("throws if size is too large", async () => {
      // 15MB limit. Base64 is 4/3 of binary size.
      // So binary size > 15MB means we need > 15MB base64 string.
      // We will just create a large string for testing.
      const largeBase64 = Buffer.alloc(16 * 1024 * 1024).toString("base64");
      await expect(transcribeAudio({ base64: largeBase64, mimeType: "audio/ogg" }))
        .rejects.toThrow(/exceeds limit/);
    });

    it("calls generateWithFallback with correct params", async () => {
      (gemini.generateWithFallback as jest.Mock).mockResolvedValue("hello");
      const res = await transcribeAudio({ base64: "aGVsbG8=", mimeType: "audio/ogg" });
      expect(res.text).toBe("hello");
      expect(gemini.generateWithFallback).toHaveBeenCalled();
    });
  });

  describe("resolveVoiceItems", () => {
    it("replaces audio with text on success", async () => {
      const deps = {
        waitForTranscript: jest.fn().mockResolvedValue({ text: "test" }),
        timeoutMs: 100
      };
      const items = [{
        messageId: "1",
        text: "🎤 [голосовое сообщение] (+голосовое)",
        audio: { base64: "a", mimeType: "b" }
      }];

      const res = await resolveVoiceItems(items, deps);
      expect(res[0].text).toContain("🎤 Голосовое сообщение (расшифровка): «test»");
      expect(res[0].audio).toBeUndefined();
    });

    it("leaves item alone on failure/timeout", async () => {
      const deps = {
        waitForTranscript: jest.fn().mockResolvedValue(null),
        timeoutMs: 100
      };
      const items = [{
        messageId: "1",
        text: "🎤 [голосовое сообщение] (+голосовое)",
        audio: { base64: "a", mimeType: "b" }
      }];

      const res = await resolveVoiceItems(items, deps);
      expect(res[0].text).toBe("🎤 [голосовое сообщение] (+голосовое)");
      expect(res[0].audio).toBeDefined();
    });
  });

  describe("ensureTranscriptsForLead", () => {
     it("processes in batches and limits concurrency", async () => {
        (db.getAudioMessagesWithoutTranscript as jest.Mock).mockResolvedValue([
           { id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }
        ]);
        (db.getMessageById as jest.Mock).mockResolvedValue({ transcript: { text: "t" } });

        await ensureTranscriptsForLead("lead-1", { limit: 10, concurrency: 2 });
        expect(db.getMessageById).toHaveBeenCalledTimes(4);
     });
  });
});

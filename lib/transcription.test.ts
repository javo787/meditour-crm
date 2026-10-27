import {
  transcribeAudio,
  startTranscription,
  waitForTranscript,
  ensureTranscript,
  ensureTranscriptsForLead,
  resolveVoiceItems,
  pendingTranscripts,
} from "./transcription";
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

const generate = gemini.generateWithFallback as jest.Mock;
const getMessageById = db.getMessageById as jest.Mock;
const getAsset = db.getMediaAssetByMessageId as jest.Mock;

const AUDIO = { base64: "aGVsbG8=", mimeType: "audio/ogg" };
const STORED = { text: "Здравствуйте", source: "ai", model: "gemini-test", at: "2026-10-25T08:00:00.000Z" };

describe("transcription", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    pendingTranscripts.clear();
  });

  describe("transcribeAudio", () => {
    it("throws if the audio is larger than the limit", async () => {
      const largeBase64 = Buffer.alloc(16 * 1024 * 1024).toString("base64");
      await expect(transcribeAudio({ base64: largeBase64, mimeType: "audio/ogg" })).rejects.toThrow(/больше лимита/);
      expect(generate).not.toHaveBeenCalled();
    });

    it("sends the audio with a short text request and returns the model that answered", async () => {
      generate.mockResolvedValue({ text: "  Привет, мне нужна консультация  ", model: "gemini-test" });
      const res = await transcribeAudio(AUDIO);

      expect(res).toEqual({ text: "Привет, мне нужна консультация", model: "gemini-test" });
      const [contents, instruction, , options] = generate.mock.calls[0];
      expect(contents[0].parts[0]).toEqual({ text: expect.any(String) });
      expect(contents[0].parts[1]).toEqual({ inlineData: { mimeType: "audio/ogg", data: AUDIO.base64 } });
      expect(instruction).toContain("[неразборчиво]");
      expect(options.generationConfig.temperature).toBeLessThanOrEqual(0.2);
    });

    it("rejects an empty answer instead of storing an empty transcript", async () => {
      generate.mockResolvedValue({ text: "   ", model: "gemini-test" });
      await expect(transcribeAudio(AUDIO)).rejects.toThrow(/пустую/);
    });
  });

  describe("startTranscription and waitForTranscript", () => {
    it("transcribes in the background, stores the text and lets the batch wait for it", async () => {
      generate.mockResolvedValue({ text: "Здравствуйте", model: "gemini-test" });
      getMessageById.mockResolvedValue({ id: "m1", transcript: STORED });

      startTranscription("m1", AUDIO);
      expect(pendingTranscripts.has("m1")).toBe(true);

      await expect(waitForTranscript("m1", 1000)).resolves.toEqual(STORED);
      expect(db.setAiTranscript).toHaveBeenCalledWith("m1", { text: "Здравствуйте", model: "gemini-test" });
      expect(pendingTranscripts.has("m1")).toBe(false);
    });

    it("a failed transcription resolves to null, never throws, and is not stored", async () => {
      generate.mockRejectedValue(new Error("сбой модели"));

      startTranscription("m2", AUDIO);
      await expect(waitForTranscript("m2", 1000)).resolves.toBeNull();
      expect(db.setAiTranscript).not.toHaveBeenCalled();
      expect(pendingTranscripts.has("m2")).toBe(false);
    });

    it("gives up after the timeout and returns null", async () => {
      jest.useFakeTimers();
      try {
        pendingTranscripts.set("m3", new Promise(() => undefined));
        const waiting = waitForTranscript("m3", 20000);
        jest.advanceTimersByTime(20000);
        await expect(waiting).resolves.toBeNull();
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it("reads a finished transcript from the database when nothing is pending", async () => {
      getMessageById.mockResolvedValue({ id: "m4", transcript: STORED });
      await expect(waitForTranscript("m4", 1000)).resolves.toEqual(STORED);
    });
  });

  describe("ensureTranscript", () => {
    it("returns the existing transcript without any model call", async () => {
      getMessageById.mockResolvedValue({ id: "m1", transcript: STORED });
      await expect(ensureTranscript("m1")).resolves.toEqual(STORED);
      expect(generate).not.toHaveBeenCalled();
    });

    it("two concurrent requests share one paid transcription", async () => {
      getMessageById
        .mockResolvedValueOnce({ id: "m1" })
        .mockResolvedValueOnce({ id: "m1" })
        .mockResolvedValue({ id: "m1", transcript: STORED });
      getAsset.mockResolvedValue({ kind: "audio", ...AUDIO });
      generate.mockResolvedValue({ text: "Здравствуйте", model: "gemini-test" });

      const [a, b] = await Promise.all([ensureTranscript("m1"), ensureTranscript("m1")]);

      expect(a).toEqual(STORED);
      expect(b).toEqual(STORED);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("returns null when there is no audio to transcribe", async () => {
      getMessageById.mockResolvedValue({ id: "m1" });
      getAsset.mockResolvedValue(undefined);
      await expect(ensureTranscript("m1")).resolves.toBeNull();
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe("ensureTranscriptsForLead", () => {
    it("processes the missing ones in batches of the given concurrency", async () => {
      (db.getAudioMessagesWithoutTranscript as jest.Mock).mockResolvedValue([
        { id: "1" },
        { id: "2" },
        { id: "3" },
        { id: "4" },
      ]);
      getMessageById.mockResolvedValue({ transcript: STORED });

      await ensureTranscriptsForLead("lead-1", { limit: 10, concurrency: 2 });
      expect(db.getAudioMessagesWithoutTranscript).toHaveBeenCalledWith("lead-1", 10);
      expect(getMessageById).toHaveBeenCalledTimes(4);
    });

    it("does not throw when the database lookup fails", async () => {
      (db.getAudioMessagesWithoutTranscript as jest.Mock).mockRejectedValue(new Error("db down"));
      await expect(ensureTranscriptsForLead("lead-1")).resolves.toBeUndefined();
    });

    it("one broken message does not stop the others", async () => {
      (db.getAudioMessagesWithoutTranscript as jest.Mock).mockResolvedValue([{ id: "1" }, { id: "2" }]);
      getMessageById.mockRejectedValueOnce(new Error("db hiccup")).mockResolvedValue({ transcript: STORED });
      await expect(ensureTranscriptsForLead("lead-1")).resolves.toBeUndefined();
      expect(getMessageById).toHaveBeenCalledTimes(2);
    });
  });

  describe("resolveVoiceItems", () => {
    const voiceItem = (messageId: string) => ({
      messageId,
      text: "",
      audio: { base64: "a", mimeType: "audio/ogg" },
    });

    it("replaces the audio with the transcript line on success", async () => {
      const deps = { waitForTranscript: jest.fn().mockResolvedValue({ text: "test" }), timeoutMs: 100 };
      const res = await resolveVoiceItems([voiceItem("1")], deps);

      expect(res[0].text).toBe("🎤 Голосовое сообщение (расшифровка): «test»");
      expect(res[0].audio).toBeUndefined();
      expect(deps.waitForTranscript).toHaveBeenCalledWith("1", 100);
    });

    it("leaves the item alone on failure or timeout", async () => {
      const deps = { waitForTranscript: jest.fn().mockResolvedValue(null), timeoutMs: 100 };
      const res = await resolveVoiceItems([voiceItem("1")], deps);

      expect(res[0].text).toBe("");
      expect(res[0].audio).toBeDefined();
    });

    it("leaves the item alone when waiting throws", async () => {
      const deps = { waitForTranscript: jest.fn().mockRejectedValue(new Error("db down")), timeoutMs: 100 };
      const res = await resolveVoiceItems([voiceItem("1")], deps);
      expect(res[0].audio).toBeDefined();
    });

    it("does not touch text items and photos", async () => {
      const deps = { waitForTranscript: jest.fn(), timeoutMs: 100 };
      const items = [{ text: "Здравствуйте" }, { text: "", messageId: "2" }];
      const res = await resolveVoiceItems(items, deps);

      expect(res).toEqual(items);
      expect(deps.waitForTranscript).not.toHaveBeenCalled();
    });

    it("waits for several voice notes at the same time, not one after another", async () => {
      const started: string[] = [];
      const resolvers: Array<() => void> = [];
      const deps = {
        waitForTranscript: jest.fn((id: string) => {
          started.push(id);
          return new Promise<{ text: string }>((resolve) => resolvers.push(() => resolve({ text: id })));
        }),
        timeoutMs: 100,
      };

      const running = resolveVoiceItems([voiceItem("1"), voiceItem("2")], deps as never);
      await Promise.resolve();
      expect(started).toEqual(["1", "2"]);

      resolvers.forEach((resolve) => resolve());
      const res = await running;
      expect(res.map((r) => r.text)).toEqual([
        "🎤 Голосовое сообщение (расшифровка): «1»",
        "🎤 Голосовое сообщение (расшифровка): «2»",
      ]);
    });
  });
});

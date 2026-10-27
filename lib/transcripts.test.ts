import { voiceLine, messageTextForModel } from "./transcripts";
import type { ChatMessage } from "./types";

describe("transcripts", () => {
  describe("voiceLine", () => {
    it("formats voice line correctly", () => {
      expect(voiceLine("hello world")).toBe("🎤 Голосовое сообщение (расшифровка): «hello world»");
    });
  });

  describe("messageTextForModel", () => {
    it("returns original text if no transcript is present", () => {
      const m: ChatMessage = {
        id: "1",
        leadId: "2",
        from: "patient",
        text: "🎤 [голосовое сообщение] (+голосовое)",
        at: "2024-01-01T00:00:00Z"
      };
      expect(messageTextForModel(m)).toBe("🎤 [голосовое сообщение] (+голосовое)");
    });

    it("returns formatted text if transcript is present", () => {
      const m: ChatMessage = {
        id: "1",
        leadId: "2",
        from: "patient",
        text: "🎤 [голосовое сообщение] (+голосовое)",
        at: "2024-01-01T00:00:00Z",
        transcript: {
          text: "hello this is my voice",
          source: "ai",
          model: "model-1",
          at: "2024-01-01T00:01:00Z"
        }
      };
      expect(messageTextForModel(m)).toBe("🎤 Голосовое сообщение (расшифровка): «hello this is my voice»");
    });
  });
});

  describe("buildAnamnesisTranscript", () => {
    const { buildAnamnesisTranscript } = require("./transcripts");
    it("builds correct transcript", () => {
      const messages: ChatMessage[] = [
        { id: "1", leadId: "2", from: "patient", text: "hello", at: "2024-01-01" },
        { id: "2", leadId: "2", from: "ai", text: "hi", at: "2024-01-01" },
        { id: "3", leadId: "2", from: "patient", text: "audio", at: "2024-01-01", transcript: { text: "world", source: "ai", at: "2024" } }
      ];
      const res = buildAnamnesisTranscript(messages);
      expect(res).toBe("Пациент: hello\n" + "Meditour: hi\n" + "Пациент: 🎤 Голосовое сообщение (расшифровка): «world»");
    });
  });

  describe("buildConversationTranscript", () => {
    const { buildConversationTranscript } = require("./transcripts");
    it("builds correct conversation transcript", () => {
       const messages: ChatMessage[] = [
        { id: "1", leadId: "2", from: "patient", text: "hello", at: "2024-01-01" },
        { id: "2", leadId: "2", from: "coordinator", text: "hi", at: "2024-01-01" },
        { id: "3", leadId: "2", from: "patient", text: "audio", at: "2024-01-01", transcript: { text: "world", source: "ai", at: "2024" } }
      ];
      const res = buildConversationTranscript(messages);
      expect(res).toContain("Patient: hello\n" + "Meditour: hi\n" + "Patient: 🎤 Голосовое сообщение (расшифровка): «world»");
      expect(res).toContain("Voice message transcripts are machine-generated");
    });

    it("returns empty string if no messages", () => {
       expect(buildConversationTranscript([])).toBe("");
    });
  });

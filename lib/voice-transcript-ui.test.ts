import { voiceTranscriptView } from "./voice-transcript-ui";
import type { ChatMessage } from "./types";

describe("voiceTranscriptView", () => {
  const baseUi = { isExpanded: false, isEditing: false, isTranscribing: false, transcriptionFailed: false };

  it("returns none if no audio and no transcript", () => {
    const msg = { id: "1", leadId: "2", from: "patient", text: "text", at: "2024" } as ChatMessage;
    expect(voiceTranscriptView(msg, baseUi)).toBe("none");
  });

  it("returns readyToTranscribe if audio but no transcript", () => {
    const msg = { id: "1", leadId: "2", from: "patient", text: "text", at: "2024", media: { kind: "audio" } } as ChatMessage;
    expect(voiceTranscriptView(msg, baseUi)).toBe("readyToTranscribe");
  });

  it("returns collapsed if transcript exists and not expanded", () => {
    const msg = { id: "1", leadId: "2", from: "patient", text: "text", at: "2024", media: { kind: "audio" }, transcript: { text: "hi", source: "ai", at: "2024" } } as ChatMessage;
    expect(voiceTranscriptView(msg, baseUi)).toBe("collapsed");
  });

  it("returns expanded if transcript exists and expanded", () => {
    const msg = { id: "1", leadId: "2", from: "patient", text: "text", at: "2024", media: { kind: "audio" }, transcript: { text: "hi", source: "ai", at: "2024" } } as ChatMessage;
    expect(voiceTranscriptView(msg, { ...baseUi, isExpanded: true })).toBe("expanded");
  });

  it("returns editing if transcript exists and editing", () => {
    const msg = { id: "1", leadId: "2", from: "patient", text: "text", at: "2024", transcript: { text: "hi", source: "ai", at: "2024" } } as ChatMessage;
    // Missing audio but has transcript should still work for viewing/editing
    expect(voiceTranscriptView(msg, { ...baseUi, isExpanded: true, isEditing: true })).toBe("editing");
  });
});

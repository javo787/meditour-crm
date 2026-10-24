import type { ChatMessage } from "./types";

export function voiceLine(text: string): string {
  return `🎤 Голосовое сообщение (расшифровка): «${text}»`;
}

export function messageTextForModel(m: ChatMessage): string {
  if (m.transcript) {
    return voiceLine(m.transcript.text);
  }
  return m.text;
}


export function buildAnamnesisTranscript(messages: ChatMessage[]): string {
  function speakerLabel(from: "patient" | "ai" | "coordinator"): string {
    return from === "patient" ? "Пациент" : "Meditour";
  }
  return messages.map((m) => `${speakerLabel(m.from)}: ${messageTextForModel(m)}`).join("\n");
}

export function buildConversationTranscript(messages: ChatMessage[]): string {
  if (messages.length === 0) return "";
  const lines = messages.map((m) => `${m.from === "patient" ? "Patient" : "Meditour"}: ${messageTextForModel(m)}`);
  return (
    `# WHATSAPP CONVERSATION WITH THE PATIENT SO FAR\n` +
    `Extract any clinical facts already mentioned here instead of asking the coordinator to retype them. ` +
    `A "(+фото)"/"(+голосовое)" marker means a photo or voice note was sent at that point — the actual files ` +
    `are attached separately below/above as images or audio, in the same order they were sent. ` +
    `Note: voice message transcripts are machine-generated and may contain errors. Please flag medication names or doses for manual verification if mentioned.\n` +
    lines.join("\n")
  );
}

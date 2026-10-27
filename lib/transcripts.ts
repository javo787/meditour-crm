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
    `A "(+фото)" marker means a photo was sent at that point, and a "(+голосовое)" marker means a voice note without a transcript ` +
    `was sent at that point: those files are attached separately below/above as images or audio, in the same order they were sent. ` +
    `A line starting with "🎤 Голосовое сообщение (расшифровка)" is a voice note already transcribed to text (the audio is not attached). ` +
    `Voice message transcripts are machine-generated and may contain errors. Please flag medication names or doses for manual verification if mentioned.\n` +
    lines.join("\n")
  );
}

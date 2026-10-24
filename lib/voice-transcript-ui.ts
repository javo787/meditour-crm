import type { ChatMessage } from "./types";

export type TranscriptViewState =
  | "none" // No audio, no transcript
  | "readyToTranscribe" // Audio exists, no transcript, collapsed
  | "transcribing" // Audio exists, transcribing in progress
  | "transcriptionFailed" // Audio exists, transcription failed
  | "collapsed" // Transcript exists, collapsed
  | "expanded" // Transcript exists, expanded
  | "editing"; // Transcript exists, being edited by coordinator

export interface VoiceTranscriptUIState {
  isExpanded: boolean;
  isEditing: boolean;
  isTranscribing: boolean;
  transcriptionFailed: boolean;
}

export function voiceTranscriptView(message: ChatMessage, uiState: VoiceTranscriptUIState): TranscriptViewState {
  const hasAudio = message.media?.kind === "audio";
  const hasTranscript = !!message.transcript;

  if (!hasAudio && !hasTranscript) return "none";
  if (!hasTranscript) {
    if (uiState.isTranscribing) return "transcribing";
    if (uiState.transcriptionFailed) return "transcriptionFailed";
    return "readyToTranscribe";
  }

  if (uiState.isEditing) return "editing";
  if (uiState.isExpanded) return "expanded";
  return "collapsed";
}

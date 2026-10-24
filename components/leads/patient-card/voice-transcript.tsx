"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { voiceTranscriptView, type VoiceTranscriptUIState } from "@/lib/voice-transcript-ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function VoiceTranscript({ leadId, message, onUpdated }: { leadId: string; message: ChatMessage, onUpdated: (msg: ChatMessage) => void }) {
  const [uiState, setUiState] = useState<VoiceTranscriptUIState>({
    isExpanded: false,
    isEditing: false,
    isTranscribing: false,
    transcriptionFailed: false,
  });

  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const viewState = voiceTranscriptView(message, uiState);
  if (viewState === "none") return null;

  async function handleTranscribe() {
    setUiState((s) => ({ ...s, isTranscribing: true, transcriptionFailed: false }));
    try {
      const res = await fetch(`/api/leads/${leadId}/messages/${message.id}/transcript`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      onUpdated({ ...message, transcript: data.transcript });
      setUiState((s) => ({ ...s, isTranscribing: false, isExpanded: true }));
    } catch {
      setUiState((s) => ({ ...s, isTranscribing: false, transcriptionFailed: true }));
    }
  }

  async function handleSaveEdit() {
    setEditError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/messages/${message.id}/transcript`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      onUpdated({ ...message, transcript: data.transcript });
      setUiState((s) => ({ ...s, isEditing: false }));
    } catch {
      setEditError("Ошибка сохранения");
    }
  }

  function startEditing() {
    setEditText(message.transcript?.text || "");
    setUiState((s) => ({ ...s, isEditing: true }));
  }

  return (
    <div className="mt-1">
      {viewState === "readyToTranscribe" && (
        <button onClick={handleTranscribe} className="text-[11px] text-muted-foreground hover:underline">
          расшифровать
        </button>
      )}
      {viewState === "transcribing" && (
        <span className="text-[11px] text-muted-foreground">расшифровываю...</span>
      )}
      {viewState === "transcriptionFailed" && (
        <span className="text-[11px] text-destructive flex items-center gap-1">
          не удалось, <button onClick={handleTranscribe} className="hover:underline">повторить</button>
        </span>
      )}
      {viewState === "collapsed" && (
        <button
          onClick={() => setUiState((s) => ({ ...s, isExpanded: true }))}
          aria-expanded={false}
          className="text-[11px] text-muted-foreground hover:underline"
        >
          транскрипт ↓
        </button>
      )}
      {viewState === "expanded" && (
        <div>
          <button
            onClick={() => setUiState((s) => ({ ...s, isExpanded: false }))}
            aria-expanded={true}
            className="text-[11px] text-muted-foreground hover:underline mb-1"
          >
            транскрипт ↑
          </button>
          <div className="text-sm bg-muted/50 p-2 rounded max-h-[140px] overflow-y-auto whitespace-pre-wrap">
            {message.transcript?.text}
          </div>
          <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
            <span>
              {message.transcript?.source === "ai" ? "расшифровано ИИ" : "исправлено"}
            </span>
            <span>·</span>
            <button onClick={startEditing} className="hover:underline">править</button>
          </div>
        </div>
      )}
      {viewState === "editing" && (
        <div className="mt-1">
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="text-sm min-h-[80px]"
          />
          <div className="flex items-center gap-2 mt-2">
            <Button size="sm" onClick={handleSaveEdit} disabled={!editText.trim()}>Сохранить</Button>
            <Button size="sm" variant="outline" onClick={() => setUiState((s) => ({ ...s, isEditing: false }))}>Отмена</Button>
            {editError && <span className="text-xs text-destructive">{editError}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

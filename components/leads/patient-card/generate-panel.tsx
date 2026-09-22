"use client";

import { useState } from "react";
import { Check, Copy, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export function GeneratePanel({ leadId }: { leadId: string }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setCopied(false);
    try {
      const res = await fetch(`/api/leads/${leadId}/generate`, { method: "POST" });
      const data = await res.json();
      setText(data.text ?? "");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Medical Opinion Request</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button onClick={handleGenerate} disabled={loading} className="gap-2">
          <FileText className="h-4 w-4" />
          {loading ? "Формируем…" : "Сформировать запрос"}
        </Button>
        {text && (
          <>
            <Textarea value={text} readOnly rows={10} className="text-xs" />
            <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 self-start">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Скопировано" : "Скопировать"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

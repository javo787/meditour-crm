"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TagChip } from "@/components/leads/tag-chip";

export function TagsPanel({ leadId, initialTags }: { leadId: string; initialTags?: string[] }) {
  const [tags, setTags] = useState<string[]>(initialTags ?? []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string[]) {
    const previous = tags;
    setSaving(true);
    setError(null);
    setTags(next); // оптимистично — откатим, если PATCH не удастся
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
      if (!res.ok) {
        setTags(previous);
        setError("Не удалось сохранить метки");
      }
    } catch {
      setTags(previous);
      setError("Не удалось сохранить метки — проверьте соединение");
    } finally {
      setSaving(false);
    }
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const value = draft.trim();
    if (!value || tags.includes(value)) {
      setDraft("");
      return;
    }
    setDraft("");
    save([...tags, value]);
  }

  function handleRemove(tag: string) {
    save(tags.filter((t) => t !== tag));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Метки</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <TagChip key={tag} tag={tag} onRemove={() => handleRemove(tag)} />
            ))}
          </div>
        )}
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Новая метка…"
            maxLength={40}
            className="h-8 text-sm"
          />
          <Button
            type="submit"
            size="icon"
            variant="outline"
            disabled={saving || !draft.trim()}
            className="h-8 w-8 shrink-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </form>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

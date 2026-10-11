"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isUnassigned, normalizeName, UNASSIGNED } from "@/lib/team";
import { cn } from "@/lib/utils";

interface TeamState {
  members: string[];
  defaultAssignee: string | null;
  unassignedCount: number;
}

export interface AssigneeSaveOptions {
  /** Сделать этого человека ответственным по умолчанию у новых лидов. */
  makeDefault: boolean;
  /** Назначить его же всем остальным активным лидам без ответственного. */
  applyToOthers: boolean;
}

interface AssigneeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentAssignee: string;
  patientName?: string;
  onSave: (name: string, options: AssigneeSaveOptions) => Promise<void>;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function AssigneeDialog({
  open,
  onOpenChange,
  currentAssignee,
  patientName,
  onSave,
}: AssigneeDialogProps) {
  const [team, setTeam] = useState<TeamState | null>(null);
  const [selected, setSelected] = useState<string>(UNASSIGNED);
  const [extra, setExtra] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [applyOthers, setApplyOthers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentNorm = isUnassigned(currentAssignee) ? UNASSIGNED : normalizeName(currentAssignee);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSelected(currentNorm);
    setExtra([]);
    setNewName("");
    setMakeDefault(true);
    setApplyOthers(true);
    setError(null);
    setSaving(false);
    setTeam(null);
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("team"))))
      .then((data: TeamState) => !cancelled && setTeam(data))
      // Без списка команды диалог всё равно работает: можно выбрать из текущих
      // и ввести имя вручную — просто без быстрых вариантов и «по умолчанию».
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, currentNorm]);

  const people = useMemo(() => {
    const list = [...(team?.members ?? [])];
    for (const raw of [currentAssignee, ...extra]) {
      const name = normalizeName(raw);
      if (!isUnassigned(name) && !list.some((m) => sameName(m, name))) list.push(name);
    }
    return list;
  }, [team, currentAssignee, extra]);

  function addPerson() {
    const name = normalizeName(newName);
    if (!name || isUnassigned(name)) return;
    const existing = people.find((p) => sameName(p, name));
    if (existing) {
      setSelected(existing);
    } else {
      setExtra((prev) => [...prev, name]);
      setSelected(name);
    }
    setNewName("");
  }

  const hasPerson = !isUnassigned(selected);
  const changed = selected !== currentNorm;
  const showDefault =
    hasPerson && team !== null && !(team.defaultAssignee && sameName(team.defaultAssignee, selected));
  const othersUnassigned = team
    ? Math.max(0, team.unassignedCount - (isUnassigned(currentAssignee) ? 1 : 0))
    : 0;
  const showApply = hasPerson && othersUnassigned > 0;
  const canSave = !saving && (changed || (showDefault && makeDefault) || (showApply && applyOthers));

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(selected, {
        makeDefault: showDefault && makeDefault,
        applyToOthers: showApply && applyOthers,
      });
      onOpenChange(false);
    } catch {
      setError("Не удалось сохранить. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-primary" />
            Ответственный
          </DialogTitle>
          <DialogDescription>
            {patientName ? `Кто ведёт пациента: ${patientName}` : "Кто ведёт этого пациента"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 pb-5">
          <div role="radiogroup" aria-label="Ответственный" className="flex flex-col gap-1">
            {[UNASSIGNED, ...people].map((name) => {
              const active = name === selected;
              const isDefault =
                name !== UNASSIGNED && team?.defaultAssignee && sameName(team.defaultAssignee, name);
              return (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(name)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-primary bg-primary/10 font-medium"
                      : "border-transparent hover:bg-secondary",
                    name === UNASSIGNED && !active && "text-muted-foreground"
                  )}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {active && <Check className="h-4 w-4 text-primary" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {isDefault && (
                    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      по умолчанию
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPerson();
                }
              }}
              placeholder="Другой человек — введите имя"
              maxLength={60}
              aria-label="Имя нового ответственного"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={addPerson}
              disabled={!normalizeName(newName)}
              aria-label="Добавить человека"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {(showDefault || showApply) && (
            <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/40 p-3">
              {showDefault && (
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={makeDefault}
                    onChange={(e) => setMakeDefault(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                  />
                  <span>
                    Назначать <b className="font-medium">{selected}</b> новым лидам по умолчанию
                    {team?.defaultAssignee && (
                      <span className="block text-xs text-muted-foreground">
                        Сейчас по умолчанию: {team.defaultAssignee}
                      </span>
                    )}
                  </span>
                </label>
              )}
              {showApply && (
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={applyOthers}
                    onChange={(e) => setApplyOthers(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                  />
                  <span>
                    Назначить и остальным лидам без ответственного
                    <span className="block text-xs text-muted-foreground">
                      Сейчас таких: {othersUnassigned}. Тем, у кого уже есть ответственный, ничего
                      не изменится.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Сохраняю…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

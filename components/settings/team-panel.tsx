"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Users } from "lucide-react";

import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normalizeName, UNASSIGNED } from "@/lib/team";

interface TeamState {
  members: string[];
  defaultAssignee: string | null;
  unassignedCount: number;
  assigned?: number;
}

type TeamPatch = {
  addMember?: string;
  removeMember?: string;
  defaultAssignee?: string | null;
  assignUnassignedTo?: string;
};

// У Radix Select значение не может быть пустой строкой.
const NONE = "__none__";

export function TeamPanel() {
  const [team, setTeam] = useState<TeamState | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team");
      if (!res.ok) throw new Error("load");
      setTeam(await res.json());
    } catch {
      setError("Не удалось загрузить команду.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(body: TeamPatch): Promise<TeamState | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("patch");
      const data: TeamState = await res.json();
      setTeam(data);
      return data;
    } catch {
      setError("Не удалось сохранить. Попробуйте ещё раз.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    const name = normalizeName(newName);
    if (!name) return;
    const data = await patch({ addMember: name });
    if (data) setNewName("");
  }

  async function handleRemove(name: string) {
    if (
      !window.confirm(
        `Убрать «${name}» из списка? У лидов, где он назначен, имя останется — его можно будет сменить в карточке.`
      )
    ) {
      return;
    }
    await patch({ removeMember: name });
  }

  async function handleAssignAll() {
    if (!team?.defaultAssignee) return;
    const name = team.defaultAssignee;
    if (
      !window.confirm(
        `Назначить «${name}» всем активным лидам без ответственного (${team.unassignedCount})? Тем, у кого ответственный уже есть, ничего не изменится.`
      )
    ) {
      return;
    }
    const data = await patch({ assignUnassignedTo: name });
    if (data && typeof data.assigned === "number") {
      setNotice(`Назначено лидов: ${data.assigned}`);
    }
  }

  return (
    <SettingsCard
      icon={Users}
      title="Команда"
      description="Новые лиды сразу получают ответственного по умолчанию. В карточке любого лида его можно сменить."
    >
    {!team && !error && (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загружаю…
      </div>
    )}

    {team && (
      <>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="default-assignee">
            Ответственный по умолчанию
          </label>
          <Select
            value={team.defaultAssignee ?? NONE}
            onValueChange={(v) => patch({ defaultAssignee: v === NONE ? null : v })}
            disabled={busy}
          >
            <SelectTrigger id="default-assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{UNASSIGNED}</SelectItem>
              {team.members.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Участники</span>
          {team.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока никого. Добавьте имя ниже или назначьте ответственного в карточке лида.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {team.members.map((m) => (
                <li key={m} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{m}</span>
                  {team.defaultAssignee === m && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      по умолчанию
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    disabled={busy}
                    aria-label={`Убрать ${m}`}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="Имя нового участника"
              maxLength={60}
              aria-label="Имя нового участника"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleAdd}
              disabled={busy || !normalizeName(newName)}
            >
              <Plus className="h-4 w-4" />
              Добавить
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
          <p className="text-sm">
            Лидов без ответственного: <b className="font-medium tabular-nums">{team.unassignedCount}</b>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={handleAssignAll}
            disabled={busy || !team.defaultAssignee || team.unassignedCount === 0}
          >
            {team.defaultAssignee
              ? `Назначить «${team.defaultAssignee}» всем без ответственного`
              : "Сначала выберите ответственного по умолчанию"}
          </Button>
          {notice && (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          )}
        </div>
      </>
    )}

    {error && (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )}
    </SettingsCard>
  );
}

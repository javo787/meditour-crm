"use client";

import { useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { KanbanCardContent } from "@/components/leads/kanban-card";
import { KanbanColumn } from "@/components/leads/kanban-column";
import { STAGES } from "@/lib/status";
import type { Lead, Stage } from "@/lib/types";

export function KanbanBoard({
  initialColumns,
}: {
  initialColumns: Record<Stage, Lead[]>;
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const leadStageMap = useMemo(() => {
    const map = new Map<string, Stage>();
    for (const [stage, leads] of Object.entries(columns)) {
      for (const lead of leads) {
        map.set(lead.id, stage as Stage);
      }
    }
    return map;
  }, [columns]);

  function findColumn(id: string): Stage | undefined {
    if (id in columns) return id as Stage;
    return leadStageMap.get(id);
  }

  function handleDragStart(event: DragStartEvent) {
    const stage = findColumn(event.active.id as string);
    if (!stage) return;
    setActiveLead(columns[stage].find((l) => l.id === event.active.id) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveLead(null);
    if (!over) return;

    const sourceCol = findColumn(active.id as string);
    const destCol = findColumn(over.id as string);
    if (!sourceCol || !destCol) return;
    if (sourceCol === destCol && active.id === over.id) return;

    setColumns((prev) => {
      const sourceItems = [...prev[sourceCol]];
      const destItems = sourceCol === destCol ? sourceItems : [...prev[destCol]];
      const activeIndex = sourceItems.findIndex((l) => l.id === active.id);
      if (activeIndex === -1) return prev;
      const [moved] = sourceItems.splice(activeIndex, 1);
      let overIndex = destItems.findIndex((l) => l.id === over.id);
      if (overIndex === -1) overIndex = destItems.length;
      destItems.splice(overIndex, 0, { ...moved, stage: destCol });
      return { ...prev, [sourceCol]: sourceItems, [destCol]: destItems };
    });

    if (sourceCol !== destCol) {
      fetch(`/api/leads/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: destCol }),
      }).catch(() => {
        /* демо: при сетевой ошибке карточка останется передвинутой только локально */
      });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="thin-scrollbar flex flex-1 gap-3 overflow-x-auto pb-2">
        {STAGES.map((s) => (
          <KanbanColumn key={s.key} stage={s.key} label={s.label} leads={columns[s.key]} />
        ))}
      </div>
      <DragOverlay>
        {activeLead ? <KanbanCardContent lead={activeLead} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { KanbanCard } from "@/components/leads/kanban-card";
import { cn } from "@/lib/utils";
import type { Lead, Stage } from "@/lib/types";

export function KanbanColumn({
  stage,
  label,
  leads,
}: {
  stage: Stage;
  label: string;
  leads: Lead[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-secondary/50">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {leads.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "thin-scrollbar flex min-h-[140px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2",
          isOver && "bg-primary/5"
        )}
      >
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <KanbanCard key={lead.id} lead={lead} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

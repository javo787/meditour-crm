"use client";

import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDistanceToNowStrict, isPast } from "date-fns";
import { ru } from "date-fns/locale";
import { User } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { PhoneLink } from "@/components/leads/phone-link";
import { TagChip } from "@/components/leads/tag-chip";
import { WaitingBadge } from "@/components/leads/waiting-badge";
import { getWaitingBadge } from "@/lib/status";
import { isActiveLead } from "@/lib/touches";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types";

export function KanbanCardContent({
  lead,
  dragging = false,
  onClick,
}: {
  lead: Lead;
  dragging?: boolean;
  onClick?: () => void;
}) {
  const overdue = isActiveLead(lead) && isPast(new Date(lead.nextTouch));
  const initials = lead.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  const hasBadges = Boolean(getWaitingBadge(lead) || lead.tags?.length);

  return (
    <Card
      onClick={onClick}
      className={cn(
        "cursor-grab select-none p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing",
        dragging && "opacity-50"
      )}
    >
      <div className="flex items-start gap-2.5">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.name}</p>
          <p className="truncate text-xs text-muted-foreground">{lead.diagnosis}</p>
        </div>
        <PhoneLink phone={lead.phone} />
      </div>
      {hasBadges && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <WaitingBadge lead={lead} />
          {lead.tags?.map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3" />
          {lead.assignee}
        </span>
        <span className={cn(overdue && "font-medium text-destructive")}>
          {overdue
            ? "просрочено"
            : formatDistanceToNowStrict(new Date(lead.nextTouch), {
                locale: ru,
                addSuffix: true,
              })}
        </span>
      </div>
    </Card>
  );
}

export function KanbanCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCardContent
        lead={lead}
        dragging={isDragging}
        onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
      />
    </div>
  );
}

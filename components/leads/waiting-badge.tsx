import { getWaitingBadge, WAITING_BADGE_STYLES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types";

export function WaitingBadge({ lead, className }: { lead: Lead; className?: string }) {
  const badge = getWaitingBadge(lead);
  if (!badge) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        WAITING_BADGE_STYLES[badge.tone],
        className
      )}
    >
      {badge.label}
    </span>
  );
}

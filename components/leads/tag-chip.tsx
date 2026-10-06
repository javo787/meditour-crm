import { X } from "lucide-react";

import { tagColor } from "@/lib/status";
import { cn } from "@/lib/utils";

export function TagChip({
  tag,
  onRemove,
  className,
}: {
  tag: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tagColor(tag),
        className
      )}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Удалить метку ${tag}`}
          className="-mr-0.5 rounded-full hover:opacity-70"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

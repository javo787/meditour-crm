import { cn } from "@/lib/utils";

/** Красный счётчик у пункта меню. При 0 ничего не рисует. */
export function NavBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-5 text-destructive-foreground tabular-nums",
        className
      )}
      aria-label={`Требуют внимания: ${count}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

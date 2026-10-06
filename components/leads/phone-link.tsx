import { Phone } from "lucide-react";

import { cn } from "@/lib/utils";

export function PhoneLink({ phone, className }: { phone: string; className?: string }) {
  return (
    <a
      href={`tel:+${phone}`}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Позвонить на ${phone}`}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className
      )}
    >
      <Phone className="h-3.5 w-3.5" />
    </a>
  );
}

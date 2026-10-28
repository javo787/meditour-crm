import { Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describeFirstContact } from "@/lib/first-contact-view";
import type { Lead } from "@/lib/types";

// Сводка лида от ИИ и что сейчас делает каденция первых контактов. Пусто — ничего не показываем.
export function FirstContactNote({ lead }: { lead: Pick<Lead, "firstContact" | "aiBrief"> }) {
  const status = describeFirstContact(lead.firstContact);
  if (!lead.aiBrief && !status) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          Сводка ИИ
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {lead.aiBrief && <p className="whitespace-pre-line">{lead.aiBrief.text}</p>}
        {status && <p className="text-xs text-muted-foreground">{status}</p>}
      </CardContent>
    </Card>
  );
}

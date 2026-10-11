import Link from "next/link";
import { ArrowRight, FlaskConical } from "lucide-react";

import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";

export function AiTestPanel() {
  return (
    <SettingsCard
      icon={FlaskConical}
      title="Тест ИИ"
      description="Проверка ответов ИИ без реальных пациентов"
    >
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>Пишете как пациент сами или запускаете автопациента по готовому сценарию.</li>
        <li>ИИ отвечает так же, как в WhatsApp: на русском, таджикском и узбекском.</li>
        <li>Ничего не отправляется пациентам и не сохраняется в CRM.</li>
      </ul>
      <Button asChild className="self-start gap-1.5">
        <Link href="/dashboard/settings/simulator">
          Открыть песочницу
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </SettingsCard>
  );
}

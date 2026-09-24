import { TrendingUp, AlertCircle, Users, Trophy, Activity } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Lead, Stage } from "@/lib/types";
import { isPast } from "date-fns";

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone?: "default" | "warning" | "good";
}) {
  return (
    <Card className="flex flex-1 items-center gap-3 p-4">
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          tone === "warning" && "bg-destructive/10 text-destructive",
          tone === "good" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          (!tone || tone === "default") && "bg-primary/10 text-primary"
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold leading-tight">{value}</p>
      </div>
    </Card>
  );
}

// Тот же набор метрик, что координатор раньше считал вручную на листе
// «Дашборд» (Meditur-Учёт_лидов.xlsx) — здесь он всегда актуален и без
// ручного подсчёта, плюс просроченные касания, которых в таблице не было.
export function KpiBar({ columns }: { columns: Record<Stage, Lead[]> }) {
  const all = Object.values(columns).flat();
  const total = all.length;
  const won = columns.won.length;
  const declined = columns.declined.length;
  const inProgress = total - won - declined;
  const overdue = all.filter(
    (l) => l.stage !== "won" && l.stage !== "declined" && isPast(new Date(l.nextTouch))
  ).length;
  const conversion = total > 0 ? Math.round((won / total) * 100) : 0;

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard icon={Users} label="Всего лидов" value={String(total)} />
      <StatCard icon={Activity} label="В работе" value={String(inProgress)} />
      <StatCard
        icon={AlertCircle}
        label="Просрочено касание"
        value={String(overdue)}
        tone={overdue > 0 ? "warning" : "default"}
      />
      <StatCard icon={Trophy} label="Выиграно" value={String(won)} tone="good" />
      <StatCard icon={TrendingUp} label="Конверсия" value={`${conversion}%`} />
    </div>
  );
}

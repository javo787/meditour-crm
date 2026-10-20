import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { PlanListItem } from "@/lib/plans/schema";
import { formatPlanDateTime, statusLabel } from "@/lib/plans/ui";

// Цвет метки статуса: проверенный — индиго, черновик — серый, сбой разбора — красный.
function statusVariant(plan: PlanListItem): "default" | "secondary" | "destructive" | "outline" {
  if (plan.status === "reviewed") return "default";
  if (plan.status === "draft") return "secondary";
  return plan.generationState === "failed" ? "destructive" : "outline";
}

// Таблица планов. plans === null — список не удалось прочитать из базы (страница при этом не падает).
export function PlansList({ plans }: { plans: PlanListItem[] | null }) {
  if (plans === null) {
    return <p className="text-sm text-destructive">Не удалось загрузить список</p>;
  }
  if (plans.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Планов пока нет. Вставьте письмо из агентства или загрузите .docx, и план соберётся автоматически.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-2.5 font-medium">Пациент</th>
            <th className="px-4 py-2.5 font-medium">Статус</th>
            <th className="px-4 py-2.5 font-medium">Ошибки</th>
            <th className="px-4 py-2.5 font-medium">Создан</th>
            <th className="px-4 py-2.5 font-medium">Обновлён</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2.5">
                <Link href={`/dashboard/plans/${plan.id}`} className="font-medium hover:underline">
                  {plan.patientName || "Без имени"}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                <Badge variant={statusVariant(plan)}>{statusLabel(plan.status, plan.generationState)}</Badge>
              </td>
              <td className="px-4 py-2.5">
                {plan.errorCount > 0 ? (
                  <Badge variant="destructive">Ошибок: {plan.errorCount}</Badge>
                ) : (
                  <span className="text-muted-foreground">нет</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                {formatPlanDateTime(plan.createdAt)}
                {plan.createdBy ? <span className="text-muted-foreground"> · {plan.createdBy}</span> : null}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                {formatPlanDateTime(plan.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

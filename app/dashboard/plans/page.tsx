import Link from "next/link";

import { PlansList } from "@/components/plans/plans-list";
import { buttonVariants } from "@/components/ui/button";
import { createLogger } from "@/lib/logger";
import { listPlans } from "@/lib/plans/db";
import type { PlanListItem } from "@/lib/plans/schema";

export const dynamic = "force-dynamic";

const log = createLogger("plans-page");

export default async function PlansPage() {
  // Ошибка чтения базы не роняет страницу: в списке показывается текст, кнопка «Новый план» остаётся.
  let plans: PlanListItem[] | null;
  try {
    plans = await listPlans();
  } catch (err) {
    log.error("список планов не прочитан", { error: err instanceof Error ? err.name : "unknown" });
    plans = null;
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Планы</h1>
          <p className="text-sm text-muted-foreground">
            {plans === null ? "Список недоступен" : `${plans.length} ${plans.length === 1 ? "план" : "планов"}`}
          </p>
        </div>
        <Link href="/dashboard/plans/new" className={buttonVariants()}>
          Новый план
        </Link>
      </div>
      <PlansList plans={plans} />
    </div>
  );
}

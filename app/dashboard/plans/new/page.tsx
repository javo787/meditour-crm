import Link from "next/link";

import { NewPlanForm } from "@/components/plans/new-plan-form";

export default function NewPlanPage() {
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5">
      <div className="mb-4">
        <Link href="/dashboard/plans" className="text-sm text-muted-foreground hover:underline">
          К списку планов
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">Новый план</h1>
        <p className="text-sm text-muted-foreground">
          Вставьте письмо из агентства или загрузите .docx. План соберётся автоматически.
        </p>
      </div>
      <NewPlanForm />
    </div>
  );
}

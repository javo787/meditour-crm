import Link from "next/link";

import { PlanEditor } from "@/components/plans/plan-editor";

export default function PlanPage({ params }: { params: { id: string } }) {
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5">
      <div className="mb-4">
        <Link href="/dashboard/plans" className="text-sm text-muted-foreground hover:underline">
          К списку планов
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">План лечения</h1>
      </div>
      <PlanEditor planId={params.id} />
    </div>
  );
}

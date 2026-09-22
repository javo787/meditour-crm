import { getLeadsByStage } from "@/lib/db";
import { KanbanBoard } from "@/components/leads/kanban-board";

export default function DashboardPage() {
  const columns = getLeadsByStage();

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">Воронка лидов</h1>
        <p className="text-sm text-muted-foreground">
          Перетащите карточку пациента между этапами — статус обновится сразу
        </p>
      </div>
      <KanbanBoard initialColumns={columns} />
    </div>
  );
}

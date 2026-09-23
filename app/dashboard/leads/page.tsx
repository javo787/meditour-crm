import { getLeads } from "@/lib/db";
import { LeadsFilters } from "@/components/leads/leads-filters";
import { LeadsTable } from "@/components/leads/leads-table";
import type { Stage } from "@/lib/types";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { q?: string; stage?: string };
}) {
  const stage = (searchParams.stage as Stage | "all" | undefined) ?? "all";
  const leads = await getLeads({ q: searchParams.q, stage });

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Лиды</h1>
        <p className="text-sm text-muted-foreground">
          {leads.length} {leads.length === 1 ? "запись" : "записей"} · фильтрация выполняется на сервере
        </p>
      </div>
      <LeadsFilters defaultQuery={searchParams.q ?? ""} defaultStage={stage} />
      <LeadsTable data={leads} />
    </div>
  );
}

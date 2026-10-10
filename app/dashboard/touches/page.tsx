import { TouchesBoard } from "@/components/touches/touches-board";
import { getLeads } from "@/lib/db";
import { isActiveLead } from "@/lib/touches";

export const dynamic = "force-dynamic";

export default async function TouchesPage() {
  const leads = (await getLeads()).filter(isActiveLead);
  return <TouchesBoard leads={leads} />;
}

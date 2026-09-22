import { NextResponse } from "next/server";
import { getLeads } from "@/lib/db";
import type { Stage } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? undefined;
  const stage = (searchParams.get("stage") as Stage | "all" | null) ?? "all";
  const leads = getLeads({ q, stage });
  return NextResponse.json({ leads });
}

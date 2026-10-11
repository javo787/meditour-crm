import { NextResponse } from "next/server";
import { z } from "zod";

import {
  assignUnassignedLeads,
  countUnassignedLeads,
  getTeamSettings,
  updateTeamSettings,
} from "@/lib/db";
import { isUnassigned } from "@/lib/team";

export const dynamic = "force-dynamic";

const name = z.string().trim().min(1).max(60);

const patchSchema = z.object({
  addMember: name.optional(),
  removeMember: name.optional(),
  /** null — «по умолчанию никого». */
  defaultAssignee: name.nullable().optional(),
  /** Назначить этого человека всем активным лидам без ответственного. */
  assignUnassignedTo: name.optional(),
});

async function snapshot(extra?: { assigned?: number }) {
  const [team, unassignedCount] = await Promise.all([getTeamSettings(), countUnassignedLeads()]);
  return { ...team, unassignedCount, ...extra };
}

export async function GET() {
  return NextResponse.json(await snapshot());
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  const { assignUnassignedTo, ...teamPatch } = parsed.data;

  if (assignUnassignedTo !== undefined && isUnassigned(assignUnassignedTo)) {
    return NextResponse.json({ error: "Укажите человека" }, { status: 400 });
  }

  let team = await updateTeamSettings(teamPatch);

  let assigned: number | undefined;
  if (assignUnassignedTo !== undefined) {
    team = await updateTeamSettings({ addMember: assignUnassignedTo });
    // Берём каноничное написание из списка (без дублей по регистру).
    const canonical =
      team.members.find((m) => m.toLowerCase() === assignUnassignedTo.toLowerCase()) ??
      assignUnassignedTo;
    assigned = await assignUnassignedLeads(canonical);
  }

  return NextResponse.json(await snapshot(assigned === undefined ? undefined : { assigned }));
}

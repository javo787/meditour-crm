import { NextResponse } from "next/server";
import { z } from "zod";

import { getLead, mergeDocuments } from "@/lib/db";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ ids: z.array(z.string()).min(2).max(30) });

// Склеивает страницы одного документа: первый id — главный (название, дата),
// остальные идут за ним в PDF одним разделом.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) return NextResponse.json({ error: "Лид не найден" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Выберите два и больше документов" }, { status: 400 });

  const result = await mergeDocuments(params.id, parsed.data.ids);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

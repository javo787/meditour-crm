import { NextResponse } from "next/server";
import { z } from "zod";

import { getLead, saveDossierProfile } from "@/lib/db";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().max(80).optional(),
  dob: z.string().trim().max(30).optional(),
  gender: z.enum(["Male", "Female"]).optional(),
});

// Имя латиницей, дата рождения и пол для титульной страницы досье. Имя также
// подсказывается модели при следующем разборе документов этого пациента.
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) return NextResponse.json({ error: "Лид не найден" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });

  await saveDossierProfile(params.id, parsed.data);
  return NextResponse.json({ ok: true });
}

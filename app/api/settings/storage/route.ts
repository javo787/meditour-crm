import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteAllMediaAssets, deleteMediaAssetsOlderThan, getStorageStats } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await getStorageStats();
  return NextResponse.json(stats);
}

const cleanupSchema = z.object({ olderThanDays: z.number().int().min(1).optional() });

// olderThanDays отсутствует/не передан -> удаляем вообще всё медиа.
// olderThanDays: N -> удаляем только то, что старше N дней.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = cleanupSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const result = parsed.data.olderThanDays
    ? await deleteMediaAssetsOlderThan(parsed.data.olderThanDays)
    : await deleteAllMediaAssets();

  return NextResponse.json(result);
}

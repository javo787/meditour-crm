import { NextResponse } from "next/server";

import { getLead, importChatPhotosAsDocuments } from "@/lib/db";
import { kickDocumentQueue } from "@/lib/document-queue";

export const dynamic = "force-dynamic";

// Копирует в «Документы» фото, которые пациент уже прислал в WhatsApp, и
// ставит их в очередь на разбор. Селфи и чеки модель пометит как «прочее» —
// в PDF они не попадут.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) return NextResponse.json({ error: "Лид не найден" }, { status: 404 });

  const result = await importChatPhotosAsDocuments(params.id);
  if (result.added > 0) kickDocumentQueue();
  return NextResponse.json(result);
}

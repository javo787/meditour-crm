import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteDocument, updateDocument } from "@/lib/db";
import { kickDocumentQueue } from "@/lib/document-queue";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    docDate: z.string().trim().max(30).optional(),
    category: z.enum(["report", "imaging", "other"]).optional(),
    translationEn: z.string().max(60_000).optional(),
    include: z.boolean().optional(),
    reviewed: z.boolean().optional(),
    /** Поставить в очередь: разбор нового файла или повтор после ошибки. */
    queue: z.boolean().optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: { id: string; docId: string } }) {
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });

  const document = await updateDocument(params.id, params.docId, parsed.data);
  if (!document) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  if (parsed.data.queue) kickDocumentQueue();
  return NextResponse.json({ document });
}

export async function DELETE(_request: Request, { params }: { params: { id: string; docId: string } }) {
  const ok = await deleteDocument(params.id, params.docId);
  if (!ok) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

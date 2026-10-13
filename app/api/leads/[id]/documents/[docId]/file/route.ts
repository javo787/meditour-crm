import { NextResponse } from "next/server";

import { getDocumentFile } from "@/lib/db";

export const dynamic = "force-dynamic";

// Сырые байты для миниатюры/просмотра в панели «Документы».
export async function GET(_request: Request, { params }: { params: { id: string; docId: string } }) {
  const file = await getDocumentFile(params.id, params.docId);
  if (!file) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

import { NextResponse } from "next/server";
import { getMediaAssetByMessageId } from "@/lib/db";

export const dynamic = "force-dynamic";

// Отдаёт сырые байты — не JSON+base64 — чтобы <img src="...">/<audio src="...">
// в chat-panel работали напрямую, без лишнего round-trip через React state.
// Доступ уже прикрыт middleware.ts (matcher включает /api/leads/*), так что
// отдельная проверка сессии здесь не нужна.
export async function GET(
  _request: Request,
  { params }: { params: { id: string; messageId: string } }
) {
  const asset = await getMediaAssetByMessageId(params.messageId);
  if (!asset) {
    return NextResponse.json({ error: "Медиа не найдено" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(asset.base64, "base64"), {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}

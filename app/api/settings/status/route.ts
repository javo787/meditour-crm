import { NextResponse } from "next/server";
import { checkGeminiHealth } from "@/lib/gemini";
import { checkWhatsAppConnection } from "@/lib/evolution";
import { newRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Только общий статус для UI — намеренно ничего технического в ответе
// (ни имён провайдеров, ни эндпоинтов, ни кодов ошибок): страница настроек
// не должна выдавать архитектуру продукта. Технические детали — в Render
// логах, помеченные общим requestId для обеих проверок.
export async function GET() {
  const requestId = newRequestId();
  const [ai, whatsapp] = await Promise.all([
    checkGeminiHealth(requestId),
    checkWhatsAppConnection(requestId),
  ]);
  return NextResponse.json({ ai, whatsapp, checkedAt: new Date().toISOString() });
}

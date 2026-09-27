import { NextResponse } from "next/server";
import { checkGeminiHealth } from "@/lib/gemini";
import { checkWhatsAppConnection } from "@/lib/evolution";

export const dynamic = "force-dynamic";

// Только общий статус для UI — намеренно ничего технического в ответе
// (ни имён провайдеров, ни эндпоинтов, ни кодов ошибок): страница настроек
// не должна выдавать архитектуру продукта.
export async function GET() {
  const [ai, whatsapp] = await Promise.all([checkGeminiHealth(), checkWhatsAppConnection()]);
  return NextResponse.json({ ai, whatsapp, checkedAt: new Date().toISOString() });
}

import { NextResponse } from "next/server";
import { checkGeminiHealth } from "@/lib/gemini";
import { checkWhatsAppConnection } from "@/lib/evolution";
import { getWebhookHeartbeat, getWhatsAppActivity } from "@/lib/db";
import { newRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Только общий статус для UI — намеренно ничего технического в ответе
// (ни имён провайдеров, ни эндпоинтов, ни кодов ошибок): страница настроек
// не должна выдавать архитектуру продукта. Технические детали — в Render
// логах, помеченные общим requestId для обеих проверок.
//
// whatsapp ниже — это "сессия у шлюза жива" (ровно то, что показывало
// "Connected" в Evolution, пока бот сутки никому не отвечал: канал не
// падал, просто не туда адресовались сообщения). lastInboundAt/
// failedDeliveries24h — из фактических сообщений в нашей базе. lastWebhookAt —
// третий, отдельный сигнал: последний раз, когда Evolution вообще вызвал
// наш вебхук, независимо от того, что внутри него произошло. Если этот
// показатель "завис" в прошлом, а WhatsApp/AI выше показывают "Работает" —
// проблема не в нашем коде и не чинится отсюда: WhatsApp просто не
// передаёт новые сообщения в Evolution, это чинится на стороне
// шлюза/сессии.
export async function GET() {
  const requestId = newRequestId();
  const [ai, whatsapp, activity, heartbeat] = await Promise.all([
    checkGeminiHealth(requestId),
    checkWhatsAppConnection(requestId),
    getWhatsAppActivity(),
    getWebhookHeartbeat(),
  ]);
  return NextResponse.json({
    ai,
    whatsapp,
    lastInboundAt: activity.lastInboundAt,
    failedDeliveries24h: activity.failedDeliveries24h,
    lastWebhookAt: heartbeat.lastReceivedAt,
    checkedAt: new Date().toISOString(),
  });
}

import { NextResponse } from "next/server";

import { getLeads } from "@/lib/db";
import { notifyCoordinator, telegramConfigured, whatsAppChatUrl } from "@/lib/telegram-alerts";

export const dynamic = "force-dynamic";

// Проверочное сообщение из настроек: показывает, что бот настроен и что кнопка
// «Перейти в WhatsApp» открывает нужный чат. Берём самого свежего лида с
// номером телефона — тогда кнопка ведёт в реальный чат. Доступ закрыт middleware.
export async function POST() {
  if (!telegramConfigured()) return NextResponse.json({ configured: false });

  const leads = await getLeads();
  const sample = leads
    .filter((lead) => whatsAppChatUrl(lead.phone))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const result = await notifyCoordinator(
    "test",
    sample ? { id: sample.id, name: sample.name, phone: sample.phone } : { id: "", name: "Тест", phone: "" }
  );

  if (result.status === "failed") {
    return NextResponse.json({ configured: true, ok: false, error: result.error });
  }
  return NextResponse.json({ configured: true, ok: true, sampleName: sample?.name ?? null });
}

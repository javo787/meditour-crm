import { NextResponse } from "next/server";

import { addMessage, createLead, findLeadByPhone, getMessages, updateLead } from "@/lib/db";
import { fetchMediaBase64, sendWhatsAppText } from "@/lib/evolution";
import { askGemini } from "@/lib/gemini";

export const dynamic = "force-dynamic";

// Приём вебхуков от Evolution API (Этап 3 плана).
// Формат payload подтверждён по документации/issue-трекеру Evolution API v2:
// { event: "messages.upsert", instance, apikey, data: { key, pushName, message, messageType } }

interface EvolutionWebhookBody {
  event?: string;
  apikey?: string;
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string };
    pushName?: string;
    messageType?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      imageMessage?: { caption?: string };
    };
  };
}

// Evolution кладёт apikey инстанса в каждое событие — простая проверка,
// что вебхук пришёл действительно от нашего инстанса, а не от кого попало.
function isAuthentic(body: EvolutionWebhookBody): boolean {
  const expected = process.env.EVOLUTION_API_KEY;
  if (!expected) return true; // ключ ещё не настроен — не блокируем локальную разработку
  return body.apikey === expected;
}

function extractPhone(remoteJid: string | undefined): string | null {
  if (!remoteJid) return null;
  const [id] = remoteJid.split("@");
  return id || null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as EvolutionWebhookBody | null;
  if (!body) {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  if (!isAuthentic(body)) {
    return NextResponse.json({ error: "Неверный apikey" }, { status: 401 });
  }

  // Нас интересуют только новые сообщения (не статусы прочтения и т.п.)
  if (body.event !== "messages.upsert") {
    return NextResponse.json({ ok: true, skipped: "event" });
  }

  const data = body.data;
  const key = data?.key;

  // Игнорируем эхо собственных исходящих сообщений — иначе зациклимся.
  if (!key || key.fromMe) {
    return NextResponse.json({ ok: true, skipped: "fromMe" });
  }

  const phone = extractPhone(key.remoteJid);
  if (!phone) {
    return NextResponse.json({ ok: true, skipped: "no-phone" });
  }

  const message = data?.message ?? {};
  const messageType = data?.messageType ?? "";

  let text = message.conversation ?? message.extendedTextMessage?.text ?? "";
  let image: { base64: string; mimeType: string } | undefined;

  // Обработка медиафайлов: скачиваем через Evolution, конвертируем в base64
  // и упаковываем для Gemini (imageParts).
  if (messageType === "imageMessage" && message.imageMessage) {
    try {
      const media = await fetchMediaBase64(key);
      image = { base64: media.base64, mimeType: media.mimetype };
      text = message.imageMessage.caption ?? text;
    } catch (err) {
      console.error("Не удалось скачать медиа из Evolution API", err);
    }
  }

  const storedText =
    text || (image ? "📎 [изображение без подписи]" : "[неподдерживаемый тип сообщения]");

  // 1) Проверяем, существует ли номер в базе — если нет, заводим лид «Новый».
  let lead = await findLeadByPhone(phone);
  if (!lead) {
    lead = await createLead({
      name: data?.pushName || phone,
      phone,
      stage: "new",
      source: "WhatsApp",
    });
  }

  // 2) Сохраняем сообщение пациента в историю переписки.
  await addMessage(lead.id, "patient", storedText + (image ? " (+фото)" : ""));

  // 3) Маршрутизатор статусов: если координатор уже взял диалог на себя
  // (aiPaused — тот же флаг, что кнопка «Остановить ИИ» на Этапе 2) — ИИ
  // сообщение игнорирует, просто оставляя его в истории для координатора.
  if (lead.aiPaused) {
    return NextResponse.json({ ok: true, skipped: "ai-paused" });
  }

  try {
    const history = await getMessages(lead.id);
    const reply = await askGemini({
      history: history.slice(0, -1), // без только что добавленного сообщения пациента
      userText: text,
      image,
    });

    await addMessage(lead.id, "ai", reply);
    await sendWhatsAppText(phone, reply);

    if (lead.stage === "new") {
      await updateLead(lead.id, { stage: "first_contact" });
    }
  } catch (err) {
    // Сообщение пациента уже сохранено — координатор увидит его в карточке
    // и сможет ответить вручную, даже если ИИ или Evolution временно недоступны.
    console.error("Ошибка при обращении к ИИ или отправке ответа в WhatsApp", err);
  }

  return NextResponse.json({ ok: true });
}

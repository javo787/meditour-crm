import { NextResponse } from "next/server";

import { addMessage, createLead, findLeadByPhone, getMessages, updateLead } from "@/lib/db";
import { fetchMediaBase64, sendWhatsAppText } from "@/lib/evolution";
import { askGemini } from "@/lib/gemini";
import { createLogger, newRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";

const baseLog = createLogger("webhook");

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
  const requestId = newRequestId();
  const log = baseLog.child(requestId);

  log.info("1. запрос получен");

  const rawBody = await request.text();
  let body: EvolutionWebhookBody | null = null;
  try {
    body = JSON.parse(rawBody) as EvolutionWebhookBody;
  } catch (err) {
    log.error("2. не удалось распарсить JSON тела запроса", {
      message: err instanceof Error ? err.message : String(err),
      rawBodyPreview: rawBody.slice(0, 500),
    });
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  log.info("2. тело запроса распарсено", {
    event: body.event,
    hasApikey: Boolean(body.apikey),
    messageType: body.data?.messageType,
    remoteJid: body.data?.key?.remoteJid,
    fromMe: body.data?.key?.fromMe,
  });

  if (!isAuthentic(body)) {
    log.warn("3. проверка apikey не пройдена — запрос отклонён (401)", {
      apikeyConfigured: Boolean(process.env.EVOLUTION_API_KEY),
    });
    return NextResponse.json({ error: "Неверный apikey" }, { status: 401 });
  }
  log.info("3. apikey подтверждён (или проверка отключена, т.к. EVOLUTION_API_KEY не задан)");

  // Нас интересуют только новые сообщения (не статусы прочтения и т.п.)
  if (body.event !== "messages.upsert") {
    log.info("4. событие пропущено — это не messages.upsert", { event: body.event });
    return NextResponse.json({ ok: true, skipped: "event" });
  }
  log.info("4. событие messages.upsert принято");

  const data = body.data;
  const key = data?.key;

  // Игнорируем эхо собственных исходящих сообщений — иначе зациклимся.
  if (!key || key.fromMe) {
    log.info("5. сообщение пропущено — нет key или это своё же эхо (fromMe)", {
      hasKey: Boolean(key),
      fromMe: key?.fromMe,
    });
    return NextResponse.json({ ok: true, skipped: "fromMe" });
  }
  log.info("5. это входящее сообщение от пациента (не эхо)");

  const phone = extractPhone(key.remoteJid);
  if (!phone) {
    log.warn("6. не удалось извлечь номер телефона из remoteJid", { remoteJid: key.remoteJid });
    return NextResponse.json({ ok: true, skipped: "no-phone" });
  }
  log.info("6. номер телефона извлечён", { phone });

  const message = data?.message ?? {};
  const messageType = data?.messageType ?? "";

  let text = message.conversation ?? message.extendedTextMessage?.text ?? "";
  let image: { base64: string; mimeType: string } | undefined;

  log.info("7. разбор содержимого сообщения", {
    messageType,
    textLength: text.length,
    hasImageMessage: Boolean(message.imageMessage),
  });

  // Обработка медиафайлов: скачиваем через Evolution, конвертируем в base64
  // и упаковываем для Gemini (imageParts).
  if (messageType === "imageMessage" && message.imageMessage) {
    log.info("7a. это изображение — запрашиваем медиа из Evolution API");
    try {
      const media = await fetchMediaBase64(key, requestId);
      image = { base64: media.base64, mimeType: media.mimetype };
      text = message.imageMessage.caption ?? text;
      log.info("7a. медиа успешно получено и упаковано для Gemini", {
        mimeType: image.mimeType,
        base64Length: image.base64.length,
      });
    } catch (err) {
      log.error("7a. не удалось скачать медиа из Evolution API — продолжаем без изображения", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const storedText =
    text || (image ? "📎 [изображение без подписи]" : "[неподдерживаемый тип сообщения]");

  // 1) Проверяем, существует ли номер в базе — если нет, заводим лид «Новый».
  let lead = await findLeadByPhone(phone);
  if (!lead) {
    log.info("8. лид с таким номером не найден — создаём новый", { phone, pushName: data?.pushName });
    lead = await createLead({ name: data?.pushName || phone, phone, stage: "new" });
    log.info("8. новый лид создан", { leadId: lead.id });
  } else {
    log.info("8. найден существующий лид", { leadId: lead.id, stage: lead.stage, aiPaused: lead.aiPaused });
  }

  // 2) Сохраняем сообщение пациента в историю переписки.
  await addMessage(lead.id, "patient", storedText + (image ? " (+фото)" : ""));
  log.info("9. сообщение пациента сохранено в историю", { leadId: lead.id, storedTextLength: storedText.length });

  // 3) Маршрутизатор статусов: если координатор уже взял диалог на себя
  // (aiPaused — тот же флаг, что кнопка «Остановить ИИ» на Этапе 2) — ИИ
  // сообщение игнорирует, просто оставляя его в истории для координатора.
  if (lead.aiPaused) {
    log.info("10. ИИ на паузе для этого лида (aiPaused) — ответ не генерируем", { leadId: lead.id });
    return NextResponse.json({ ok: true, skipped: "ai-paused" });
  }
  log.info("10. ИИ активен для этого лида — переходим к генерации ответа");

  try {
    const history = await getMessages(lead.id);
    log.info("11. история переписки загружена для контекста Gemini", {
      leadId: lead.id,
      totalMessages: history.length,
    });

    const reply = await askGemini({
      history: history.slice(0, -1), // без только что добавленного сообщения пациента
      userText: text,
      image,
      requestId,
    });
    log.info("12. Gemini вернул ответ", { leadId: lead.id, replyLength: reply.length });

    await addMessage(lead.id, "ai", reply);
    log.info("13. ответ ИИ сохранён в историю", { leadId: lead.id });

    await sendWhatsAppText(phone, reply, requestId);
    log.info("14. ответ отправлен пациенту через Evolution API", { phone });

    if (lead.stage === "new") {
      await updateLead(lead.id, { stage: "data_collection" });
      log.info("15. статус лида обновлён new → data_collection", { leadId: lead.id });
    }
  } catch (err) {
    // Сообщение пациента уже сохранено — координатор увидит его в карточке
    // и сможет ответить вручную, даже если ИИ или Evolution временно недоступны.
    log.error("Ошибка при обращении к ИИ или отправке ответа в WhatsApp — сообщение пациента сохранено, координатор сможет ответить вручную", {
      leadId: lead.id,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  log.info("16. обработка вебхука завершена");
  return NextResponse.json({ ok: true });
}

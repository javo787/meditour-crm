import { NextResponse } from "next/server";

import { addMessage, createLead, findLeadByPhone, getLead, getMessages, saveMediaAsset, updateLead } from "@/lib/db";
import { fetchMediaBase64, sendWhatsAppText } from "@/lib/evolution";
import { askGemini } from "@/lib/gemini";
import { createLogger, newRequestId, Logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const baseLog = createLogger("webhook");

// Buffer for grouping incoming messages by leadId
const BATCH_DEBOUNCE_MS = 8000;
// NOTE: module-level state works here because the service runs with WEB_CONCURRENCY=1 (a single Node process).
// If scaled to multiple instances, this needs to be moved to a shared store (e.g., Redis).
const pendingBatches = new Map<string, {
  items: Array<{
    text: string;
    image?: { base64: string; mimeType: string };
    audio?: { base64: string; mimeType: string };
  }>;
  timer: NodeJS.Timeout;
}>();

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
      audioMessage?: { mimetype?: string; ptt?: boolean; seconds?: number };
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

async function parseAndValidateWebhook(request: Request, log: Logger) {
  const rawBody = await request.text();
  let body: EvolutionWebhookBody | null = null;

  try {
    body = JSON.parse(rawBody) as EvolutionWebhookBody;
  } catch (err) {
    log.error("2. не удалось распарсить JSON тела запроса", {
      message: err instanceof Error ? err.message : String(err),
      rawBodyPreview: rawBody.slice(0, 500),
    });
    return { errorResponse: NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }) };
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
    return { errorResponse: NextResponse.json({ error: "Неверный apikey" }, { status: 401 }) };
  }
  log.info("3. apikey подтверждён (или проверка отключена, т.к. EVOLUTION_API_KEY не задан)");

  // Нас интересуют только новые сообщения (не статусы прочтения и т.п.)
  if (body.event !== "messages.upsert") {
    log.info("4. событие пропущено — это не messages.upsert", { event: body.event });
    return { earlyResponse: NextResponse.json({ ok: true, skipped: "event" }) };
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
    return { earlyResponse: NextResponse.json({ ok: true, skipped: "fromMe" }) };
  }
  log.info("5. это входящее сообщение от пациента (не эхо)");

  const phone = extractPhone(key.remoteJid);
  if (!phone) {
    log.warn("6. не удалось извлечь номер телефона из remoteJid", { remoteJid: key.remoteJid });
    return { earlyResponse: NextResponse.json({ ok: true, skipped: "no-phone" }) };
  }
  log.info("6. номер телефона извлечён", { phone });

  return { body, phone };
}

async function extractMessageContent(
  message: NonNullable<EvolutionWebhookBody["data"]>["message"],
  messageType: string,
  key: NonNullable<EvolutionWebhookBody["data"]>["key"],
  requestId: string,
  log: Logger
) {
  let text = message?.conversation ?? message?.extendedTextMessage?.text ?? "";
  let image: { base64: string; mimeType: string } | undefined;
  let audio: { base64: string; mimeType: string } | undefined;

  log.info("7. разбор содержимого сообщения", {
    messageType,
    textLength: text.length,
    hasImageMessage: Boolean(message?.imageMessage),
    hasAudioMessage: Boolean(message?.audioMessage),
  });

  if (messageType === "imageMessage" && message?.imageMessage) {
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
  } else if (messageType === "audioMessage" && message?.audioMessage) {
    // Голосовые (ptt: true) и обычные аудио-файлы приходят одним и тем же
    // messageType — Evolution отдаёт их через тот же generic-эндпоинт
    // getBase64FromMediaMessage, что и картинки, так что fetchMediaBase64
    // менять не нужно. mimetype обычно "audio/ogg; codecs=opus" — отрезаем
    // параметр кодека, Gemini ожидает чистый MIME-тип в inlineData.
    log.info("7b. это голосовое/аудио сообщение — запрашиваем медиа из Evolution API", {
      ptt: message.audioMessage.ptt,
      seconds: message.audioMessage.seconds,
    });
    try {
      const media = await fetchMediaBase64(key, requestId);
      audio = { base64: media.base64, mimeType: media.mimetype.split(";")[0].trim() };
      log.info("7b. аудио успешно получено и упаковано для Gemini", {
        mimeType: audio.mimeType,
        base64Length: audio.base64.length,
      });
    } catch (err) {
      log.error("7b. не удалось скачать аудио из Evolution API — продолжаем без него", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const storedText =
    text ||
    (image
      ? "📎 [изображение без подписи]"
      : audio
      ? "🎤 [голосовое сообщение]"
      : "[неподдерживаемый тип сообщения]");

  return { text, storedText, image, audio };
}

async function processNewMessage(
  phone: string,
  data: NonNullable<EvolutionWebhookBody["data"]>,
  text: string,
  storedText: string,
  image: { base64: string; mimeType: string } | undefined,
  audio: { base64: string; mimeType: string } | undefined,
  log: Logger
) {
  // 1) Проверяем, существует ли номер в базе — если нет, заводим лид «Новый».
  let lead = await findLeadByPhone(phone);
  if (!lead) {
    log.info("8. лид с таким номером не найден — создаём новый", { phone, pushName: data?.pushName });
    lead = await createLead({
      name: data?.pushName || phone,
      phone,
      stage: "new",
      source: "WhatsApp",
    });
    log.info("8. новый лид создан", { leadId: lead.id });
  } else {
    log.info("8. найден существующий лид", { leadId: lead.id, stage: lead.stage, aiPaused: lead.aiPaused });
  }

  // 2) Сохраняем сообщение пациента в историю переписки.
  const savedMessage = await addMessage(
    lead.id,
    "patient",
    storedText + (image ? " (+фото)" : "") + (audio ? " (+голосовое)" : ""),
    image ? { kind: "image", mimeType: image.mimeType } : audio ? { kind: "audio", mimeType: audio.mimeType } : undefined
  );
  log.info("9. сообщение пациента сохранено в историю", { leadId: lead.id, storedTextLength: storedText.length });

  // Раньше на этом фото/голосовое терялось безвозвратно — fetchMediaBase64
  // доставал их из Evolution только для этого одного ответа Gemini.
  // Теперь сохраняем реальные байты в MediaAssets, привязанные к
  // savedMessage.id — координатор увидит их в переписке (chat-panel), а
  // Medical Opinion Request сможет прочитать сами документы, а не только
  // текстовую пометку "(+фото)".
  if (image) {
    await saveMediaAsset({
      leadId: lead.id,
      messageId: savedMessage.id,
      kind: "image",
      mimeType: image.mimeType,
      base64: image.base64,
    });
    log.info("9a. фото сохранено в MediaAssets", { leadId: lead.id, messageId: savedMessage.id });
  } else if (audio) {
    await saveMediaAsset({
      leadId: lead.id,
      messageId: savedMessage.id,
      kind: "audio",
      mimeType: audio.mimeType,
      base64: audio.base64,
    });
    log.info("9a. голосовое сохранено в MediaAssets", { leadId: lead.id, messageId: savedMessage.id });
  }

  // 3) Маршрутизатор статусов: если координатор уже взял диалог на себя
  // (aiPaused — тот же флаг, что кнопка «Остановить ИИ» на Этапе 2) — ИИ
  // сообщение игнорирует, просто оставляя его в истории для координатора.
  if (lead.aiPaused) {
    log.info("10. ИИ на паузе для этого лида (aiPaused) — ответ не генерируем", { leadId: lead.id });
    return NextResponse.json({ ok: true, skipped: "ai-paused" });
  }
  log.info("10. ИИ активен для этого лида — буферизуем сообщение");

  let batch = pendingBatches.get(lead.id);
  if (batch) {
    clearTimeout(batch.timer);
  } else {
    batch = { items: [], timer: setTimeout(() => {}, 0) };
    pendingBatches.set(lead.id, batch);
  }

  batch.items.push({ text, image, audio });
  batch.timer = setTimeout(() => processBatch(lead.id, phone), BATCH_DEBOUNCE_MS);

  log.info("11. сообщение добавлено в буфер, таймер обновлен", { leadId: lead.id, itemsCount: batch.items.length });
  return NextResponse.json({ ok: true, buffered: true });
}

export async function POST(request: Request) {
  const requestId = newRequestId();
  const log = baseLog.child(requestId);

  log.info("1. запрос получен");

  const validationResult = await parseAndValidateWebhook(request, log);
  if ("errorResponse" in validationResult) return validationResult.errorResponse;
  if ("earlyResponse" in validationResult) return validationResult.earlyResponse;

  const { body, phone } = validationResult;
  const data = body.data as NonNullable<EvolutionWebhookBody["data"]>;

  const { text, storedText, image, audio } = await extractMessageContent(
    data.message,
    data.messageType ?? "",
    data.key,
    requestId,
    log
  );

  return await processNewMessage(phone, data, text, storedText, image, audio, log);
}

async function processBatch(leadId: string, phone: string) {
  const requestId = newRequestId();
  const log = baseLog.child(requestId);

  const batch = pendingBatches.get(leadId);
  if (!batch) return;

  pendingBatches.delete(leadId);
  const items = batch.items;

  log.info("processBatch: старт обработки пачки сообщений", { leadId, itemsCount: items.length });

  const lead = await getLead(leadId);
  if (!lead) {
    log.error("processBatch: лид не найден", { leadId });
    return;
  }

  if (lead.aiPaused) {
    log.info("processBatch: ИИ на паузе (aiPaused) — ответ не генерируем, оставляем в истории", { leadId });
    return;
  }

  try {
    const history = await getMessages(leadId);
    // Remove the latest `items.length` messages from the context sent to Gemini,
    // because those are the buffered ones we are passing explicitly in `items` with full image data.
    const olderHistory = items.length > 0 ? history.slice(0, -items.length) : history;
    log.info("processBatch: история переписки загружена для контекста Gemini", {
      leadId,
      totalMessages: history.length,
      olderHistoryMessages: olderHistory.length,
    });

    const { text: reply, shouldPause } = await askGemini({
      history: olderHistory,
      items,
      requestId,
    });
    log.info("processBatch: Gemini вернул ответ", { leadId, replyLength: reply.length, shouldPause });

    await addMessage(leadId, "ai", reply);
    log.info("processBatch: ответ ИИ сохранён в историю", { leadId });

    await sendWhatsAppText(phone, reply, requestId);
    log.info("processBatch: ответ отправлен пациенту через Evolution API", { phone });

    if (lead.stage === "new") {
      await updateLead(leadId, { stage: "first_contact" });
      log.info("processBatch: статус лида обновлён new → first_contact", { leadId });
    }

    // Модель сама решает, когда передать диалог координатору — обычно
    // сразу после сбора документов (см. lib/playbook.ts). До этого coordinator
    // ставил aiPaused только вручную; теперь ИИ может сделать это сам, тем же
    // флагом, которым уже управляет вся остальная логика (webhook, chat-panel).
    if (shouldPause) {
      await updateLead(leadId, { aiPaused: true });
      await addMessage(leadId, "ai", "— ИИ автоматически поставлен на паузу —");
      log.info("processBatch: ИИ поставлен на паузу автоматически (pauseForHumanHandoff)", { leadId });
    }
  } catch (err) {
    // Messages are already safely in history either way, so a failure here should log and stop.
    log.error("Ошибка при обращении к ИИ или отправке ответа в WhatsApp — сообщения пациента сохранены, координатор сможет ответить вручную", {
      leadId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

import { NextResponse } from "next/server";

import {
  addMessage,
  claimOutgoingEcho,
  createDocument,
  createLead,
  findLeadByPhone,
  getLead,
  getMessages,
  hasMessageWithWaId,
  markMessageDeliveryFailed,
  recordWebhookHeartbeat,
  saveMediaAsset,
  updateLead,
} from "@/lib/db";
import { MAX_DOCUMENT_BYTES, resolveMimeType } from "@/lib/documents";
import { fetchMediaBase64, markWhatsAppMessagesRead, sendWhatsAppText, type ReadKey } from "@/lib/evolution";
import { askGemini } from "@/lib/gemini";
import { startTranscription, waitForTranscript, resolveVoiceItems, TRANSCRIPTION_TIMEOUT_MS } from "@/lib/transcription";
import { interBubblePauseMs, readDelayMs, typingDelayMs } from "@/lib/humanize";
import { createLogger, newRequestId, Logger } from "@/lib/logger";
import { resolveWhatsAppJid } from "@/lib/whatsapp-jid";

export const dynamic = "force-dynamic";

const baseLog = createLogger("webhook");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Buffer for grouping incoming messages by leadId
const BATCH_DEBOUNCE_MS = 8000;
// NOTE: module-level state works here because the service runs with WEB_CONCURRENCY=1 (a single Node process).
// If scaled to multiple instances, this needs to be moved to a shared store (e.g., Redis).
const pendingBatches = new Map<string, {
  items: Array<{
    text: string;
    image?: { base64: string; mimeType: string };
    audio?: { base64: string; mimeType: string };
    messageId?: string;
    // Ключ входящего сообщения WhatsApp — чтобы отметить его прочитанным
    // прямо перед ответом (см. markWhatsAppMessagesRead).
    readKey?: ReadKey;
  }>;
  timer: NodeJS.Timeout;
}>();

// Приём вебхуков от Evolution API (Этап 3 плана).
// Формат payload подтверждён по документации/issue-трекеру Evolution API v2:
// { event: "messages.upsert", instance, apikey, data: { key, pushName, message, messageType } }

interface WhatsAppDocumentMeta {
  mimetype?: string;
  fileName?: string;
  title?: string;
  caption?: string;
}

interface EvolutionWebhookBody {
  event?: string;
  apikey?: string;
  data?: {
    // remoteJidAlt/senderPn: когда remoteJid — скрытый идентификатор @lid,
    // настоящий номер приходит здесь (см. lib/whatsapp-jid.ts).
    key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; fromMe?: boolean; id?: string };
    senderPn?: string;
    pushName?: string;
    messageType?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      imageMessage?: { caption?: string };
      audioMessage?: { mimetype?: string; ptt?: boolean; seconds?: number };
      // Файлы (PDF с анализами и т.п.). Evolution может отдавать их как
      // documentMessage или завёрнутыми в documentWithCaptionMessage.
      documentMessage?: WhatsAppDocumentMeta;
      documentWithCaptionMessage?: { message?: { documentMessage?: WhatsAppDocumentMeta } };
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
    remoteJidAlt: body.data?.key?.remoteJidAlt,
    fromMe: body.data?.key?.fromMe,
  });

  // Безусловно, до какой-либо ещё логики — см. lib/db.ts. Если Evolution
  // не вызывает вебхук вообще (обрыв между WhatsApp и самим Evolution),
  // это никогда не обновится, и на /dashboard/settings будет видно
  // "давно", а не молчание без объяснений.
  // Намеренно БЕЗ await: это чисто диагностическая запись, она никогда не
  // должна добавлять задержку (тем более — таймаут на обрыв MongoDB) на
  // путь обработки настоящего сообщения пациента, который и сам не раз
  // упирается в ту же базу.
  recordWebhookHeartbeat(body.event ?? "unknown").catch((err) => {
    log.error("не удалось записать webhook heartbeat", {
      message: err instanceof Error ? err.message : String(err),
    });
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

  if (!key) {
    log.info("5. сообщение пропущено — в событии нет key");
    return { earlyResponse: NextResponse.json({ ok: true, skipped: "no-key" }) };
  }

  // fromMe — исходящее сообщение. Это либо эхо того, что отправила сама CRM/ИИ
  // (такое не сохраняем второй раз), либо реплика, которую координатор
  // написал пациенту прямо с телефона (её нужно показать в переписке).
  // Ни то ни другое никогда не запускает ответ ИИ — зацикливания нет.
  const fromMe = Boolean(key.fromMe);
  log.info(fromMe ? "5. исходящее сообщение (fromMe)" : "5. это входящее сообщение от пациента");

  const resolved = resolveWhatsAppJid({
    remoteJid: key.remoteJid,
    remoteJidAlt: key.remoteJidAlt,
    // У исходящего senderPn — это МЫ, а не собеседник: по нему чат не определить.
    senderPn: fromMe ? undefined : key.senderPn ?? data?.senderPn,
  });

  if (resolved.kind === "ignore") {
    // Группы/рассылки/статусы и мусорные JID — не пациенты. Раньше из
    // любого JID брались "цифры до @" и на группу заводился лид.
    log.info("6. чат пропущен — это не личная переписка с пациентом", {
      reason: resolved.reason,
      remoteJid: key.remoteJid,
    });
    return { earlyResponse: NextResponse.json({ ok: true, skipped: resolved.reason }) };
  }

  if (resolved.kind === "lid") {
    // Ищите в логах Render по "@lid": если такие строки пошли — WhatsApp
    // скрывает номера (типично для Business), а Evolution не передал
    // remoteJidAlt. Ответ на такой JID может не уйти — тогда сработает
    // защита от недоставленных ответов в processBatch (пауза ИИ + пометка).
    log.warn("6. WhatsApp прислал скрытый идентификатор (@lid) без номера телефона", {
      remoteJid: key.remoteJid,
    });
    return { body, phone: resolved.replyTo, fromMe };
  }

  if (key.remoteJid?.endsWith("@lid")) {
    log.info("6. @lid раскрыт до настоящего номера через remoteJidAlt/senderPn", { phone: resolved.phone });
  } else {
    log.info("6. номер телефона извлечён", { phone: resolved.phone });
  }
  return { body, phone: resolved.phone, fromMe };
}

async function extractMessageContent(
  message: NonNullable<EvolutionWebhookBody["data"]>["message"],
  messageType: string,
  key: NonNullable<EvolutionWebhookBody["data"]>["key"],
  requestId: string,
  log: Logger,
  // Документы (PDF) скачиваем только из входящих сообщений пациента: файлы,
  // которые координатор сам отправляет с телефона, в CRM не нужны.
  fetchDocuments = false
) {
  let text = message?.conversation ?? message?.extendedTextMessage?.text ?? "";
  let image: { base64: string; mimeType: string } | undefined;
  let audio: { base64: string; mimeType: string } | undefined;
  let document: { base64: string; mimeType: string; filename: string } | undefined;

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

  // Файл-документ (PDF и т.п.). В диалог с ИИ он не попадает (как и раньше —
  // бот его не «видит»); байты уходят в раздел «Документы» пациента, откуда
  // координатор сам запускает разбор и перевод.
  const documentMeta = message?.documentMessage ?? message?.documentWithCaptionMessage?.message?.documentMessage;
  const isDocumentMessage = messageType === "documentMessage" || messageType === "documentWithCaptionMessage";
  const documentName = documentMeta?.fileName || documentMeta?.title || "document";
  if (fetchDocuments && isDocumentMessage && documentMeta) {
    try {
      const media = await fetchMediaBase64(key, requestId);
      const mimeType = resolveMimeType(media.mimetype || documentMeta.mimetype, documentName);
      if (!mimeType) {
        log.info("7c. документ неподдерживаемого типа — в «Документы» не сохраняем", {
          mimetype: media.mimetype || documentMeta.mimetype,
        });
      } else if (media.base64.length * 0.75 > MAX_DOCUMENT_BYTES) {
        log.info("7c. документ больше лимита — в «Документы» не сохраняем", { base64Length: media.base64.length });
      } else {
        document = { base64: media.base64, mimeType, filename: documentName };
      }
    } catch (err) {
      log.error("7c. не удалось скачать документ из Evolution API", {
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
      : isDocumentMessage && documentMeta
      ? `📄 [документ: ${documentName}]`
      : "[неподдерживаемый тип сообщения]");

  return { text, storedText, image, audio, document };
}

// Сообщение, которое координатор написал пациенту с телефона (или эхо того,
// что мы сами отправили). Лид НЕ создаём: на телефоне координатора живёт и
// личная переписка, и ей не место в CRM — лид заводится только входящим
// сообщением пациента.
async function processOutgoingMessage(
  phone: string,
  data: NonNullable<EvolutionWebhookBody["data"]>,
  requestId: string,
  log: Logger
) {
  const key = data.key as NonNullable<EvolutionWebhookBody["data"]>["key"];
  const waId = key?.id;

  const lead = await findLeadByPhone(phone);
  if (!lead) {
    log.info("out. чат не из CRM (лида с таким номером нет) — исходящее не сохраняем");
    return NextResponse.json({ ok: true, skipped: "unknown-chat" });
  }

  // Повторная доставка того же события.
  if (waId && (await hasMessageWithWaId(lead.id, waId))) {
    log.info("out. это сообщение уже есть в переписке (по id WhatsApp)", { leadId: lead.id });
    return NextResponse.json({ ok: true, skipped: "duplicate" });
  }

  // Эхо того, что отправила сама CRM или ИИ.
  const plainText = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";
  if (waId && plainText && (await claimOutgoingEcho(lead.id, plainText, waId))) {
    log.info("out. это эхо сообщения, отправленного из CRM/ИИ — второй раз не сохраняем", {
      leadId: lead.id,
    });
    return NextResponse.json({ ok: true, skipped: "crm-echo" });
  }

  const messageType = data.messageType ?? "";
  const { text, storedText, image, audio } = await extractMessageContent(
    data.message,
    messageType,
    key,
    requestId,
    log
  );

  // Реакции, удаления, служебные события и т.п. — не реплики диалога.
  const label =
    text || image || audio
    ? storedText
    : messageType === "imageMessage"
    ? "📎 [изображение]"
    : messageType === "audioMessage"
    ? "🎤 [голосовое сообщение]"
    : null;
  if (!label) {
    log.info("out. исходящее без текста/фото/голосового — пропускаем", { messageType });
    return NextResponse.json({ ok: true, skipped: "unsupported" });
  }

  const saved = await addMessage(
    lead.id,
    "coordinator",
    label + (image ? " (+фото)" : "") + (audio ? " (+голосовое)" : ""),
    image
      ? { kind: "image", mimeType: image.mimeType }
      : audio
      ? { kind: "audio", mimeType: audio.mimeType }
      : undefined,
    { waId }
  );
  log.info("out. сообщение координатора с телефона сохранено в переписку", {
    leadId: lead.id,
    hasMedia: Boolean(image || audio),
  });

  try {
    if (image) {
      await saveMediaAsset({
        leadId: lead.id,
        messageId: saved.id,
        kind: "image",
        mimeType: image.mimeType,
        base64: image.base64,
      });
    } else if (audio) {
      await saveMediaAsset({
        leadId: lead.id,
        messageId: saved.id,
        kind: "audio",
        mimeType: audio.mimeType,
        base64: audio.base64,
      });
    }
  } catch (err) {
    log.error("out. не удалось сохранить медиа исходящего сообщения — текстовая запись осталась", {
      leadId: lead.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: true, saved: "coordinator-phone" });
}

async function processNewMessage(
  phone: string,
  data: NonNullable<EvolutionWebhookBody["data"]>,
  text: string,
  storedText: string,
  image: { base64: string; mimeType: string } | undefined,
  audio: { base64: string; mimeType: string } | undefined,
  document: { base64: string; mimeType: string; filename: string } | undefined,
  log: Logger
) {
  // 1) Проверяем, существует ли номер в базе — если нет, заводим лид «Новый».
  let lead = await findLeadByPhone(phone);
  if (!lead) {
    log.info("8. лид с таким номером не найден — создаём новый", { phone, pushName: data?.pushName });
    lead = await createLead({
      name: data?.pushName || (phone.endsWith("@lid") ? "Контакт WhatsApp (номер скрыт)" : phone),
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
  // текстовую пометку "(+фото)". Обёрнуто в try/catch: ошибка записи сюда
  // не должна ломать ответ пациенту — в худшем случае просто не сохранится
  // копия медиа, как и было раньше.
  try {
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
      startTranscription(savedMessage.id, audio);
    }
  } catch (err) {
    log.error("9a. не удалось сохранить медиа в MediaAssets — продолжаем без сохранения копии", {
      leadId: lead.id,
      messageId: savedMessage.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // PDF/файл от пациента → раздел «Документы» (статус «new»: разбор запускает
  // координатор кнопкой, чтобы не тратить токены на каждый присланный файл).
  // Ошибка здесь не должна ломать ответ пациенту.
  if (document) {
    try {
      const created = await createDocument({
        leadId: lead.id,
        filename: document.filename,
        mimeType: document.mimeType,
        data: Buffer.from(document.base64, "base64"),
        source: "whatsapp",
        status: "new",
      });
      log.info("9b. документ сохранён в «Документы»", {
        leadId: lead.id,
        documentId: created.document.id,
        duplicate: created.duplicate,
      });
    } catch (err) {
      log.error("9b. не удалось сохранить документ в «Документы» — продолжаем", {
        leadId: lead.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
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

  const incomingKey = data.key;
  batch.items.push({
    text,
    image,
    audio,
    messageId: savedMessage.id,
    readKey: incomingKey?.id && incomingKey.remoteJid ? { id: incomingKey.id, remoteJid: incomingKey.remoteJid } : undefined,
  });
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

  const { body, phone, fromMe } = validationResult;
  const data = body.data as NonNullable<EvolutionWebhookBody["data"]>;

  if (fromMe) {
    try {
      return await processOutgoingMessage(phone, data, requestId, log);
    } catch (err) {
      log.error("Не удалось обработать исходящее сообщение (с телефона координатора)", {
        phone,
        messageType: data.messageType,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return NextResponse.json({ ok: false, error: "internal-error" }, { status: 500 });
    }
  }

  try {
    const { text, storedText, image, audio, document } = await extractMessageContent(
      data.message,
      data.messageType ?? "",
      data.key,
      requestId,
      log,
      true
    );

    return await processNewMessage(phone, data, text, storedText, image, audio, document, log);
  } catch (err) {
    // Раньше падение здесь (например, обрыв соединения с MongoDB) уходило
    // необработанным — сообщение терялось целиком, даже не сохранившись,
    // без единого следа в CRM, кроме сырого стека в логах Render. Логируем
    // явно, с телефоном и текстом — это единственное место, где контент
    // ещё можно восстановить руками, раз он не попал в базу.
    log.error("Не удалось обработать входящее сообщение — оно нигде не сохранено", {
      phone,
      text: data.message?.conversation ?? data.message?.extendedTextMessage?.text,
      messageType: data.messageType,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ ok: false, error: "internal-error" }, { status: 500 });
  }
}

// Системные пометки в переписке ("— ИИ поставлен на паузу —" и т.п.) — это
// не реплики диалога, в контекст Gemini они не должны попадать.
function isSystemNote(text: string): boolean {
  return text.startsWith("— ") && text.endsWith(" —");
}

async function addSystemNote(leadId: string, text: string, log: Logger) {
  try {
    await addMessage(leadId, "ai", text);
  } catch (err) {
    log.error("не удалось записать системную пометку в переписку", {
      leadId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// Сама обработка вынесена отдельно, а processBatch ниже — тонкая обёртка с
// общим try/catch: эта функция вызывается из setTimeout, и любое
// необработанное исключение там — это unhandled rejection без единого
// следа для координатора.
async function processBatchInner(leadId: string, phone: string, log: Logger, requestId: string) {
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

  // Resolve voice items before asking Gemini (waiting for transcription)
  const resolvedItems = await resolveVoiceItems(items, {
    waitForTranscript,
    timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
  });

  // 1) Ответ ИИ. Если Gemini не ответил — координатор должен увидеть это в
  // переписке, а не гадать, почему бот молчит.
  let replyMessages: string[];
  let shouldPause: boolean;
  let suppressed: "empty" | "duplicate" | "arabic-script" | undefined;
  try {
    // Пометки и недоставленные ответы в контекст не берём: пациент их не
    // видел, а модель иначе будет считать, что уже это сказала.
    const history = (await getMessages(leadId)).filter((m) => !m.deliveryFailed && !isSystemNote(m.text));
    // Remove the latest `items.length` messages from the context sent to Gemini,
    // because those are the buffered ones we are passing explicitly in `items` with full image data.
    const olderHistory = items.length > 0 ? history.slice(0, -items.length) : history;
    log.info("processBatch: история переписки загружена для контекста Gemini", {
      leadId,
      totalMessages: history.length,
      olderHistoryMessages: olderHistory.length,
    });

    const result = await askGemini({ history: olderHistory, items: resolvedItems, requestId });
    replyMessages = result.messages;
    shouldPause = result.handoff;
    suppressed = result.suppressed;
    log.info("processBatch: Gemini вернул ответ", {
      leadId,
      bubbles: replyMessages.length,
      language: result.language,
      shouldPause,
      suppressed,
    });
  } catch (err) {
    log.error("processBatch: ИИ не смог сформировать ответ — сообщения пациента сохранены, нужен ответ вручную", {
      leadId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    await addSystemNote(leadId, "— ИИ не смог ответить на последнее сообщение (сбой сервиса). Ответьте вручную —", log);
    return;
  }

  // Отправлять нечего: модель дважды подряд не дала текста либо могла бы
  // только повторить уже сказанное. Вместо жёсткой «запасной» фразы (которая
  // уходила всем одинаковой и сразу выдавала бота) — передаём диалог
  // координатору с понятной пометкой.
  if (replyMessages.length === 0) {
    await updateLead(leadId, { aiPaused: true });
    await addSystemNote(
      leadId,
      shouldPause
        ? "— ИИ автоматически поставлен на паузу —"
        : suppressed === "duplicate"
        ? "— ИИ мог только повторить уже сказанное. ИИ поставлен на паузу — ответьте вручную —"
        : suppressed === "arabic-script"
        ? "— Ответ ИИ получился с арабскими буквами и не отправлен. ИИ поставлен на паузу — ответьте вручную —"
        : "— ИИ не сформировал ответ. ИИ поставлен на паузу — ответьте вручную —",
      log
    );
    log.warn("processBatch: отправлять нечего — ИИ поставлен на паузу, диалог у координатора", {
      leadId,
      suppressed,
      shouldPause,
    });
    return;
  }

  // 2) Отправка пузырями, как печатает живой человек: у каждого сообщения —
  // своё «печатает…» (параметр delay в Evolution API, время зависит от
  // длины). Каждый пузырь сохраняем в историю ПЕРЕД отправкой, поэтому в
  // CRM видно ровно то, что реально пытались отправить. Раньше ошибка здесь
  // только уходила в лог Render — в CRM ответ выглядел доставленным; теперь:
  // пометка "не доставлено" на конкретном пузыре, пауза ИИ (повторять
  // попытки на каждое сообщение бессмысленно — обычно это проблема канала
  // или адресации, а не случайный сбой) и явная пометка для координатора.
  let delivered = 0;
  let interrupted = false;

  // «Прочитано» → короткая пауза → «печатает…» → текст: так отвечает человек.
  // Отмечаем только теперь, когда ответ точно будет отправлен: если бот
  // промолчал или сломался, чат остаётся непрочитанным на телефоне
  // координатора. Сбой тут не мешает ответу (функция не бросает ошибок).
  const readKeys = items.flatMap((item) => (item.readKey ? [item.readKey] : []));
  if (await markWhatsAppMessagesRead(readKeys, requestId)) {
    await sleep(readDelayMs());
  }

  for (let i = 0; i < replyMessages.length; i++) {
    const bubble = replyMessages[i];

    // Пока бот «печатал», пациент мог дописать или координатор — перехватить
    // диалог. Живой человек в этом случае не договаривает заготовленное, а
    // читает новое — поэтому оставшиеся пузыри не отправляем (новое
    // сообщение пациента уже обработает свежая пачка с актуальной историей).
    if (i > 0) {
      let coordinatorTookOver = false;
      try {
        coordinatorTookOver = Boolean((await getLead(leadId))?.aiPaused);
      } catch {
        // сбой чтения не должен рвать отправку — просто продолжаем
      }
      if (pendingBatches.has(leadId) || coordinatorTookOver) {
        log.info("processBatch: отправка прервана — новое сообщение пациента или ИИ поставлен на паузу", {
          leadId,
          sent: i,
          total: replyMessages.length,
          newPatientMessage: pendingBatches.has(leadId),
          coordinatorTookOver,
        });
        interrupted = true;
        break;
      }
    }

    const saved = await addMessage(leadId, "ai", bubble);
    try {
      const typingMs = typingDelayMs(bubble);
      const sendStartedAt = Date.now();
      await sendWhatsAppText(phone, bubble, requestId, { typingDelayMs: typingMs });
      delivered++;

      // Пауза до следующего пузыря — на нашей стороне, а не на совести шлюза
      // (см. interBubblePauseMs): иначе все пузыри уходят одновременно.
      if (i < replyMessages.length - 1) {
        const pauseMs = interBubblePauseMs(typingMs, Date.now() - sendStartedAt);
        log.info("processBatch: пауза перед следующим сообщением", { leadId, bubbleIndex: i, pauseMs });
        await sleep(pauseMs);
      }
    } catch (err) {
      log.error("processBatch: не удалось отправить ответ пациенту через Evolution API", {
        leadId,
        phone,
        bubbleIndex: i,
        delivered,
        message: err instanceof Error ? err.message : String(err),
      });
      try {
        await markMessageDeliveryFailed(saved.id);
        await updateLead(leadId, { aiPaused: true });
      } catch (markErr) {
        log.error("processBatch: не удалось пометить сообщение как недоставленное", {
          leadId,
          message: markErr instanceof Error ? markErr.message : String(markErr),
        });
      }
      await addSystemNote(leadId, "— Ответ ИИ не доставлен в WhatsApp. ИИ поставлен на паузу — ответьте вручную —", log);
      return;
    }
  }
  log.info("processBatch: ответ отправлен пациенту через Evolution API", {
    phone,
    delivered,
    total: replyMessages.length,
    interrupted,
  });

  if (lead.stage === "new") {
    await updateLead(leadId, { stage: "first_contact" });
    log.info("processBatch: статус лида обновлён new → first_contact", { leadId });
  }

  // Модель сама решает, когда передать диалог координатору — обычно
  // сразу после сбора документов (см. lib/playbook.ts). До этого coordinator
  // ставил aiPaused только вручную; теперь ИИ может сделать это сам, тем же
  // флагом, которым уже управляет вся остальная логика (webhook, chat-panel).
  // Если отправку прервало новое сообщение пациента, финальную фразу мы не
  // договорили — паузу не ставим, пусть следующий ход решит заново.
  if (shouldPause && !interrupted) {
    await updateLead(leadId, { aiPaused: true });
    await addMessage(leadId, "ai", "— ИИ автоматически поставлен на паузу —");
    log.info("processBatch: ИИ поставлен на паузу автоматически (handoff)", { leadId });
  }
}

async function processBatch(leadId: string, phone: string) {
  const requestId = newRequestId();
  const log = baseLog.child(requestId);
  try {
    await processBatchInner(leadId, phone, log, requestId);
  } catch (err) {
    log.error("processBatch: необработанная ошибка — сообщения пациента сохранены, координатор сможет ответить вручную", {
      leadId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

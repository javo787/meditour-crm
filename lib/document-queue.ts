import { buildWarnings, looksLikeRealName, transliterate } from "@/lib/documents";
import {
  claimNextDocument,
  completeDocument,
  failDocument,
  getDossierProfile,
  getLead,
  hasQueuedDocuments,
} from "@/lib/db";
import { extractMedicalDocument } from "@/lib/gemini";
import { createLogger, newRequestId } from "@/lib/logger";

const log = createLogger("document-queue");

// Фоновая обработка документов на самом сервере Render: запрос на загрузку
// возвращается сразу, а разбор идёт по одному файлу. Очередь живёт в Mongo
// (статус pending/processing), поэтому перезапуск сервиса её не теряет:
// зависшие «processing» старше 10 минут снова берутся в работу, а запускается
// очередь при любом обращении к списку документов (см. ensureDocumentQueue).

let running = false;

export function kickDocumentQueue(): void {
  if (running) return;
  running = true;
  void runLoop()
    .catch((err) => {
      log.error("Очередь документов упала", { message: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      running = false;
    });
}

/** Запускает очередь, только если в ней что-то есть (после рестарта сервиса). */
export async function ensureDocumentQueue(): Promise<void> {
  if (running) return;
  if (await hasQueuedDocuments()) kickDocumentQueue();
}

async function runLoop(): Promise<void> {
  // Предохранитель от бесконечного цикла на случай ошибки в логике очереди.
  for (let i = 0; i < 500; i++) {
    const doc = await claimNextDocument();
    if (!doc) return;
    await processOne(doc);
  }
}

async function processOne(doc: NonNullable<Awaited<ReturnType<typeof claimNextDocument>>>): Promise<void> {
  const requestId = newRequestId();
  const logger = log.child(requestId);
  try {
    // Имя пациента латиницей подсказывается модели: из профиля досье, а если
    // его нет — из транслитерации имени лида (когда оно похоже на настоящее ФИО).
    const [lead, profile] = await Promise.all([getLead(doc.leadId), getDossierProfile(doc.leadId)]);
    const patientName =
      profile.name?.trim() || (lead && looksLikeRealName(lead.name) ? transliterate(lead.name) : undefined);

    const extracted = await extractMedicalDocument({
      base64: doc.data.toString("base64"),
      mimeType: doc.mimeType,
      patientName,
      requestId,
    });
    const warnings = buildWarnings({ extracted, leadName: lead?.name, profileName: profile.name });
    await completeDocument(doc.id, { ...extracted, warnings });
    logger.info("Документ разобран", {
      documentId: doc.id,
      category: extracted.category,
      warnings: warnings.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Не удалось разобрать документ", { documentId: doc.id, attempts: doc.attempts, message });
    await failDocument(doc.id, message, doc.attempts);
  }
}

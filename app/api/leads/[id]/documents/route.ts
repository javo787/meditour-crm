import { NextResponse } from "next/server";

import { createDocument, getDocuments, getLead } from "@/lib/db";
import { ensureDocumentQueue, kickDocumentQueue } from "@/lib/document-queue";
import { MAX_DOCUMENT_BYTES, resolveMimeType } from "@/lib/documents";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("documents");

// Доступ закрыт middleware.ts (matcher включает /api/leads/*).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) return NextResponse.json({ error: "Лид не найден" }, { status: 404 });

  // После перезапуска сервиса очередь сама не стартует — поднимаем её, как
  // только кто-то открыл карточку и в базе есть неразобранные документы.
  await ensureDocumentQueue();
  return NextResponse.json({ documents: await getDocuments(params.id) });
}

// Принимает один или несколько файлов (поле «files»). Клиент шлёт их по
// одному — на мобильном интернете один огромный запрос ненадёжен.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) return NextResponse.json({ error: "Лид не найден" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => typeof f !== "string");
  if (files.length === 0) {
    return NextResponse.json({ error: "Файлы не получены" }, { status: 400 });
  }

  const documents = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  let duplicates = 0;

  for (const file of files) {
    const mimeType = resolveMimeType(file.type, file.name);
    if (!mimeType) {
      rejected.push({ name: file.name, reason: "Неподдерживаемый тип (нужны фото или PDF)" });
      continue;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      rejected.push({ name: file.name, reason: "Файл больше 10 МБ" });
      continue;
    }
    const { document, duplicate } = await createDocument({
      leadId: params.id,
      filename: file.name || "document",
      mimeType,
      data: Buffer.from(await file.arrayBuffer()),
      source: "upload",
      status: "pending",
    });
    if (duplicate) duplicates++;
    else documents.push(document);
  }

  if (documents.length > 0) kickDocumentQueue();
  log.info("Загружены документы", { leadId: params.id, added: documents.length, duplicates, rejected: rejected.length });
  return NextResponse.json({ documents, duplicates, rejected });
}

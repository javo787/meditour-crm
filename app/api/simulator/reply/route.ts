import { NextResponse } from "next/server";
import { z } from "zod";

import { askGemini } from "@/lib/gemini";
import { createLogger, newRequestId } from "@/lib/logger";
import type { ChatMessage } from "@/lib/types";

export const dynamic = "force-dynamic";
// Ответ ИИ с повторами и запасными моделями может занять заметное время.
export const maxDuration = 60;

const log = createLogger("simulator");

const turnSchema = z.object({
  from: z.enum(["patient", "ai"]),
  text: z.string().max(4000),
});

const bodySchema = z.object({
  history: z.array(turnSchema).max(80),
  message: z
    .object({
      text: z.string().max(2000),
      image: z
        .object({
          base64: z.string().max(7_000_000),
          mimeType: z.string().regex(/^image\//),
        })
        .optional(),
    })
    .refine((m) => m.text.trim().length > 0 || Boolean(m.image)),
});

/**
 * Ответ ИИ на реплику «пациента» — тем же кодом (askGemini), что и в боевом
 * режиме, но без записи в БД и без отправки в WhatsApp. История приходит от
 * клиента: на сервере песочница ничего не хранит.
 */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const logger = log.child(requestId);

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const { history, message } = parsed.data;

  const now = new Date().toISOString();
  const chatHistory: ChatMessage[] = history.map((t, i) => ({
    id: `sim-${i}`,
    leadId: "simulator",
    from: t.from,
    text: t.text,
    at: now,
  }));

  const started = Date.now();
  try {
    const result = await askGemini({
      history: chatHistory,
      items: [{ text: message.text, image: message.image }],
      requestId,
    });
    return NextResponse.json({
      messages: result.messages,
      handoff: result.handoff,
      language: result.language ?? null,
      suppressed: result.suppressed ?? null,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    logger.error("simulator: ИИ не смог сформировать ответ", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "ИИ не смог ответить (сбой сервиса). Попробуйте ещё раз." },
      { status: 502 }
    );
  }
}

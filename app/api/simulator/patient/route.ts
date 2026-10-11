import { NextResponse } from "next/server";
import { z } from "zod";

import { askPatientSimulator } from "@/lib/gemini";
import { createLogger, newRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = createLogger("simulator");

const bodySchema = z.object({
  persona: z.string().trim().min(1).max(1500),
  language: z.enum(["ru", "tg", "uz"]),
  transcript: z
    .array(z.object({ from: z.enum(["patient", "ai"]), text: z.string().max(4000) }))
    .max(80),
});

/** Следующая реплика «автопациента» по заданной роли. */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  try {
    const reply = await askPatientSimulator({ ...parsed.data, requestId });
    return NextResponse.json(reply);
  } catch (err) {
    log.child(requestId).error("simulator: не удалось сгенерировать реплику пациента", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Не удалось сгенерировать реплику пациента. Попробуйте ещё раз." },
      { status: 502 }
    );
  }
}

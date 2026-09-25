import { NextResponse } from "next/server";
import { z } from "zod";
import { addMessage, getLead, getMessages } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/evolution";
import { createLogger, newRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("leads-messages");

const bodySchema = z.object({ text: z.string().min(1).max(2000) });

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const lead = await getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }
  return NextResponse.json({ messages: await getMessages(params.id) });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const requestId = newRequestId();
  const logger = log.child(requestId);

  const lead = await getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 });
  }

  // Сохраняем в историю сразу — координатор должен видеть свою реплику,
  // даже если следующий шаг (реальная отправка в WhatsApp) не удастся.
  const message = await addMessage(params.id, "coordinator", parsed.data.text);
  logger.info("Ручное сообщение координатора сохранено в историю", {
    leadId: params.id,
  });

  // Раньше на этом всё и заканчивалось — сообщение оседало в базе и
  // показывалось в интерфейсе, но в Evolution API никогда не уходило,
  // поэтому пациент в WhatsApp его не получал.
  try {
    await sendWhatsAppText(lead.phone, parsed.data.text, requestId);
    logger.info("Ручное сообщение координатора отправлено через Evolution API", {
      leadId: params.id,
      phone: lead.phone,
    });
  } catch (err) {
    logger.error("Не удалось отправить ручное сообщение координатора через Evolution API", {
      leadId: params.id,
      phone: lead.phone,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        message,
        error: "Сообщение сохранено, но не доставлено в WhatsApp — проверьте Evolution API",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ message });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { addMessage, getLead, getMessages } from "@/lib/db";

const bodySchema = z.object({ text: z.string().min(1).max(2000) });

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const lead = getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }
  return NextResponse.json({ messages: getMessages(params.id) });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const lead = getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 });
  }
  const message = addMessage(params.id, "coordinator", parsed.data.text);
  return NextResponse.json({ message });
}

import { NextResponse } from "next/server";

import { getPlan } from "@/lib/plans/db";
import { buildPlanPdf, planPdfFilename } from "@/lib/plans/pdf";

export const dynamic = "force-dynamic";

// PDF собирается на лету и нигде не хранится. Черновик получает водяной знак и суффикс _DRAFT в имени файла.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const plan = await getPlan(params.id);
  if (!plan) return NextResponse.json({ error: "План не найден" }, { status: 404 });
  if (!plan.content) {
    return NextResponse.json({ error: "В плане пока нет содержимого для PDF", code: "no-content" }, { status: 409 });
  }

  const pdf = await buildPlanPdf({ content: plan.content, options: plan.options, status: plan.status });
  const filename = planPdfFilename({
    patientName: plan.content.patient.name,
    date: plan.options.date,
    status: plan.status,
  });
  const download = new URL(request.url).searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

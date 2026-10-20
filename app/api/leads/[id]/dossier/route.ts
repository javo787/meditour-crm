import { NextResponse } from "next/server";
import { z } from "zod";

import { getDocuments, getDossierProfile, getLead } from "@/lib/db";
import { looksLikeRealName, transliterate } from "@/lib/documents";
import { prepareDossier } from "@/lib/dossier";
import { buildDossierPdf } from "@/lib/dossier-pdf";
import { createLogger, newRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("dossier");

const querySchema = z.object({
  name: z.string().trim().max(80).optional(),
  dob: z.string().trim().max(30).optional(),
  gender: z.enum(["Male", "Female"]).optional(),
  force: z.literal("1").optional(),
});

// Один PDF на пациента: все включённые переведённые документы. Собирается
// на лету и нигде не хранится — второй копии медданных не появляется.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const logger = log.child(newRequestId());

  const lead = await getLead(params.id);
  if (!lead) return NextResponse.json({ error: "Лид не найден" }, { status: 404 });

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    name: url.searchParams.get("name") || undefined,
    dob: url.searchParams.get("dob") || undefined,
    gender: url.searchParams.get("gender") || undefined,
    force: url.searchParams.get("force") || undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });

  const data = prepareDossier(await getDocuments(params.id));

  if (data.sections.length === 0 && data.imaging.length === 0) {
    return NextResponse.json(
      { error: "Нет разобранных документов для PDF. Загрузите документы и дождитесь разбора." },
      { status: 400 }
    );
  }
  if (data.inProgress > 0) {
    return NextResponse.json(
      { error: `Ещё идёт разбор документов: ${data.inProgress}. Дождитесь окончания.`, code: "in-progress" },
      { status: 409 }
    );
  }
  // Всё, что стоит перепроверить перед отправкой врачам, — одним подтверждением.
  const problems: string[] = [];
  if (data.duplicates.length > 0) {
    problems.push(
      `возможные дубли: ${data.duplicates.map(([a, b]) => `разделы ${a} и ${b}`).join(", ")}`
    );
  }
  if (data.unreviewed > 0) problems.push(`не проверено документов: ${data.unreviewed}`);
  if (problems.length > 0 && !parsed.data.force) {
    return NextResponse.json(
      { error: `Перед отправкой стоит проверить: ${problems.join("; ")}`, code: "needs-confirmation", problems },
      { status: 409 }
    );
  }

  // Что не пришло в запросе — берём из сохранённого профиля досье.
  const profile = await getDossierProfile(params.id);
  const name =
    parsed.data.name || profile.name || (looksLikeRealName(lead.name) ? transliterate(lead.name) : "");
  const pdf = await buildDossierPdf(
    {
      name,
      dateOfBirth: parsed.data.dob || profile.dob || undefined,
      gender: parsed.data.gender || profile.gender,
    },
    data
  );
  logger.info("PDF-досье собран", {
    leadId: params.id,
    sections: data.sections.length,
    imaging: data.imaging.length,
    bytes: pdf.length,
  });

  const safeName = (name || "patient").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "patient";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Dossier_${safeName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

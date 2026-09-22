import { NextResponse } from "next/server";
import { getLead } from "@/lib/db";

// Заглушка вместо вызова Gemini 1.5 Flash (Этап 4 плана). Формирует
// англоязычный Medical Opinion Request по данным карточки лида, чтобы
// интерфейс Этапа 2 можно было проверить целиком уже сейчас.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const lead = getLead(params.id);
  if (!lead) {
    return NextResponse.json({ error: "Лид не найден" }, { status: 404 });
  }

  const procedures = lead.anamnesis?.proceduresDone?.length
    ? lead.anamnesis.proceduresDone.join(", ")
    : "not specified yet";

  const text = [
    "MEDICAL OPINION REQUEST",
    "",
    "Referring coordinator: Meditour",
    `Patient reference: ${lead.id}`,
    `Age: ${lead.anamnesis?.age ?? "not specified"}`,
    `Working diagnosis (per referring physician): ${lead.diagnosis}`,
    `Diagnostics already performed: ${procedures}`,
    "",
    `Case summary: ${
      lead.anamnesis?.summary ?? "Anamnesis is still being collected with the patient."
    }`,
    "",
    "Requested from receiving hospital:",
    "1) Confirmation or refinement of the diagnosis based on the attached documents.",
    "2) A recommended treatment plan with an estimated cost breakdown.",
    "3) Estimated length of hospital stay and required post-treatment follow-up.",
  ].join("\n");

  return NextResponse.json({ text });
}

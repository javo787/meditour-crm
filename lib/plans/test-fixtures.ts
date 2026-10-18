// Вымышленные данные для тестов плана. Ни одно имя, клиника, врач или сайт здесь не настоящие.
import { contentFromDraft } from "./defaults";
import type { PlanContent, PlanDraft } from "./schema";

// Английское письмо: цитируется в тестах дословно.
export const FICTIONAL_LETTER = [
  "Dear Sir/Madam,",
  "",
  "Thank you for sharing the reports of Mr. Testov Test, 52 years old. We have reviewed them with our medical team.",
  "",
  "Diagnosis: kidney stones in both kidneys, the largest stone 14 mm on the right side. No active infection at present.",
  "",
  "Recommended plan:",
  "1. Repeat CT scan (non-contrast) and urine culture on arrival.",
  "2. Consultation with a urologist.",
  "3. Minimally invasive stone removal (RIRS) if the repeat scan confirms the stones.",
  "",
  "Hospitals and doctors:",
  "1. Example Hospital A, Faridabad - Dr. Anna Example, Head of Urology, 20 years of experience.",
  "2. Example Hospital B, Gurugram - Dr. Boris Sample, Senior Consultant Urologist.",
  "3. Example Hospital C, Bengaluru - Dr. Clara Demo, Consultant Urologist.",
  "Know more about the hospitals: https://example.org/hospitals",
  "",
  "Estimated cost of treatment (RIRS, shared room):",
  "Example Hospital A - USD 6800",
  "Example Hospital B - USD 7200",
  "Example Hospital C - USD 6400",
  "",
  "Initial evaluation (CT scan, blood and urine tests, consultation): USD 500-USD 800",
  "Additional stent removal visit, if required: USD 80-90 per visit",
  "",
  "Duration of stay:",
  "Hospitalization 2-3 days. Stay in India before the procedure 3-4 days. Stay after discharge 7 days. Total stay in India approximately 2 weeks.",
  "",
  "The package includes doctor consultations, tests, the procedure, hospital stay with meals and medicines. It does not include flights and hotel stay outside the hospital.",
  "",
  "Warm regards,",
  "International Patient Desk",
].join("\n");

// Черновик, согласованный с письмом (неразрывный пробел в суммах — как в форме).
export function fictionalDraft(): PlanDraft {
  return {
    patient: { name: "Testov Test", gender: "male" },
    profile: { specialty: "Урология", condition: "камни в почках" },
    overview: [
      "Камни в обеих почках; крупнейший камень — 14 мм, справа.",
      "Признаков активной инфекции на данный момент нет.",
      "Документы рассмотрены медицинской командой госпиталя.",
    ],
    diagnosis: {
      text: "Камни в обеих почках; крупнейший камень — 14 мм, справа",
      state: "Признаков активной инфекции нет",
      tactic: "Малоинвазивное удаление камней (RIRS), если повторное КТ подтвердит камни",
      status: "Требуется повторное КТ без контраста для подтверждения",
    },
    indiaSteps: [
      "Повторная КТ без контраста и посев мочи по прибытии",
      "Консультация уролога",
      "Малоинвазивное удаление камней (RIRS), если повторная КТ подтвердит камни",
    ],
    tactic: {
      intro: "Возможен вариант малоинвазивного удаления камней (RIRS) по итогам повторного обследования.",
      items: [
        { title: "Повторное обследование", text: "КТ без контраста и анализ мочи по прибытии в Индию." },
        { title: "Удаление камней", text: "Малоинвазивная процедура RIRS, если повторная КТ подтвердит камни." },
      ],
    },
    documents: { title: "", items: [] },
    approach: { title: "", paragraphs: [], items: [], note: "" },
    clinics: [
      {
        id: "c1",
        name: "Example Hospital A",
        shortName: "Example A",
        city: "Фаридабад",
        area: "Дели NCR",
        doctor: "Dr. Anna Example — руководитель отделения урологии",
        why: "Руководитель отделения урологии, 20 лет опыта.",
      },
      {
        id: "c2",
        name: "Example Hospital B",
        shortName: "Example B",
        city: "Гургаон",
        area: "Дели NCR",
        doctor: "Dr. Boris Sample — ведущий консультант-уролог",
        why: "Старший консультант-уролог госпиталя.",
      },
      {
        id: "c3",
        name: "Example Hospital C",
        shortName: "Example C",
        city: "Бангалор",
        area: "",
        doctor: "Dr. Clara Demo — консультант-уролог",
        why: "Консультант-уролог госпиталя.",
      },
    ],
    costs: {
      groups: [
        {
          title: "Лечение (RIRS, двухместная палата) — варианты по госпиталям",
          note: "Варианты по госпиталям — выбирается один; стоимости не суммируются.",
          rows: [
            { label: "RIRS, двухместная палата", clinicId: "c1", amount: `6 800`, evidence: "Example Hospital A - USD 6800" },
            { label: "RIRS, двухместная палата", clinicId: "c2", amount: `7 200`, evidence: "Example Hospital B - USD 7200" },
            { label: "RIRS, двухместная палата", clinicId: "c3", amount: `6 400`, evidence: "Example Hospital C - USD 6400" },
          ],
        },
        {
          title: "Дополнительные расходы (при необходимости)",
          note: "",
          rows: [
            {
              label: "Первичное обследование (КТ, анализы крови и мочи, консультация)",
              clinicId: "",
              amount: "500 – 800",
              evidence: "Initial evaluation (CT scan, blood and urine tests, consultation): USD 500-USD 800",
            },
            {
              label: "Повторный визит для удаления стента",
              clinicId: "",
              amount: "80 – 90 / визит",
              evidence: "Additional stent removal visit, if required: USD 80-90 per visit",
            },
          ],
        },
      ],
      footnote: "",
    },
    stay: {
      rows: [
        { label: "Госпитализация", value: "2–3 дня", total: false },
        { label: "Пребывание до процедуры", value: "3–4 дня", total: false },
        { label: "Пребывание после выписки", value: "7 дней", total: false },
        { label: "Ориентировочное общее пребывание в Индии", value: "≈ 2 недели", total: true },
      ],
      note: "",
    },
    included: [
      "Консультации врачей, анализы, процедуру",
      "Пребывание в госпитале с питанием и лекарствами",
    ],
    notIncluded: "перелёт и проживание вне госпиталя",
    letterIssues: [],
  };
}

// То же, плюс необязательные разделы «НЕОБХОДИМЫЕ ДОКУМЕНТЫ» и «ПРЕДЛАГАЕМЫЙ ПОДХОД».
export function fullDraft(): PlanDraft {
  return {
    ...fictionalDraft(),
    documents: {
      title: "НЕОБХОДИМЫЕ ДОКУМЕНТЫ",
      items: ["Выписки и заключения предыдущих обследований", "Снимки КТ и результаты анализов мочи"],
    },
    approach: {
      title: "ПРЕДЛАГАЕМЫЙ ПОДХОД",
      paragraphs: ["Схема подбирается после просмотра документов и очной оценки в госпитале."],
      items: [{ title: "Этапы", text: "Обследование, решение о тактике, процедура и наблюдение." }],
      note: "Окончательный подход определяет лечащий врач госпиталя.",
    },
  };
}

export function fictionalContent(): PlanContent {
  const content = contentFromDraft(fictionalDraft());
  content.fixed.flights.checkedOn = "2026-10-01";
  return content;
}

export function fullContent(): PlanContent {
  const content = contentFromDraft(fullDraft());
  content.fixed.flights.checkedOn = "2026-10-01";
  return content;
}

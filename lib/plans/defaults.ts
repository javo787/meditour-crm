// Тексты формуляра по умолчанию и пустые значения для нового плана.
// Тексты взяты из формуляров владельца и спецификации: менять их нельзя без согласования с владельцем.
import { formatMonthYear, todayInZone } from "./format";
import type { PlanContent, PlanDraft, PlanFixed, PlanOptions } from "./schema";

export const BRAND = {
  tagline: "МЕЖДУНАРОДНОЕ ЛЕЧЕНИЕ БЕЗ ПОСРЕДНИКОВ",
  title: "ПЛАН МЕДИЦИНСКОГО ОБСЛЕДОВАНИЯ И ЛЕЧЕНИЯ",
  subtitle: "Индивидуальная программа пациента — подготовлено на основании предоставленных медицинских документов",
  footer: "MEDITUR HBG · Рудаки Плаза, Рудаки 128, Душанбе · WhatsApp (+992) 00 550 77 77",
  contactLine: "Meditur HBG, Таджикистан · Рудаки Плаза, Рудаки 128, Душанбе · WhatsApp (+992) 00 550 77 77",
  nextStepCta: "Чтобы продолжить, свяжитесь с вашим координатором Meditur HBG.",
};

// Печатается как «Не включено: …», если в письме нет своего списка.
export const DEFAULT_NOT_INCLUDED =
  "консультации, не входящие в согласованный план; продлённое пребывание; лечение прочих заболеваний, не связанных с текущим случаем";

export const UNVERIFIED_CLINICS_NOTE =
  "Врачи и госпитали указаны по информации принимающей стороны. Итоговое медицинское заключение и состав лечащей команды определяются госпиталем после очной оценки пациента.";

// Пометка для плана, у которого галочка «проверено по сайтам клиник» стоит; ym — «2026-09».
export function verifiedClinicsNote(ym: string): string {
  return `Врачи и госпитали указаны по итогам проверки актуальной информации на официальных сайтах клиник (${formatMonthYear(ym)}). Итоговое медицинское заключение и состав лечащей команды определяются госпиталем после очной оценки пациента.`;
}

// Блоки плана, которые не меняются от пациента к пациенту; их снимок хранится в плане.
export function defaultFixed(): PlanFixed {
  return {
    tacticDisclaimer:
      "Окончательное решение о тактике лечения принимается только после очного клинического и инструментального обследования пациента в Индии. Meditur HBG не гарантирует результат лечения.",
    costFootnote:
      "Итоговая стоимость лечения будет определена после первичной оценки в Индии и может измениться по результатам обследования.",
    flights: {
      enabled: true,
      from: "Душанбе",
      to: "Дели",
      text: "Прямой рейс: Somon Air, рейс SZ109, ≈ 2 ч 40 мин в пути, ориентировочно 2 раза в неделю (пн, чт).",
      checkedOn: "",
    },
    support: [
      "Встреча и трансфер в аэропорту",
      "Личный координатор (кейс-менеджер) на протяжении всего пребывания",
      "Помощь в подборе проживания рядом с клиникой",
      "Помощь с обменом валюты",
    ],
    nextSteps: ["ПОДТВЕРЖДЕНИЕ", "ПРИГЛАШЕНИЕ", "ВИЗА", "ПЕРЕЛЁТ", "ИНДИЯ", "ЛЕЧЕНИЕ"],
  };
}

// Параметры нового плана: дата — сегодня в часовом поясе плана.
export function newPlanOptions(now?: Date): PlanOptions {
  return {
    date: todayInZone(now),
    diagnosisHeading: "confirmed",
    clinicsVerifiedOnSites: false,
    clinicsVerifiedMonth: "",
    showPageNumbers: true,
  };
}

const emptyDraft = (): PlanDraft => ({
  patient: { name: "", gender: "unknown" },
  profile: { specialty: "", condition: "" },
  overview: [],
  diagnosis: { text: "", state: "", tactic: "", status: "" },
  indiaSteps: [],
  tactic: { intro: "", items: [] },
  documents: { title: "", items: [] },
  approach: { title: "", paragraphs: [], items: [], note: "" },
  clinics: [],
  costs: { groups: [], footnote: "" },
  stay: { rows: [], note: "" },
  included: [],
  notIncluded: "",
  letterIssues: [],
});

// Содержимое плана из черновика модели (или пустого), с блоками формуляра.
export function contentFromDraft(draft: PlanDraft, fixed: PlanFixed = defaultFixed()): PlanContent {
  return { language: "ru", ...draft, fixed };
}

export function newPlanContent(): PlanContent {
  return contentFromDraft(emptyDraft());
}

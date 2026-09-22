import { addDays, subDays, subHours, subMinutes } from "date-fns";
import type { ChatMessage, Lead, Stage } from "@/lib/types";

const ASSIGNEES = ["Сорбон", "Гулчехра", "Аскар"];

interface SeedInput {
  id: string;
  name: string;
  phone: string;
  diagnosis: string;
  stage: Stage;
  assignee: string;
  aiPaused: boolean;
  nextTouchOffsetDays: number; // отрицательное = просрочено
  createdDaysAgo: number;
  hospital?: string;
  anamnesis?: Lead["anamnesis"];
}

const raw: SeedInput[] = [
  {
    id: "lead-1",
    name: "Фаррух Назаров",
    phone: "+992 92 710 14 22",
    diagnosis: "ИБС, планируется шунтирование",
    stage: "new",
    assignee: ASSIGNEES[0],
    aiPaused: false,
    nextTouchOffsetDays: 0,
    createdDaysAgo: 0,
    anamnesis: {
      age: 54,
      proceduresDone: ["ЭКГ", "Коронарография (Душанбе)"],
      summary:
        "Жалобы на давящую боль за грудиной при нагрузке. По месту жительства сделана коронарография, снимки уже в переписке.",
    },
  },
  {
    id: "lead-2",
    name: "Мадина Юсупова",
    phone: "+998 90 123 45 67",
    diagnosis: "Эндопротезирование тазобедренного сустава",
    stage: "new",
    assignee: ASSIGNEES[1],
    aiPaused: false,
    nextTouchOffsetDays: 1,
    createdDaysAgo: 0,
  },
  {
    id: "lead-3",
    name: "Далер Каримов",
    phone: "+992 93 555 20 11",
    diagnosis: "Стеноз поясничного отдела позвоночника",
    stage: "data_collection",
    assignee: ASSIGNEES[0],
    aiPaused: false,
    nextTouchOffsetDays: 2,
    createdDaysAgo: 2,
  },
  {
    id: "lead-4",
    name: "Нигора Ортикова",
    phone: "+998 93 210 98 76",
    diagnosis: "Врождённый порок сердца (дочь, 5 лет)",
    stage: "data_collection",
    assignee: ASSIGNEES[2],
    aiPaused: true,
    nextTouchOffsetDays: -1,
    createdDaysAgo: 3,
    anamnesis: {
      age: 5,
      proceduresDone: ["ЭхоКГ", "Педиатрический осмотр"],
      summary:
        "Порок выявлен при плановом обследовании. Мать попросила связать с живым координатором — ИИ поставлен на паузу.",
    },
  },
  {
    id: "lead-5",
    name: "Шерали Рахимов",
    phone: "+992 98 777 30 09",
    diagnosis: "Онкология щитовидной железы",
    stage: "waiting_india",
    assignee: ASSIGNEES[1],
    hospital: "Apollo Hospitals, Chennai",
    aiPaused: false,
    nextTouchOffsetDays: 4,
    createdDaysAgo: 6,
  },
  {
    id: "lead-6",
    name: "Гулнора Собирова",
    phone: "+998 91 456 78 90",
    diagnosis: "Замена митрального клапана",
    stage: "waiting_india",
    assignee: ASSIGNEES[0],
    hospital: "Medanta – The Medicity",
    aiPaused: false,
    nextTouchOffsetDays: -2,
    createdDaysAgo: 8,
    anamnesis: {
      age: 61,
      proceduresDone: ["ЭхоКГ", "Катетеризация сердца"],
      summary:
        "Митральная недостаточность 3 степени. План лечения из Medanta направлен, ждём решения семьи по датам.",
    },
  },
  {
    id: "lead-7",
    name: "Умед Холов",
    phone: "+992 90 112 45 90",
    diagnosis: "Эндопротезирование коленного сустава",
    stage: "plan_sent",
    assignee: ASSIGNEES[2],
    hospital: "Fortis Memorial, Gurugram",
    aiPaused: false,
    nextTouchOffsetDays: 1,
    createdDaysAgo: 10,
    anamnesis: {
      age: 58,
      proceduresDone: ["Рентген коленного сустава", "МРТ"],
      summary:
        "Двусторонний гонартроз 3 стадии. Клиника выбрана, готовятся документы на визу.",
    },
  },
  {
    id: "lead-8",
    name: "Зарина Тошева",
    phone: "+998 97 333 21 44",
    diagnosis: "Онкогематология, уточнение протокола",
    stage: "plan_sent",
    assignee: ASSIGNEES[1],
    hospital: "Artemis Hospital, Gurugram",
    aiPaused: false,
    nextTouchOffsetDays: 3,
    createdDaysAgo: 5,
  },
  {
    id: "lead-9",
    name: "Бахтиёр Эргашев",
    phone: "+992 91 900 66 12",
    diagnosis: "Реконструктивная хирургия кисти",
    stage: "declined",
    assignee: ASSIGNEES[0],
    aiPaused: true,
    nextTouchOffsetDays: 30,
    createdDaysAgo: 14,
  },
  {
    id: "lead-10",
    name: "Мунира Абдуллаева",
    phone: "+998 88 654 32 10",
    diagnosis: "Плановое обследование ЖКТ",
    stage: "declined",
    assignee: ASSIGNEES[2],
    aiPaused: true,
    nextTouchOffsetDays: 45,
    createdDaysAgo: 20,
  },
  {
    id: "lead-11",
    name: "Хуршед Сафаров",
    phone: "+992 93 480 15 77",
    diagnosis: "Аортокоронарное шунтирование",
    stage: "won",
    assignee: ASSIGNEES[1],
    hospital: "Apollo Hospitals, Chennai",
    aiPaused: true,
    nextTouchOffsetDays: 60,
    createdDaysAgo: 25,
  },
  {
    id: "lead-12",
    name: "Дилноза Каххорова",
    phone: "+998 90 777 88 99",
    diagnosis: "Эндопротезирование тазобедренного сустава",
    stage: "won",
    assignee: ASSIGNEES[0],
    hospital: "BLK-Max, Delhi",
    aiPaused: true,
    nextTouchOffsetDays: 60,
    createdDaysAgo: 18,
  },
  {
    id: "lead-13",
    name: "Тимур Джураев",
    phone: "+992 98 200 40 60",
    diagnosis: "Консультация по трансплантации печени",
    stage: "data_collection",
    assignee: ASSIGNEES[1],
    aiPaused: false,
    nextTouchOffsetDays: -3,
    createdDaysAgo: 4,
  },
  {
    id: "lead-14",
    name: "Севара Ниязова",
    phone: "+998 93 111 22 33",
    diagnosis: "Диагностика по болям в суставах",
    stage: "new",
    assignee: ASSIGNEES[2],
    aiPaused: false,
    nextTouchOffsetDays: 0,
    createdDaysAgo: 1,
  },
];

export const seedLeads: Lead[] = raw.map((l) => ({
  id: l.id,
  name: l.name,
  phone: l.phone,
  diagnosis: l.diagnosis,
  stage: l.stage,
  assignee: l.assignee,
  hospital: l.hospital,
  aiPaused: l.aiPaused,
  anamnesis: l.anamnesis,
  nextTouch: addDays(new Date(), l.nextTouchOffsetDays).toISOString(),
  createdAt: subDays(new Date(), l.createdDaysAgo).toISOString(),
}));

function thread(
  leadId: string,
  lines: [ChatMessage["from"], string][]
): ChatMessage[] {
  const base = subHours(new Date(), lines.length);
  return lines.map((line, i) => ({
    id: `${leadId}-msg-${i}`,
    leadId,
    from: line[0],
    text: line[1],
    at: subMinutes(base, (lines.length - i) * -18).toISOString(),
  }));
}

export const seedMessages: ChatMessage[] = [
  ...thread("lead-1", [
    ["patient", "Здравствуйте, мне дали ваш номер в Душанбе — по поводу лечения сердца в Индии"],
    ["ai", "Здравствуйте! Я ассистент Meditour. Подскажите, есть на руках заключение кардиолога или снимки коронарографии?"],
    ["patient", "Да, коронарография делалась в марте, могу прислать фото"],
    ["ai", "Отлично, пришлите, пожалуйста — передам их врачам на предварительную оценку"],
    ["patient", "📎 Отправил фото снимков"],
    ["coordinator", "Фаррух, добрый день! Передала документы врачам, ответ будет в течение 2 дней"],
  ]),
  ...thread("lead-4", [
    ["patient", "Добрый день, у дочери (5 лет) порок сердца, ищем клинику в Индии"],
    ["ai", "Здравствуйте! Подскажите, какой именно порок — есть заключение ЭхоКГ?"],
    ["patient", "Есть ЭхоКГ, но хочу сначала поговорить с человеком, а не с ботом"],
    ["coordinator", "Нигора, добрый день, меня зовут Гулчехра, я координатор. Беру ваш случай, ИИ на паузе — напишите, когда удобно созвониться"],
  ]),
  ...thread("lead-6", [
    ["patient", "Здравствуйте, есть новости от клиники по моему клапану?"],
    ["ai", "Здравствуйте! Да, план лечения из Medanta готов и уже загружен в вашу карточку"],
    ["patient", "Посмотрела, сумма немного отличается от той, что называли раньше"],
    ["ai", "Понимаю ваше беспокойство — в сумму уже включены трансфер из аэропорта и переводчик, наценок посредников нет"],
    ["patient", "Хорошо, мне нужно посоветоваться с семьёй"],
    ["ai", "Конечно, никакого давления. Подскажет, когда уточнить решение — через 3 дня?"],
  ]),
];

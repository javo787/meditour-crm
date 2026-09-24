// Заполняет реальную MongoDB Atlas тем же демо-набором лидов, что был
// зашит в mock-данные Этапа 2 — чтобы после перехода на Этап 3 карточки
// в интерфейсе не были пустыми. Не трогает базу, если в Leads уже что-то
// есть (запустите с --force, чтобы досеять поверх).
//
// Запуск: node --env-file=.env.local scripts/seed.mjs [--force]

import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI не задан — заполните .env.local (см. .env.example)");
  process.exit(1);
}

const FORCE = process.argv.includes("--force");
const ASSIGNEES = ["Сорбон", "Гулчехра", "Аскар"];
const now = () => new Date();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

const leadsInput = [
  { name: "Фаррух Назаров", phone: "+992927101422", diagnosis: "ИБС, планируется шунтирование", stage: "new", assignee: ASSIGNEES[0], nextTouch: inDays(0), createdAt: daysAgo(0), aiPaused: false, anamnesis: { age: 54, proceduresDone: ["ЭКГ", "Коронарография (Душанбе)"], summary: "Жалобы на давящую боль за грудиной при нагрузке. Снимки коронарографии уже в переписке." } },
  { name: "Мадина Юсупова", phone: "+998901234567", diagnosis: "Эндопротезирование тазобедренного сустава", stage: "new", assignee: ASSIGNEES[1], nextTouch: inDays(1), createdAt: daysAgo(0), aiPaused: false },
  { name: "Далер Каримов", phone: "+992935552011", diagnosis: "Стеноз поясничного отдела позвоночника", stage: "first_contact", assignee: ASSIGNEES[0], nextTouch: inDays(2), createdAt: daysAgo(2), aiPaused: false },
  { name: "Нигора Ортикова", phone: "+998932109876", diagnosis: "Врождённый порок сердца (дочь, 5 лет)", stage: "first_contact", assignee: ASSIGNEES[2], nextTouch: inDays(-1), createdAt: daysAgo(3), aiPaused: true, anamnesis: { age: 5, proceduresDone: ["ЭхоКГ"], summary: "Мать попросила связать с живым координатором — ИИ поставлен на паузу." } },
  { name: "Шерали Рахимов", phone: "+992987773009", diagnosis: "Онкология щитовидной железы", stage: "awaiting_decision", assignee: ASSIGNEES[1], hospital: "Apollo Hospitals, Chennai", nextTouch: inDays(4), createdAt: daysAgo(6), aiPaused: false },
  { name: "Гулнора Собирова", phone: "+998914567890", diagnosis: "Замена митрального клапана", stage: "awaiting_decision", assignee: ASSIGNEES[0], hospital: "Medanta – The Medicity", nextTouch: inDays(-2), createdAt: daysAgo(8), aiPaused: false, anamnesis: { age: 61, proceduresDone: ["ЭхоКГ", "Катетеризация сердца"], summary: "Митральная недостаточность 3 степени. План лечения направлен, ждём решения семьи." } },
  { name: "Умед Холов", phone: "+992901124590", diagnosis: "Эндопротезирование коленного сустава", stage: "estimate_sent", assignee: ASSIGNEES[2], hospital: "Fortis Memorial, Gurugram", nextTouch: inDays(1), createdAt: daysAgo(10), aiPaused: false },
  { name: "Зарина Тошева", phone: "+998973332144", diagnosis: "Онкогематология, уточнение протокола", stage: "estimate_sent", assignee: ASSIGNEES[1], hospital: "Artemis Hospital, Gurugram", nextTouch: inDays(3), createdAt: daysAgo(5), aiPaused: false },
  { name: "Бахтиёр Эргашев", phone: "+992919006612", diagnosis: "Реконструктивная хирургия кисти", stage: "declined", assignee: ASSIGNEES[0], nextTouch: inDays(30), createdAt: daysAgo(14), aiPaused: true },
  { name: "Мунира Абдуллаева", phone: "+998886543210", diagnosis: "Плановое обследование ЖКТ", stage: "declined", assignee: ASSIGNEES[2], nextTouch: inDays(45), createdAt: daysAgo(20), aiPaused: true },
  { name: "Хуршед Сафаров", phone: "+992934801577", diagnosis: "Аортокоронарное шунтирование", stage: "won", assignee: ASSIGNEES[1], hospital: "Apollo Hospitals, Chennai", nextTouch: inDays(60), createdAt: daysAgo(25), aiPaused: true },
  { name: "Дилноза Каххорова", phone: "+998907778899", diagnosis: "Эндопротезирование тазобедренного сустава", stage: "won", assignee: ASSIGNEES[0], hospital: "BLK-Max, Delhi", nextTouch: inDays(60), createdAt: daysAgo(18), aiPaused: true },
  { name: "Тимур Джураев", phone: "+992982004060", diagnosis: "Консультация по трансплантации печени", stage: "first_contact", assignee: ASSIGNEES[1], nextTouch: inDays(-3), createdAt: daysAgo(4), aiPaused: false },
  { name: "Севара Ниязова", phone: "+998931112233", diagnosis: "Диагностика по болям в суставах", stage: "new", assignee: ASSIGNEES[2], nextTouch: inDays(0), createdAt: daysAgo(1), aiPaused: false },
];

const threads = {
  "Фаррух Назаров": [
    ["patient", "Здравствуйте, мне дали ваш номер в Душанбе — по поводу лечения сердца в Индии"],
    ["ai", "Здравствуйте! Подскажите, есть на руках заключение кардиолога или снимки коронарографии?"],
    ["patient", "Да, коронарография делалась в марте, могу прислать фото"],
    ["coordinator", "Фаррух, добрый день! Передала документы врачам, ответ будет в течение 2 дней"],
  ],
  "Нигора Ортикова": [
    ["patient", "Добрый день, у дочери (5 лет) порок сердца, ищем клинику в Индии"],
    ["patient", "Хочу сначала поговорить с человеком, а не с ботом"],
    ["coordinator", "Нигора, добрый день, меня зовут Гулчехра. Беру ваш случай, ИИ на паузе"],
  ],
};

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("meditur");
  const leadsCol = db.collection("Leads");
  const messagesCol = db.collection("Messages");

  const existing = await leadsCol.countDocuments();
  if (existing > 0 && !FORCE) {
    console.log(`В Leads уже есть ${existing} документ(ов) — ничего не делаю (запустите с --force для досева).`);
    await client.close();
    return;
  }

  let insertedLeads = 0;
  let insertedMessages = 0;

  for (const input of leadsInput) {
    const { anamnesis, ...rest } = input;
    const doc = { ...rest, anamnesis };
    const result = await leadsCol.insertOne(doc);
    insertedLeads++;

    const thread = threads[input.name];
    if (thread) {
      const base = now();
      const msgs = thread.map((([from, text], i) => ({
        leadId: result.insertedId,
        from,
        text,
        at: new Date(base.getTime() - (thread.length - i) * 18 * 60000).toISOString(),
      })));
      if (msgs.length) {
        await messagesCol.insertMany(msgs);
        insertedMessages += msgs.length;
      }
    }
  }

  console.log(`Готово: добавлено ${insertedLeads} лидов и ${insertedMessages} сообщений в базу "meditur".`);
  await client.close();
}

main().catch((err) => {
  console.error("Ошибка сидирования:", err);
  process.exit(1);
});

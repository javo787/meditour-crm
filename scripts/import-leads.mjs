// Одноразовый перенос реальных лидов из текущей таблицы координатора
// (Meditur-Учёт_лидов.xlsx, состояние на 23.09.2026) в MongoDB. В отличие
// от seed.mjs (вымышленные демо-данные Этапа 2), здесь настоящие пациенты —
// поэтому переписка НЕ выдумывается: у этих лидов она появится в Messages
// по мере того, как реальные сообщения будут приходить через вебхук.
//
// Запуск: node --env-file=.env.local scripts/import-leads.mjs [--force]

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI не задан — заполните .env.local (см. .env.example)");
  process.exit(1);
}

const FORCE = process.argv.includes("--force");
const ASSIGNEE = "Джавохир";
const SOURCE = "WhatsApp";
const CAMPAIGN = "постер в чужом аккаунте";
const iso = (d) => new Date(d).toISOString();
const today = () => new Date().toISOString();

const leads = [
  { name: "Зар", phone: "992777778889", diagnosis: "урогинекология", homeLocation: "Душанбе, Таджикистан", stage: "first_contact", createdAt: iso("2026-09-14"), nextTouch: iso("2026-10-06") },
  { name: "Халифаев Начмидин", phone: "992946855050", diagnosis: "офтальмология", homeLocation: "Душанбе", stage: "awaiting_decision", createdAt: iso("2026-09-14"), notes: "Ждёт ответа от брата." },
  { name: "Pulatova Zarnigor", phone: "992920140344", diagnosis: "онкология (рак молочной железы)", homeLocation: "Конибодом", stage: "awaiting_decision", createdAt: iso("2026-09-14"), notes: "Начали лечиться здесь. Возможно, для обследования и консультации поедет в Индию, нужно написать через 10 дней." },
  { name: "Отаев Даврон", phone: "992907717827", diagnosis: "нейрохирургия", homeLocation: "Истаравшан", stage: "awaiting_decision", createdAt: iso("2026-09-14") },
  { name: "Зухуров Абдухалил", phone: "992927206700", diagnosis: "онкология", stage: "awaiting_decision", createdAt: iso("2026-09-14") },
  { name: "Ризоев Рахматулло", phone: "992938394040", diagnosis: "ожирение", stage: "awaiting_decision", createdAt: iso("2026-09-14"), notes: "Хочет обсудить в октябре, когда откроют офис." },
  { name: "Идиев Даврон", phone: "992906478686", diagnosis: "гепатит", stage: "awaiting_decision", createdAt: iso("2026-09-15"), notes: "Ищет донора печени, в семье у 6 человек цирроз." },
  { name: "Абдурасулзонда Мустафо", phone: "992928257477", diagnosis: "детская онкология", homeLocation: "Худжанд", stage: "awaiting_decision", createdAt: iso("2026-09-17"), notes: "После химиотерапии посмотрят (октябрь)." },
  { name: "Холикова Хосият", phone: "992926420481", diagnosis: "онкология", homeLocation: "Худжанд", stage: "awaiting_decision", createdAt: iso("2026-09-21"), notes: "Собирает деньги у знакомых и берёт кредит в банке." },
  { name: "Шерматова", phone: "992929655774", diagnosis: "онкология (офтальмология)", stage: "estimate_sent", createdAt: iso("2026-09-21") },
  { name: "Курбонов Махмадулло", phone: "992985055086", diagnosis: "онкология", homeLocation: "Согдийская область", stage: "awaiting_decision", createdAt: iso("2026-09-21") },
  { name: "Хомидов Мухаммадали", phone: "992919162078", diagnosis: "травматология", homeLocation: "Худжанд", stage: "awaiting_decision", createdAt: iso("2026-09-21") },
  { name: "Собирова Сарвиноз", phone: "79132465208", diagnosis: "Контрастное МРТ (ребёнок, 3 года)", homeLocation: "Худжанд", stage: "awaiting_decision", createdAt: iso("2026-09-19"), notes: "Основная причина — контрастное МРТ 3-летнего малыша. Заодно бабушка хочет лечиться от гепатита, а племянник — от аутизма. Ждут, когда отец ребёнка приедет в октябре." },
  { name: "Файзуллозода Назридин", phone: "992206297979", diagnosis: "эпендимома", homeLocation: "Бохтар", stage: "first_contact", createdAt: iso("2026-09-19") },
  { name: "Хасанов Фирдавс", phone: "992927809186", diagnosis: "нейрохирургия", homeLocation: "Согдийская область", stage: "awaiting_decision", createdAt: iso("2026-09-18"), notes: "Не женат. Нужно лечить мочеполовую систему, обдумают.", anamnesis: { age: 27 } },
];

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("meditur");
  const col = db.collection("Leads");

  const existing = await col.countDocuments();
  if (existing > 0 && !FORCE) {
    console.log(`В Leads уже есть ${existing} документ(ов) — ничего не делаю (запустите с --force для досева).`);
    await client.close();
    return;
  }

  let count = 0;
  for (const l of leads) {
    const doc = {
      name: l.name,
      phone: l.phone,
      diagnosis: l.diagnosis,
      stage: l.stage,
      assignee: ASSIGNEE,
      source: SOURCE,
      campaign: CAMPAIGN,
      homeLocation: l.homeLocation,
      notes: l.notes,
      anamnesis: l.anamnesis,
      nextTouch: l.nextTouch ?? today(),
      createdAt: l.createdAt,
      aiPaused: false,
    };
    await col.insertOne(doc);
    count++;
  }

  console.log(`Готово: перенесено ${count} реальных лидов в базу "meditur".`);
  await client.close();
}

main().catch((err) => {
  console.error("Ошибка переноса:", err);
  process.exit(1);
});

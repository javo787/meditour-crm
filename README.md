# Meditour CRM — Этапы 2–3 (интерфейс + бэкенд)

WhatsApp-CRM для координации лечения пациентов из Центральной Азии в Индии.

## Запуск

```bash
npm install
cp .env.example .env.local   # заполните MONGODB_URI и NEXTAUTH_SECRET как минимум
npm run dev
```

Откройте http://localhost:3000 — редирект на `/login`.

Демо-учётка координатора (см. `.env.local`):
- email: `coordinator@meditour.local`
- пароль: `change-me`

### Первый запуск с реальной MongoDB

База сама создаст коллекции при первой записи, но будет пустой. Чтобы сразу
увидеть интерфейс с демо-лидами (как в Этапе 2):

```bash
node --env-file=.env.local scripts/seed.mjs
```

Ничего не делает, если в `Leads` уже что-то есть (кроме `--force`).

## Что реализовано

**Этап 2 — интерфейс:**
- Layout и авторизация — NextAuth (Credentials), защищённые `/dashboard/*`
  через middleware, боковое меню, переключатель светлой/тёмной темы.
- Канбан-доска (`/dashboard`) — 6 колонок по плану, drag-and-drop на
  `@dnd-kit`, перенос карточки обновляет статус лида через API.
- Таблица лидов (`/dashboard/leads`) — `@tanstack/react-table`, сортировка,
  поиск и фильтр по статусу с фильтрацией на сервере (`searchParams`).
- Карточка пациента (`/dashboard/leads/[id]`) — «Анамнез», переписка с
  кнопкой «Остановить ИИ» / «Возобновить ИИ», смена этапа, кнопка
  «Сформировать Medical Opinion Request».

**Этап 3 — бэкенд и интеграция WhatsApp:**
- `lib/mongodb.ts` + `lib/db.ts` — реальный слой данных на MongoDB Atlas
  (коллекции `Leads`, `Messages`), пришёл на смену in-memory моку Этапа 2.
  Сигнатуры функций не менялись — весь интерфейс Этапа 2 работает как есть.
- `app/api/whatsapp-webhook` — приём `messages.upsert` от Evolution API:
  игнорирует собственное эхо (`fromMe`), находит лид по номеру или заводит
  новый со статусом «Новый», сохраняет сообщение в историю.
- Медиа: фото из WhatsApp скачивается через
  `POST /chat/getBase64FromMediaMessage/{instance}` и упаковывается в
  `inlineData` для Gemini (`lib/evolution.ts`, `lib/gemini.ts`).
- Стейт-машина: если координатор нажал «Остановить ИИ» (`aiPaused`), вебхук
  только сохраняет сообщение и не трогает ИИ — тот же флаг, что в карточке
  пациента из Этапа 2.
- При активном ИИ: сообщение уходит в Gemini вместе с историей переписки,
  ответ сохраняется и отправляется пациенту через
  `POST /message/sendText/{instance}`.

## Важные заметки по Этапу 3

- **Модель Gemini.** В плане указана «Gemini 1.5 Flash» — на момент Этапа 3
  поколения 1.0 и 1.5 полностью отключены Google (404 на любой запрос).
  По умолчанию используется `gemini-3.8-flash` — актуальная модель, но линейка
  меняется быстро: имя вынесено в `GEMINI_MODEL`, при необходимости замените
  без правки кода (сверяйтесь с
  https://ai.google.dev/gemini-api/docs/deprecations).
- **Формат запроса к Evolution API.** `POST /message/sendText/{instance}`
  принимает плоское тело `{ number, text }` (без обёртки `textMessage`/
  `options`, которая встречается в старых примерах и ломает запрос на
  текущих версиях API).
- **Системный промпт ИИ пока минимальный** — только чтобы маршрут
  «вебхук → ИИ → ответ пациенту» работал целиком. Полный регламент Meditour
  (запрет диагнозов от своего лица, финансовая/визовая политика, отработка
  возражений, Context Caching) — предмет Этапа 4.
- Настройте вебхук в Evolution API на `POST https://<ваш-домен>/api/whatsapp-webhook`
  с событием `MESSAGES_UPSERT`.

## Что ещё оставлено заглушкой (Этап 4)

- `app/api/leads/[id]/generate` — шаблонная генерация Medical Opinion Request
  вместо настоящего вызова Gemini с Context Caching.
- Нет cron-задач для follow-up (День 0/2/5/10) и скриптов отработки
  возражений — это Этап 4.

## Стек

Next.js 14 (App Router) · TypeScript · Tailwind + свои Shadcn-примитивы ·
`@tanstack/react-table` · `@dnd-kit` · NextAuth v4 · MongoDB Atlas (`mongodb`
драйвер) · Evolution API · Gemini API · Zod · date-fns

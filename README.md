# Meditour CRM — Этап 2 (интерфейс)

WhatsApp-CRM для координации лечения пациентов из Центральной Азии в Индии.
Реализован Этап 2 плана: фундамент на Next.js + Shadcn UI, продвинутая таблица
лидов, канбан-доска на dnd-kit и рабочее окно координатора (карточка пациента).

## Запуск

```bash
npm install
cp .env.example .env.local
npm run dev
```

Откройте http://localhost:3000 — редирект на `/login`.

Демо-учётка координатора (см. `.env.local`):
- email: `coordinator@meditour.local`
- пароль: `change-me`

## Что реализовано (Этап 2)

- **Layout и авторизация** — NextAuth (Credentials), защищённые `/dashboard/*`
  роуты через middleware, боковое меню, переключатель светлой/тёмной темы.
- **Канбан-доска** (`/dashboard`) — 6 колонок по плану (Новый → Выиграно),
  drag-and-drop на `@dnd-kit`, перенос карточки сразу обновляет статус лида
  через API.
- **Таблица лидов** (`/dashboard/leads`) — `@tanstack/react-table`, сортировка,
  поиск и фильтр по статусу с фильтрацией на сервере (через `searchParams`).
- **Карточка пациента** (`/dashboard/leads/[id]`) — блок «Анамнез», переписка
  с кнопкой «Остановить ИИ» / «Возобновить ИИ», смена этапа, кнопка
  «Сформировать Medical Opinion Request».

## Что специально оставлено заглушкой (Этапы 1, 3, 4)

- `lib/db.ts` — данные лежат в памяти процесса (мок вместо MongoDB Atlas).
  Поля `Lead` и `ChatMessage` (`lib/types.ts`) уже соответствуют коллекциям
  `Leads`/`Messages` из плана.
- `app/api/leads/[id]/generate` — шаблонная генерация Medical Opinion Request
  вместо вызова Gemini 1.5 Flash.
- Нет реального приёма вебхуков от Evolution API / WAHA — это Этап 3.
- Нет cron-задач для follow-up (День 0/2/5/10) — это Этап 4.

## Стек

Next.js 14 (App Router) · TypeScript · Tailwind + свои Shadcn-примитивы (без
внешних UI-репозиториев) · `@tanstack/react-table` · `@dnd-kit` · NextAuth v4 ·
Zod · date-fns

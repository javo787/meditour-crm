# План реализации: расшифровка голосовых WhatsApp

Спецификация: `docs/superpowers/specs/2026-10-24-voice-transcripts-design.md` (прочитать целиком до начала, это источник истины). Ниже порядок работы. Каждая задача: сначала тесты (TDD), потом код, потом проверка, потом коммит.

## Правила для всей работы

- Стек: Next.js 14 (app router), TypeScript strict, MongoDB (драйвер `mongodb`, коллекции без индексов), zod, Jest (`next/jest`, окружение `node`, без React Testing Library), Tailwind + shadcn/ui, lucide-react.
- Комментарии и сообщения журнала пишутся по-русски, как в остальном коде. Идентификаторы по-английски.
- Тесты и примеры только на выдуманных данных. Никаких реальных имён, телефонов, диагнозов, названий документов пациентов. Репозиторий публичный.
- В журналы (`createLogger`) не попадают тексты расшифровок и сообщений. Только идентификаторы, длины, статусы, модель.
- Не трогать Instagram (`lib/instagram/**`), раздел «Планы» (`lib/plans/**`, `components/plans/**`, `app/api/plans/**`).
- Новых зависимостей не добавлять без крайней необходимости. Gemini вызывается через уже экспортированную `generateWithFallback(contents, systemInstruction, logger, options)` из `lib/gemini.ts`.
- `app/api/whatsapp-webhook/route.ts` не покрыт тестами: правки там минимальные, логика живёт в `lib/transcription.ts` и тестируется там.
- Коммиты маленькие, по одной задаче. Не force-push. Не коммитить `.env`, `node_modules`, `.next`.
- Проверка после каждой задачи: `npx tsc --noEmit && npm run lint && npx jest`. В конце ещё `npx next build`. Всё должно проходить.

## Задачи

### T1. Типы и база
Файлы: `lib/types.ts`, `lib/db.ts`, тест рядом с существующими тестами БД.
- `MessageTranscript { text; source: "ai" | "coordinator"; model?; at }`. Поле `transcript?` в `ChatMessage` и `MessageDoc`; `toMessage` его отдаёт.
- `setAiTranscript(messageId, { text, model })`: условное обновление, не затирает `source: "coordinator"`.
- `setCoordinatorTranscript(messageId, text)`.
- `getAudioMessagesWithoutTranscript(leadId, limit)`: сообщения пациента с `media.kind === "audio"` без `transcript`, самые свежие первыми.
- `getMessageById(messageId)` (если нет похожей функции): нужна эндпоинтам для проверки принадлежности лиду.
- Тесты в духе существующих `__tests__/db.test.ts` / `lib/db.test.ts`.

### T2. Единый читатель текста
Файл: `lib/transcripts.ts` (чистые функции, без Node-API: файл подключается и из клиентского кода), тест `lib/transcripts.test.ts`.
- `voiceLine(text)` даёт `🎤 Голосовое сообщение (расшифровка): «…»`.
- `messageTextForModel(m)`: для сообщения с `transcript` это `voiceLine(transcript.text)`, иначе `m.text`.

### T3. Расшифровка
Файлы: `lib/transcription.ts`, `lib/transcription.test.ts`.
- `transcribeAudio({ base64, mimeType, requestId })`: инструкция из спецификации (дословно, язык оригинала, без перевода, «[неразборчиво]», «[речи не слышно]»), обычный текст, низкая температура. Лимит 15 МБ после декодирования: выше лимита бросает типизированную ошибку.
- `pendingTranscripts` (модульная карта промисов по `messageId`), `startTranscription(messageId, audio)` (не бросает), `waitForTranscript(messageId, timeoutMs)`.
- `ensureTranscript(messageId, { requestId })`: есть, значит вернуть; идёт, значит присоединиться; иначе байты из `MediaAssets` (`getMediaAssetByMessageId`), расшифровка, `setAiTranscript`.
- `ensureTranscriptsForLead(leadId, { limit = 10, concurrency = 3 })`.
- `resolveVoiceItems(items, deps)`: для элементов пачки с `audio` и `messageId` ждёт расшифровку до 20 с; успех: `text = voiceLine(...)`, `audio` убирается; сбой и таймаут: элемент не меняется. Остальные элементы возвращаются как есть. Зависимости (ожидание, время) передаются параметром, чтобы тесты шли без таймеров.
- Тесты через мок `generateWithFallback` и БД.

### T4. История ИИ
Файл: `lib/gemini.ts` (только `historyText`), тест в `lib/gemini.test.ts`.
- `historyText(m)` для сообщения пациента с расшифровкой возвращает `voiceLine(...)` через `messageTextForModel`. Остальное без изменений (сообщения координатора остаются служебной пометкой).

### T5. Вебхук WhatsApp
Файл: `app/api/whatsapp-webhook/route.ts` (минимально).
- В `processNewMessage` после `saveMediaAsset` для аудио: `startTranscription(savedMessage.id, audio)`; `messageId: savedMessage.id` кладётся в элемент пачки (тип элемента `pendingBatches` расширяется).
- В `processBatchInner` перед `askGemini`: `items = await resolveVoiceItems(items, ...)`. История и так строится через `historyText`.
- Чаты с `aiPaused`: расшифровка запускается всё равно (она стартует до проверки паузы).

### T6. Анамнез и запрос мнения
Файлы: `app/api/leads/[id]/anamnesis/route.ts`, `app/api/leads/[id]/case-assistant/route.ts`.
- Перед сборкой текста: `ensureTranscriptsForLead(leadId)`, затем перечитать сообщения. Переписка собирается через `messageTextForModel`.
- case-assistant: аудио, у чьих сообщений есть расшифровка, не прикладываются (по образцу `processedMediaIds` для фото); остальные прикладываются как сейчас. В инструкцию добавить: расшифровки голосовых сделаны машиной и могут содержать ошибки, названия лекарств и дозы нужно помечать для проверки.
- Общую сборку текста вынести в функции в `lib/` и протестировать (маршруты не тестируются).

### T7. API правки и расшифровки по требованию
Файл: `app/api/leads/[id]/messages/[messageId]/transcript/route.ts`, тест по образцу существующих тестов маршрутов.
- `POST`: проверка, что сообщение принадлежит лиду и голосовое (иначе 404), `ensureTranscript`, ответ `{ transcript }`.
- `PATCH`: тело `{ text }` (zod, 1–8000 символов, обрезка пробелов), `setCoordinatorTranscript`, ответ `{ transcript }`.
- Маршрут уже под авторизацией через `middleware.ts`; ничего в нём менять не нужно.

### T8. Интерфейс
Файлы: `lib/voice-transcript-ui.ts` (чистая `voiceTranscriptView`, тест рядом), `components/leads/patient-card/voice-transcript.tsx`, правка `components/leads/patient-card/chat-panel.tsx`.
- Поведение как в разделе «Интерфейс карточки пациента» спецификации: «транскрипт ↓/↑» (мелко, `text-[11px] text-muted-foreground`), блок с прокруткой, «расшифровано ИИ · править» / «исправлено · править», «расшифровать» для аудио без расшифровки, правка с «Сохранить»/«Отмена», ошибки рядом.
- `chat-panel.tsx` остаётся тонким: компонент подключается под `<audio>`; сообщение обновляется в состоянии `messages` по ответу API.
- Проверить доступность: `button type="button"`, `aria-expanded`, фокус с клавиатуры.
- Проверка вручную, если возможно: `npm run dev`, карточка пациента с голосовым.

### T9. Документация и финал
- Раздел в `README.md` про расшифровку голосовых (коротко: что делает, где хранится, как править, как работает очистка аудио).
- Полный прогон: `npx tsc --noEmit && npm run lint && npx jest && npx next build`.
- Один PR в `master`. В описании: что сделано, что проверено, что не проверено (качество распознавания таджикского и медицинских терминов нельзя проверить без реальных записей).

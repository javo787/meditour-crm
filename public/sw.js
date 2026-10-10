/* Meditur CRM — service worker.
 *
 * Намеренно минимальный. Это CRM с медицинскими данными пациентов, поэтому
 * НИЧЕГО из приложения (страницы, /api, переписки) здесь не кэшируется:
 * закэшированная страница лида на чужом/потерянном телефоне — утечка, а
 * устаревшая воронка — ошибка в работе координатора.
 *
 * Что он делает:
 *  1) сам факт наличия fetch-обработчика + манифест = приложение
 *     устанавливается во всех браузерах;
 *  2) если при открытии страницы нет сети — вместо стандартного «Нет
 *     подключения» браузера показывает свою страницу /offline.html.
 *
 * Меняете файл — поднимите CACHE_VERSION, старые кэши удалятся сами.
 */
const CACHE_VERSION = "v1";
const CACHE = "meditur-offline-" + CACHE_VERSION;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/brand/logo-full.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("meditur-offline-") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Только переходы по страницам. Всё остальное (API, статика Next.js,
  // картинки) идёт напрямую в сеть, как будто service worker'а нет.
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(async () => {
      const offline = await caches.match(OFFLINE_URL);
      return offline || Response.error();
    })
  );
});

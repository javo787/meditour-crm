import type { MetadataRoute } from "next";

// Web App Manifest — именно он делает CRM устанавливаемой как приложение
// (Chrome/Edge/Android: «Установить», iOS: «На экран Домой»). Next.js сам
// отдаёт его по /manifest.webmanifest и подключает <link rel="manifest">.
// Путь вне matcher'а middleware.ts, поэтому доступен без авторизации —
// браузер запрашивает манифест до входа в систему.
//
// start_url "/" — страница сама ведёт на /dashboard или /login по сессии,
// так что установленное приложение открывается правильно и до, и после входа.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Meditur HBG CRM",
    short_name: "Meditur",
    description: "Координация лидов лечения за рубежом через WhatsApp",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["business", "medical", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // maskable: знак внутри «безопасной зоны» — Android может обрезать
      // иконку кругом/«каплей», не задевая сам логотип.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Воронка", url: "/dashboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Лиды", url: "/dashboard/leads", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}

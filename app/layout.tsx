import type { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { Providers } from "@/components/layout/providers";
import { PwaRegister } from "@/components/layout/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meditur CRM",
  description: "Координация лидов лечения за рубежом через WhatsApp",
  applicationName: "Meditur CRM",
  // iOS: запуск с экрана «Домой» без адресной строки Safari. Иконка
  // (app/apple-icon.png) и favicon (app/favicon.ico) подключаются Next.js
  // автоматически по имени файла; манифест — из app/manifest.ts.
  appleWebApp: { capable: true, title: "Meditur", statusBarStyle: "default" },
};

// Без этого Next.js вообще не рендерит <meta name="viewport">, и мобильный
// Chrome по умолчанию считает страницу десктопной шириной ~980px и
// отображает её уменьшенной — отсюда весь десктопный сайдбар, колонки
// side-by-side и горизонтальный скролл на телефоне, которые видны на
// каждом скриншоте за всю сессию. maximumScale отсутствует намеренно —
// жёстко запрещать pinch-to-zoom вредно для доступности.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Цвет системной полосы в установленном приложении — как у шапки CRM.
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers session={session}>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}

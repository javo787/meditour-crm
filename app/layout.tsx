import type { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { Providers } from "@/components/layout/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meditur CRM",
  description: "Координация лидов лечения за рубежом через WhatsApp",
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
      </body>
    </html>
  );
}

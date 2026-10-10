import { AppBadgeSync } from "@/components/layout/app-badge-sync";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { getDueTouchCount } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Счётчик «касания на сегодня + просроченные» для меню и значка приложения.
  const dueCount = await getDueTouchCount();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar dueCount={dueCount} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar dueCount={dueCount} />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
      <AppBadgeSync count={dueCount} />
    </div>
  );
}

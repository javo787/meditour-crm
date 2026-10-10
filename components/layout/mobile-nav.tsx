"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/brand-mark";
import { NAV_ITEMS } from "@/components/layout/nav-items";

// Sidebar (components/layout/sidebar.tsx) скрыт целиком ниже md — это его
// замена: кнопка-гамбургер в Topbar + выезжающая панель с теми же
// NAV_ITEMS. Без этого компонента на телефоне не было бы вообще никакого
// способа перейти между Воронкой/Лидами/Настройками.
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Закрываем панель при переходе на другой маршрут (включая навигацию
  // назад/вперёд в браузере, которую клик по Link сам по себе не ловит).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Открыть меню"
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <nav
            aria-label="Основная навигация"
            className="relative flex h-full w-64 max-w-[80vw] flex-col border-r border-border bg-card shadow-xl"
          >
            <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
              <div className="flex items-center gap-2">
                <BrandMark size={30} />
                <span className="text-sm font-semibold tracking-tight">Meditur CRM</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Закрыть меню"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-1 p-3">
              {NAV_ITEMS.map((item) => {
                const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect } from "react";

type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * Показывает число касаний на значке установленного приложения (PWA) —
 * координатор видит «5» на иконке, даже не открывая CRM. Там, где Badging API
 * не поддерживается, молча ничего не делает.
 */
export function AppBadgeSync({ count }: { count: number }) {
  useEffect(() => {
    const nav = navigator as BadgingNavigator;
    if (typeof nav.setAppBadge !== "function") return;
    const action = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.();
    action?.catch(() => {});
  }, [count]);
  return null;
}

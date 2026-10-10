"use client";

import { useEffect } from "react";

// Регистрирует service worker (public/sw.js) — без него браузеры не
// предлагают установку, а офлайн-страница не показывается. В dev не
// регистрируем: SW мешает hot reload.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => console.warn("Service worker не зарегистрирован", err));
  }, []);

  return null;
}

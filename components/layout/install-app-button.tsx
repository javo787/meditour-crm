"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

// BeforeInstallPromptEvent нет в стандартных типах DOM — это событие
// Chromium (Chrome, Edge, Samsung Internet, Opera на Android и десктопе).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS выдаёт себя за Mac, но у него есть тачскрин
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// Кнопка «Установить приложение» в шапке. Показывается только когда
// установка реально возможна: в Chromium — по событию beforeinstallprompt
// (нативное окно установки), на iOS — с подсказкой «Поделиться → На экран
// Домой» (Safari не умеет предлагать установку сам). Внутри уже
// установленного приложения не показывается вообще.
export function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true); // до проверки на клиенте — скрыта
  const [hintOpen, setHintOpen] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(isIos());

    function onBeforeInstall(e: Event) {
      e.preventDefault(); // не даём браузеру показать свой баннер раньше времени
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!deferred && !ios)) return null;

  async function handleClick() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null); // событие одноразовое
      return;
    }
    setHintOpen((v) => !v);
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Установить приложение"
        title="Установить приложение"
        onClick={handleClick}
      >
        <Download className="h-4 w-4" />
      </Button>
      {hintOpen && (
        <div
          role="status"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md"
        >
          Чтобы установить: нажмите «Поделиться» (квадрат со стрелкой) в Safari, затем «На экран
          &laquo;Домой&raquo;».
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut } from "lucide-react";

/**
 * Фото документа на весь экран: закрывается крестом, нажатием на тёмный фон или Escape.
 * Нажатие на само фото увеличивает его (можно прокручивать пальцем), повторное — возвращает по размеру
 * экрана. Рендерится только после нажатия на миниатюру, поэтому на сервере не выполняется.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Пока открыто, страница под ним не прокручивается.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-[100] flex flex-col bg-black/90">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-white">
        <span className="min-w-0 flex-1 truncate text-sm">{alt}</span>
        <button
          type="button"
          onClick={() => setZoomed((value) => !value)}
          aria-label={zoomed ? "Уменьшить" : "Увеличить"}
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15"
        >
          {zoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Тёмный фон — тоже «закрыть». m-auto у фото: при увеличении его левый край не обрезается. */}
      <div
        data-testid="lightbox-backdrop"
        className="flex min-h-0 flex-1 overflow-auto p-2"
        style={{ touchAction: "pan-x pan-y pinch-zoom" }}
        onClick={onClose}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onClick={(event) => {
            event.stopPropagation();
            setZoomed((value) => !value);
          }}
          className={`m-auto select-none ${zoomed ? "h-auto max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}`}
          style={zoomed ? { width: "250%" } : undefined}
          draggable={false}
        />
      </div>
    </div>,
    document.body
  );
}

import Image from "next/image";

import { cn } from "@/lib/utils";

// Логотип Meditur HBG на белой плашке: фирменные синий и зелёный на тёмной
// теме без неё теряются (внутри знака белые зазоры), а на плашке выглядят
// одинаково в обеих темах. unoptimized — это статические PNG из /public,
// оптимизатору картинок тут делать нечего.

// Знак «M» — для сайдбара и мобильного меню.
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-border",
        className
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src="/brand/logo-mark.png"
        alt=""
        width={531}
        height={450}
        unoptimized
        style={{ width: Math.round(size * 0.78), height: "auto" }}
      />
    </span>
  );
}

// Полный логотип со словом MEDITUR HBG — для страницы входа.
export function BrandLogo({ className }: { className?: string }) {
  return (
    <div className={cn("mb-1 rounded-xl bg-white px-4 py-3 ring-1 ring-border", className)}>
      <Image
        src="/brand/logo-full.png"
        alt="Meditur HBG"
        width={891}
        height={753}
        priority
        unoptimized
        className="h-auto w-36"
      />
    </div>
  );
}

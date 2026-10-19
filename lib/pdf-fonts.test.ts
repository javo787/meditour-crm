import fs from "node:fs";
import path from "node:path";
import pdfmake from "pdfmake";

import { DEJAVU_DIR, ensurePdfFonts } from "@/lib/pdf-fonts";

// fontkit — зависимость pdfkit, типов у неё нет: подключаем через require (без eslint-disable:
// правила @typescript-eslint в этом проекте не подключены, а ссылка на неизвестное правило — ошибка линтера).
const fontkit = require("fontkit") as {
  openSync(file: string): { hasGlyphForCodePoint(codePoint: number): boolean };
};

describe("ensurePdfFonts", () => {
  it("registers DejaVu next to Roboto; both build a PDF, a repeated call is safe", async () => {
    ensurePdfFonts();
    ensurePdfFonts();
    const dejavu = await pdfmake
      .createPdf({ defaultStyle: { font: "DejaVu" }, content: ["Қобилият ғқҷӣӯҳ ≈ ± – — • → №"] })
      .getBuffer();
    expect(dejavu.subarray(0, 4).toString()).toBe("%PDF");
    const roboto = await pdfmake.createPdf({ defaultStyle: { font: "Roboto" }, content: ["Кириллица"] }).getBuffer();
    expect(roboto.subarray(0, 4).toString()).toBe("%PDF");
  });

  it.each(["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"])(
    "%s has every glyph the form uses",
    (file) => {
      const font = fontkit.openSync(path.join(DEJAVU_DIR, file));
      for (const ch of "ҒғҚқҶҷӢӣӮӯҲҳ—–•±≈→№«»°") expect(font.hasGlyphForCodePoint(ch.codePointAt(0)!)).toBe(true);
      // Деванагари в шрифте нет — поэтому в Задаче 5 есть проверка foreign-glyph.
      expect(font.hasGlyphForCodePoint("अ".codePointAt(0)!)).toBe(false);
    }
  );

  it("ships the licence next to the fonts", () => {
    expect(fs.readFileSync(path.join(DEJAVU_DIR, "LICENSE.txt"), "utf8")).toMatch(/Bitstream Vera/);
  });
});

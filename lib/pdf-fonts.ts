import path from "node:path";
import pdfmake from "pdfmake";

// Шрифты pdfmake настраиваются один раз на процесс и общие для всех PDF сервера:
// досье пациента остаётся на Roboto (из node_modules/pdfmake), а PDF плана лечения
// собирается шрифтом DejaVu Sans — в нём есть кириллица, таджикские буквы и знаки,
// которые использует форма (— – • ± ≈ → № « » °). Файлы DejaVu и его лицензия лежат
// в репозитории (assets/fonts/dejavu), а не берутся из системы: PDF не зависит от того,
// какие шрифты установлены на сервере.

const ROBOTO_DIR = path.join(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto");
export const DEJAVU_DIR = path.join(process.cwd(), "assets", "fonts", "dejavu");

let fontsReady = false;

// Идемпотентно: вызывать можно перед каждой сборкой PDF, настройка выполнится один раз.
export function ensurePdfFonts(): void {
  if (fontsReady) return;
  // setFonts заменяет весь словарь, поэтому оба семейства регистрируются одним вызовом.
  pdfmake.setFonts({
    Roboto: {
      normal: path.join(ROBOTO_DIR, "Roboto-Regular.ttf"),
      bold: path.join(ROBOTO_DIR, "Roboto-Medium.ttf"),
      italics: path.join(ROBOTO_DIR, "Roboto-Italic.ttf"),
      bolditalics: path.join(ROBOTO_DIR, "Roboto-MediumItalic.ttf"),
    },
    DejaVu: {
      normal: path.join(DEJAVU_DIR, "DejaVuSans.ttf"),
      bold: path.join(DEJAVU_DIR, "DejaVuSans-Bold.ttf"),
      italics: path.join(DEJAVU_DIR, "DejaVuSans-Oblique.ttf"),
      bolditalics: path.join(DEJAVU_DIR, "DejaVuSans-BoldOblique.ttf"),
    },
  });
  // С диска читаются только шрифты из этих двух папок.
  pdfmake.setLocalAccessPolicy((file: string) => {
    const resolved = path.resolve(file);
    return resolved.startsWith(ROBOTO_DIR) || resolved.startsWith(DEJAVU_DIR);
  });
  // Никаких загрузок по URL: в PDF только то, что мы сами туда положили.
  pdfmake.setUrlAccessPolicy(() => false);
  fontsReady = true;
}

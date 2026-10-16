import { RETURN_GAP_HOURS, returnGapHint, russianDays } from "./return-gap";

const NOW = new Date("2026-10-16T09:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

describe("russianDays", () => {
  it("склоняет «день» по правилам русского языка", () => {
    expect(russianDays(2)).toBe("2 дня");
    expect(russianDays(4)).toBe("4 дня");
    expect(russianDays(5)).toBe("5 дней");
    expect(russianDays(11)).toBe("11 дней");
    expect(russianDays(14)).toBe("14 дней");
    expect(russianDays(21)).toBe("21 день");
    expect(russianDays(22)).toBe("22 дня");
    expect(russianDays(30)).toBe("30 дней");
  });
});

describe("returnGapHint", () => {
  it("порог — сутки: 23 часа молчания не повод для подсказки, 24 — повод", () => {
    expect(RETURN_GAP_HOURS).toBe(24);
    expect(returnGapHint(ago(23), NOW)).toBeUndefined();
    expect(returnGapHint(ago(24), NOW)).toContain("больше суток");
  });

  it("называет число дней, если прошло 2 и больше", () => {
    expect(returnGapHint(ago(14 * 24 + 3), NOW)).toContain("14 дней");
    expect(returnGapHint(ago(2 * 24), NOW)).toContain("2 дня");
  });

  it("служебная подсказка: пациент её не видит, начинать заново не нужно", () => {
    const hint = returnGapHint(ago(10 * 24), NOW) as string;
    expect(hint).toContain("Служебная подсказка");
    expect(hint).toContain("не начинай");
  });

  it("нет последнего сообщения, кривая дата или дата из будущего — подсказки нет", () => {
    expect(returnGapHint(undefined, NOW)).toBeUndefined();
    expect(returnGapHint("не дата", NOW)).toBeUndefined();
    expect(returnGapHint(ago(-5), NOW)).toBeUndefined();
  });
});

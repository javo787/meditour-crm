import {
  describeRelativeDay,
  pluralizeRu,
  presetDate,
  toNextTouchIso,
} from "./next-touch";

describe("pluralizeRu", () => {
  const f = (n: number) => pluralizeRu(n, "день", "дня", "дней");
  it("склоняет числительные", () => {
    expect(f(1)).toBe("день");
    expect(f(2)).toBe("дня");
    expect(f(4)).toBe("дня");
    expect(f(5)).toBe("дней");
    expect(f(11)).toBe("дней");
    expect(f(14)).toBe("дней");
    expect(f(21)).toBe("день");
    expect(f(22)).toBe("дня");
  });
});

describe("describeRelativeDay", () => {
  const now = new Date(2026, 9, 10, 20, 13); // 10 окт 2026, 20:13 локально
  it("сегодня / завтра", () => {
    expect(describeRelativeDay(new Date(2026, 9, 10, 8, 0), now)).toBe("Сегодня");
    expect(describeRelativeDay(new Date(2026, 9, 11, 23, 59), now)).toBe("Завтра");
  });
  it("будущее", () => {
    expect(describeRelativeDay(new Date(2026, 9, 13), now)).toBe("Через 3 дня");
    expect(describeRelativeDay(new Date(2026, 9, 24), now)).toBe("Через 14 дней");
  });
  it("просрочено", () => {
    expect(describeRelativeDay(new Date(2026, 9, 9), now)).toBe("Просрочено на 1 день");
    expect(describeRelativeDay(new Date(2026, 9, 8), now)).toBe("Просрочено на 2 дня");
  });
});

describe("toNextTouchIso", () => {
  it("сохраняет конец выбранного дня (локально)", () => {
    const iso = toNextTouchIso(new Date(2026, 9, 13));
    const back = new Date(iso);
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(9);
    expect(back.getDate()).toBe(13);
    expect(back.getHours()).toBe(23);
    expect(back.getMinutes()).toBe(59);
  });
});

describe("presetDate", () => {
  it("считает от начала сегодняшнего дня", () => {
    const now = new Date(2026, 9, 10, 20, 13);
    const d = presetDate(7, now);
    expect(d.getDate()).toBe(17);
    expect(d.getHours()).toBe(0);
  });
});

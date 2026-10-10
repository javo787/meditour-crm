import { endOfDayInZone, groupTouches, isActiveLead, touchBucket } from "./touches";
import type { Lead } from "./types";

function lead(over: Partial<Lead>): Lead {
  return {
    id: "1",
    name: "Пациент",
    phone: "992000000000",
    diagnosis: "—",
    stage: "first_contact",
    assignee: "Не назначен",
    nextTouch: new Date(2026, 9, 10, 23, 59).toISOString(),
    createdAt: new Date(2026, 9, 1).toISOString(),
    aiPaused: false,
    ...over,
  };
}

const now = new Date(2026, 9, 10, 20, 13);

describe("touchBucket", () => {
  it("раскладывает по календарным дням", () => {
    expect(touchBucket(new Date(2026, 9, 9, 23, 59).toISOString(), now)).toBe("overdue");
    expect(touchBucket(new Date(2026, 9, 10, 23, 59).toISOString(), now)).toBe("today");
    expect(touchBucket(new Date(2026, 9, 11, 23, 59).toISOString(), now)).toBe("tomorrow");
    expect(touchBucket(new Date(2026, 9, 17, 23, 59).toISOString(), now)).toBe("week");
    expect(touchBucket(new Date(2026, 9, 18, 23, 59).toISOString(), now)).toBe("later");
  });
  it("касание на сегодня вечером ещё не просрочено", () => {
    expect(touchBucket(new Date(2026, 9, 10, 8, 0).toISOString(), now)).toBe("today");
  });
});

describe("isActiveLead", () => {
  it("закрытые и «без ответа» не активны", () => {
    expect(isActiveLead(lead({}))).toBe(true);
    expect(isActiveLead(lead({ stage: "won" }))).toBe(false);
    expect(isActiveLead(lead({ stage: "declined" }))).toBe(false);
    expect(isActiveLead(lead({ noResponse: true }))).toBe(false);
    expect(isActiveLead(lead({ noResponse: false }))).toBe(true);
  });
});

describe("groupTouches", () => {
  it("пропускает закрытые лиды", () => {
    const g = groupTouches(
      [lead({ id: "a", stage: "won" }), lead({ id: "b", stage: "declined" }), lead({ id: "c" })],
      now
    );
    expect(g.today.map((l) => l.id)).toEqual(["c"]);
  });
  it("лиды «без ответа» не попадают ни в одну группу", () => {
    const g = groupTouches([lead({ id: "x", noResponse: true }), lead({ id: "y" })], now);
    const all = Object.values(g).flat().map((l) => l.id);
    expect(all).toEqual(["y"]);
  });
  it("сначала те, кому нужно ответить, затем по дате", () => {
    const g = groupTouches(
      [
        lead({ id: "old", nextTouch: new Date(2026, 9, 5, 23, 59).toISOString() }),
        lead({
          id: "waiting",
          nextTouch: new Date(2026, 9, 8, 23, 59).toISOString(),
          lastMessageFrom: "patient",
        }),
        lead({ id: "older", nextTouch: new Date(2026, 9, 3, 23, 59).toISOString() }),
      ],
      now
    );
    expect(g.overdue.map((l) => l.id)).toEqual(["waiting", "older", "old"]);
  });
});

describe("endOfDayInZone", () => {
  it("конец дня в Душанбе (UTC+5)", () => {
    expect(endOfDayInZone(new Date("2026-10-10T15:00:00Z"), "Asia/Dushanbe").toISOString()).toBe(
      "2026-10-10T18:59:59.999Z"
    );
  });
  it("после местной полуночи — уже следующий день", () => {
    expect(endOfDayInZone(new Date("2026-10-10T19:30:00Z"), "Asia/Dushanbe").toISOString()).toBe(
      "2026-10-11T18:59:59.999Z"
    );
  });
  it("UTC", () => {
    expect(endOfDayInZone(new Date("2026-10-10T15:00:00Z"), "UTC").toISOString()).toBe(
      "2026-10-10T23:59:59.999Z"
    );
  });
});

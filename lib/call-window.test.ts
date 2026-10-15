import {
  CALL_INVITE_HINT,
  callInviteHint,
  getCallWindowConfig,
  isInCallWindow,
  localHour,
} from "./call-window";

const dushanbe = { timeZone: "Asia/Dushanbe", startHour: 12, endHour: 17 };

describe("localHour", () => {
  it("считает час в нужном часовом поясе (Душанбе = UTC+5)", () => {
    expect(localHour(new Date("2026-10-15T07:00:00Z"), "Asia/Dushanbe")).toBe(12);
    expect(localHour(new Date("2026-10-15T07:00:00Z"), "UTC")).toBe(7);
  });

  it("полночь — это 0, а не 24", () => {
    expect(localHour(new Date("2026-10-14T19:00:00Z"), "Asia/Dushanbe")).toBe(0);
  });
});

describe("isInCallWindow", () => {
  it("12:00 по Душанбе — внутри окна, 11:59:59 — ещё нет", () => {
    expect(isInCallWindow(new Date("2026-10-15T07:00:00Z"), dushanbe)).toBe(true);
    expect(isInCallWindow(new Date("2026-10-15T06:59:59Z"), dushanbe)).toBe(false);
  });

  it("16:59:59 — внутри окна, 17:00 — уже нет", () => {
    expect(isInCallWindow(new Date("2026-10-15T11:59:59Z"), dushanbe)).toBe(true);
    expect(isInCallWindow(new Date("2026-10-15T12:00:00Z"), dushanbe)).toBe(false);
  });

  it("вечером и ночью — вне окна", () => {
    expect(isInCallWindow(new Date("2026-10-15T16:00:00Z"), dushanbe)).toBe(false); // 21:00
    expect(isInCallWindow(new Date("2026-10-14T22:00:00Z"), dushanbe)).toBe(false); // 03:00
  });

  it("часовой пояс решает: один и тот же момент по-разному в разных поясах", () => {
    const now = new Date("2026-10-15T07:00:00Z");
    expect(isInCallWindow(now, { ...dushanbe, timeZone: "Asia/Dushanbe" })).toBe(true);
    expect(isInCallWindow(now, { ...dushanbe, timeZone: "UTC" })).toBe(false);
  });

  it("одинаковые начало и конец — окно пустое (приглашения выключены)", () => {
    const off = { ...dushanbe, startHour: 12, endHour: 12 };
    for (let h = 0; h < 24; h++) {
      expect(isInCallWindow(new Date(Date.UTC(2026, 9, 15, h)), off)).toBe(false);
    }
  });

  it("окно через полночь работает", () => {
    const night = { timeZone: "UTC", startHour: 22, endHour: 2 };
    expect(isInCallWindow(new Date("2026-10-15T23:00:00Z"), night)).toBe(true);
    expect(isInCallWindow(new Date("2026-10-15T01:00:00Z"), night)).toBe(true);
    expect(isInCallWindow(new Date("2026-10-15T12:00:00Z"), night)).toBe(false);
  });
});

describe("getCallWindowConfig", () => {
  it("по умолчанию: Душанбе, 12–17", () => {
    expect(getCallWindowConfig({} as NodeJS.ProcessEnv)).toEqual(dushanbe);
  });

  it("читает переменные окружения", () => {
    expect(
      getCallWindowConfig({
        BOT_TIMEZONE: "Asia/Tashkent",
        CALL_WINDOW_START_HOUR: "10",
        CALL_WINDOW_END_HOUR: "18",
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ timeZone: "Asia/Tashkent", startHour: 10, endHour: 18 });
  });

  it("мусор в настройках не ломает ответ — подставляются значения по умолчанию", () => {
    expect(
      getCallWindowConfig({
        BOT_TIMEZONE: "Mars/Base",
        CALL_WINDOW_START_HOUR: "abc",
        CALL_WINDOW_END_HOUR: "99",
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual(dushanbe);
  });
});

describe("callInviteHint", () => {
  it("в окне — подсказка про звонок, вне окна — ничего", () => {
    expect(callInviteHint(new Date("2026-10-15T08:00:00Z"), dushanbe)).toBe(CALL_INVITE_HINT); // 13:00
    expect(callInviteHint(new Date("2026-10-15T14:00:00Z"), dushanbe)).toBeUndefined(); // 19:00
  });
});

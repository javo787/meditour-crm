export {};

jest.mock("@/lib/logger", () => {
  const logger: Record<string, jest.Mock> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return { createLogger: () => logger, newRequestId: () => "req" };
});
const mockRunPass = jest.fn(async (..._args: unknown[]) => null);
jest.mock("@/lib/first-contact", () => ({ runFirstContactPass: (...args: unknown[]) => mockRunPass(...args) }));

import {
  __resetSchedulerForTests,
  FIRST_CONTACT_INTERVAL_MS,
  firstContactEnabled,
  startFirstContactScheduler,
} from "@/lib/first-contact-scheduler";

describe("first-contact scheduler", () => {
  const original = process.env.FIRST_CONTACT_CADENCE;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    __resetSchedulerForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
    if (original === undefined) delete process.env.FIRST_CONTACT_CADENCE;
    else process.env.FIRST_CONTACT_CADENCE = original;
  });

  it("is off unless FIRST_CONTACT_CADENCE is exactly 'on' (it messages real patients)", () => {
    for (const value of [undefined, "", "1", "true", "ON "]) {
      if (value === undefined) delete process.env.FIRST_CONTACT_CADENCE;
      else process.env.FIRST_CONTACT_CADENCE = value;
      expect(firstContactEnabled()).toBe(false);
      expect(startFirstContactScheduler()).toBe(false);
    }
    jest.advanceTimersByTime(FIRST_CONTACT_INTERVAL_MS * 3);
    expect(mockRunPass).not.toHaveBeenCalled();
  });

  it("when on: first pass a minute after start, then every 30 minutes, and only one scheduler", () => {
    process.env.FIRST_CONTACT_CADENCE = "on";
    expect(startFirstContactScheduler()).toBe(true);
    expect(startFirstContactScheduler()).toBe(false);

    jest.advanceTimersByTime(59_000);
    expect(mockRunPass).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(mockRunPass).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(FIRST_CONTACT_INTERVAL_MS);
    expect(mockRunPass).toHaveBeenCalledTimes(2);
    expect(FIRST_CONTACT_INTERVAL_MS).toBe(30 * 60 * 1000);
  });

  it("a crashing pass does not stop the schedule", async () => {
    process.env.FIRST_CONTACT_CADENCE = "on";
    mockRunPass.mockRejectedValueOnce(new Error("db down"));
    startFirstContactScheduler();
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    jest.advanceTimersByTime(FIRST_CONTACT_INTERVAL_MS);
    expect(mockRunPass).toHaveBeenCalledTimes(2);
  });
});

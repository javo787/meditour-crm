export {};

const mockRunPass = jest.fn();
const mockEnabled = jest.fn();
jest.mock("@/lib/first-contact", () => ({ runFirstContactPass: (...args: unknown[]) => mockRunPass(...args) }));
jest.mock("@/lib/first-contact-scheduler", () => ({ firstContactEnabled: () => mockEnabled() }));

import { GET } from "@/app/api/cron/first-contact/route";

const call = (query: string, headers: Record<string, string> = {}) =>
  GET(new Request(`https://example.com/api/cron/first-contact${query}`, { headers }));

describe("/api/cron/first-contact", () => {
  const original = process.env.CRON_SECRET;
  const report = { dryRun: true, total: 1, summary: { summarize: 1 }, outcomes: [{ leadId: "l1", name: "Test", kind: "summarize", done: false }] };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = "s3cret";
    mockEnabled.mockReturnValue(false);
    mockRunPass.mockResolvedValue(report);
  });
  afterAll(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("refuses everything when CRON_SECRET is not configured (the route shows lead names and can message patients)", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("?dryRun=1")).status).toBe(401);
    expect(mockRunPass).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret, accepts the right one as a query parameter or a header", async () => {
    expect((await call("?secret=nope&dryRun=1")).status).toBe(401);
    expect((await call("?secret=s3cret&dryRun=1")).status).toBe(200);
    expect((await call("?dryRun=1", { "x-cron-secret": "s3cret" })).status).toBe(200);
  });

  it("dry run works even while the cadence is switched off", async () => {
    const res = await call("?secret=s3cret&dryRun=1");
    expect(mockRunPass).toHaveBeenCalledWith({ dryRun: true });
    expect(await res.json()).toMatchObject({ ok: true, dryRun: true, total: 1, summary: { summarize: 1 } });
  });

  it("a real run needs FIRST_CONTACT_CADENCE=on", async () => {
    const off = await call("?secret=s3cret");
    expect(off.status).toBe(403);
    expect(mockRunPass).not.toHaveBeenCalled();

    mockEnabled.mockReturnValue(true);
    const on = await call("?secret=s3cret");
    expect(on.status).toBe(200);
    expect(mockRunPass).toHaveBeenCalledWith({ dryRun: false });
  });

  it("answers 409 when another real pass is still running", async () => {
    mockEnabled.mockReturnValue(true);
    mockRunPass.mockResolvedValue(null);
    expect((await call("?secret=s3cret")).status).toBe(409);
  });
});

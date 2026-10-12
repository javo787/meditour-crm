import { __resetFailedAttempts, authOptions, passwordMatches } from "@/lib/auth";

type Authorize = (
  credentials: Record<string, string> | undefined,
  req: { headers?: Record<string, string> },
) => Promise<{ id: string; name: string } | null>;

const provider = authOptions.providers[0] as unknown as {
  options: { authorize: Authorize };
};
const authorize = provider.options.authorize;

const req = (ip = "1.2.3.4") => ({ headers: { "x-forwarded-for": ip } });

describe("shared-password login", () => {
  const original = process.env.DEMO_COORDINATOR_PASSWORD;

  beforeEach(() => {
    process.env.DEMO_COORDINATOR_PASSWORD = "s3cret-pass";
    __resetFailedAttempts();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    if (original === undefined) delete process.env.DEMO_COORDINATOR_PASSWORD;
    else process.env.DEMO_COORDINATOR_PASSWORD = original;
  });

  it("lets anyone in with the right password, with or without a name", async () => {
    expect(await authorize({ password: "s3cret-pass" }, req())).toEqual({
      id: "coordinator",
      name: "Координатор Meditur",
    });
    expect(await authorize({ name: "  Анвар  ", password: "s3cret-pass" }, req())).toEqual({
      id: "coordinator",
      name: "Анвар",
    });
  });

  it("rejects a wrong or empty password", async () => {
    expect(await authorize({ password: "nope" }, req())).toBeNull();
    expect(await authorize({ password: "" }, req())).toBeNull();
    expect(await authorize(undefined, req())).toBeNull();
  });

  it("is closed for everyone when the env var is not set", async () => {
    delete process.env.DEMO_COORDINATOR_PASSWORD;
    expect(await authorize({ password: "" }, req())).toBeNull();
    expect(await authorize({ password: "meditur2026_demo" }, req())).toBeNull();
  });

  it("blocks an IP after 5 failed attempts, even for the right password", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await authorize({ password: "bad" }, req("9.9.9.9"))).toBeNull();
    }
    await expect(authorize({ password: "s3cret-pass" }, req("9.9.9.9"))).rejects.toThrow(
      "RATE_LIMITED",
    );
    // другой IP не затронут
    expect(await authorize({ password: "s3cret-pass" }, req("8.8.8.8"))).not.toBeNull();
  });

  it("compares passwords exactly", () => {
    expect(passwordMatches("abc", "abc")).toBe(true);
    expect(passwordMatches("abc", "abd")).toBe(false);
    expect(passwordMatches("abc", "abcd")).toBe(false);
  });
});

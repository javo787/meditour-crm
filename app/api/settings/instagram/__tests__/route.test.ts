import { testApiHandler } from "next-test-api-route-handler";

import { getAccount, getSubscriptions, subscribeAccount } from "@/lib/instagram/graph";
import { getEffectiveToken } from "@/lib/instagram/store";
import { GET } from "../route";

jest.mock("@/lib/instagram/graph", () => ({
  getAccount: jest.fn(),
  getSubscriptions: jest.fn(),
  subscribeAccount: jest.fn(),
}));
jest.mock("@/lib/instagram/store", () => ({ getEffectiveToken: jest.fn() }));

const getAccountMock = getAccount as jest.Mock;
const getSubscriptionsMock = getSubscriptions as jest.Mock;
const subscribeMock = subscribeAccount as jest.Mock;
const effectiveTokenMock = getEffectiveToken as jest.Mock;

const ACCOUNT_ID = "17841400000000001";
const TOKEN = "fake-token-settings-test";
const SECRET = "fake-secret-settings-test";
const VERIFY = "fake-verify-settings-test";

const ORIGINAL_ENV = process.env;

async function getStatus(path = "/api/settings/instagram") {
  const out = { status: 0, body: null as Record<string, unknown> | null, text: "" };
  await testApiHandler({
    appHandler: { GET },
    url: path,
    test: async ({ fetch }) => {
      const res = await fetch({ method: "GET" });
      out.status = res.status;
      out.text = await res.text();
      out.body = JSON.parse(out.text) as Record<string, unknown>;
    },
  });
  return out;
}

const okGraph = <T>(data: T) => ({ ok: true as const, data });

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    INSTAGRAM_ACCESS_TOKEN: TOKEN,
    INSTAGRAM_APP_SECRET: SECRET,
    INSTAGRAM_VERIFY_TOKEN: VERIFY,
  };
  getAccountMock.mockReset();
  getSubscriptionsMock.mockReset();
  subscribeMock.mockReset();
  effectiveTokenMock.mockReset();
  effectiveTokenMock.mockImplementation(async (token: string) => token);
  getAccountMock.mockResolvedValue(okGraph({ user_id: ACCOUNT_ID, username: "meditur_test" }));
  getSubscriptionsMock.mockResolvedValue(okGraph({ data: [{ id: "APP", subscribed_fields: ["comments", "messages"] }] }));
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("GET /api/settings/instagram", () => {
  it("without a token: account and subscribedFields are null and Graph is not called", async () => {
    process.env.INSTAGRAM_ACCESS_TOKEN = "";
    const res = await getStatus();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      configured: { accessToken: false, appSecret: true, verifyToken: true },
      whatsappNumber: "+992 00 550 77 77",
      callbackPath: "/api/instagram-webhook",
      account: null,
      subscribedFields: null,
    });
    expect(res.body).not.toHaveProperty("subscribeResult");
    expect(getAccountMock).not.toHaveBeenCalled();
    expect(getSubscriptionsMock).not.toHaveBeenCalled();
  });

  it("with a working token: returns the account id and username and the subscribed fields", async () => {
    const res = await getStatus();
    expect(res.body).toMatchObject({
      account: { id: ACCOUNT_ID, username: "meditur_test" },
      subscribedFields: ["comments", "messages"],
    });
    expect(getAccountMock).toHaveBeenCalledWith(expect.objectContaining({ accessToken: TOKEN }), TOKEN);
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("reports Graph errors as account.error and subscribedFields as null", async () => {
    getAccountMock.mockResolvedValue({ ok: false, status: 400, code: 190, message: "Invalid OAuth access token." });
    getSubscriptionsMock.mockResolvedValue({ ok: false, status: 400 });
    const res = await getStatus();
    expect(res.body).toMatchObject({
      account: { error: { status: 400, code: 190, message: "Invalid OAuth access token." } },
      subscribedFields: null,
    });
  });

  it("with ?subscribe=1 subscribes to comments and messages first, then re-reads the subscriptions", async () => {
    subscribeMock.mockResolvedValue(okGraph({ success: true }));
    const res = await getStatus("/api/settings/instagram?subscribe=1");
    expect(subscribeMock).toHaveBeenCalledWith(expect.objectContaining({ accessToken: TOKEN }), TOKEN, [
      "comments",
      "messages",
    ]);
    expect(subscribeMock.mock.invocationCallOrder[0]).toBeLessThan(getSubscriptionsMock.mock.invocationCallOrder[0]);
    expect(res.body).toMatchObject({ subscribeResult: { ok: true }, subscribedFields: ["comments", "messages"] });
  });

  it("with ?subscribe=1 reports a failed subscription with its status and code", async () => {
    subscribeMock.mockResolvedValue({ ok: false, status: 400, code: 100, message: "Unsupported field" });
    const res = await getStatus("/api/settings/instagram?subscribe=1");
    expect(res.body).toMatchObject({
      subscribeResult: { ok: false, status: 400, code: 100, message: "Unsupported field" },
    });
  });

  it("never returns the access token, the app secret or the verify token", async () => {
    process.env.INSTAGRAM_ACCESS_TOKEN = "fake-token-SETTINGS-7731";
    process.env.INSTAGRAM_APP_SECRET = "fake-secret-SETTINGS-9942";
    process.env.INSTAGRAM_VERIFY_TOKEN = "fake-verify-SETTINGS-5518";
    effectiveTokenMock.mockResolvedValue("fake-token-SETTINGS-7731");
    subscribeMock.mockResolvedValue(okGraph({ success: true }));
    const res = await getStatus("/api/settings/instagram?subscribe=1");
    expect(res.body).toMatchObject({ configured: { accessToken: true, appSecret: true, verifyToken: true } });
    for (const secret of ["7731", "9942", "5518"]) {
      expect(res.text).not.toContain(secret);
    }
  });
});

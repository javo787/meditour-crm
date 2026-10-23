import { createHmac } from "crypto";
import { testApiHandler } from "next-test-api-route-handler";

import { processInstagramEvents } from "@/lib/instagram/process";
import { GET, POST } from "../route";

jest.mock("@/lib/instagram/process", () => ({ processInstagramEvents: jest.fn() }));

const processMock = processInstagramEvents as jest.Mock;

const ACCOUNT = "17841400000000001";
const USER = "17841400000000002";
const SECRET = "fake-app-secret-for-route-tests";
const VERIFY = "fake-verify-token-for-route-tests";
const TOKEN = "fake-access-token-for-route-tests";
const CHALLENGE = "1158201444";

const COMMENT_BODY = {
  object: "instagram",
  entry: [
    {
      id: ACCOUNT,
      time: 1,
      changes: [
        {
          field: "comments",
          value: {
            id: "C1",
            text: "Сколько стоит?",
            from: { id: USER, username: "fake_user" },
            media: { id: "MEDIA1" },
          },
        },
      ],
    },
  ],
};

const ORIGINAL_ENV = process.env;

const sign = (raw: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;

async function getWebhook(query: Record<string, string>) {
  const out = { status: 0, text: "", contentType: "" };
  const qs = new URLSearchParams(query).toString();
  await testApiHandler({
    appHandler: { GET },
    url: `/api/instagram-webhook?${qs}`,
    test: async ({ fetch }) => {
      const res = await fetch({ method: "GET" });
      out.status = res.status;
      out.text = await res.text();
      out.contentType = res.headers.get("content-type") ?? "";
    },
  });
  return out;
}

async function postWebhook(raw: string, headers: Record<string, string> = {}) {
  const out = { status: 0, body: null as unknown };
  await testApiHandler({
    appHandler: { POST },
    url: "/api/instagram-webhook",
    test: async ({ fetch }) => {
      const res = await fetch({
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: raw,
      });
      out.status = res.status;
      out.body = await res.json();
    },
  });
  return out;
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    INSTAGRAM_APP_SECRET: SECRET,
    INSTAGRAM_VERIFY_TOKEN: VERIFY,
    INSTAGRAM_ACCESS_TOKEN: TOKEN,
  };
  processMock.mockReset();
  processMock.mockResolvedValue([]);
  // Журнал маршрута пишет в консоль: в тестах он молчит, а вызовы проверяются явно.
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = ORIGINAL_ENV;
});

describe("GET /api/instagram-webhook (проверка адреса)", () => {
  it("returns the challenge as text/plain for the right token and mode subscribe", async () => {
    const res = await getWebhook({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": CHALLENGE });
    expect(res.status).toBe(200);
    expect(res.text).toBe(CHALLENGE);
    expect(res.contentType).toMatch(/^text\/plain/);
  });

  it("returns 403 for a wrong token, including one of a different length", async () => {
    const wrong = await getWebhook({ "hub.mode": "subscribe", "hub.verify_token": "wrong-token", "hub.challenge": CHALLENGE });
    const short = await getWebhook({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": CHALLENGE });
    expect(wrong.status).toBe(403);
    expect(short.status).toBe(403);
    expect(wrong.text).not.toBe(CHALLENGE);
  });

  it("returns 403 for a mode other than subscribe", async () => {
    const res = await getWebhook({ "hub.mode": "unsubscribe", "hub.verify_token": VERIFY, "hub.challenge": CHALLENGE });
    expect(res.status).toBe(403);
  });

  it("returns 403 when the verify token is not configured, even for an empty token", async () => {
    process.env.INSTAGRAM_VERIFY_TOKEN = "";
    const res = await getWebhook({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": CHALLENGE });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/instagram-webhook (события)", () => {
  it("returns 503 not-configured and processes nothing when INSTAGRAM_APP_SECRET is missing", async () => {
    delete process.env.INSTAGRAM_APP_SECRET;
    const raw = JSON.stringify(COMMENT_BODY);
    const res = await postWebhook(raw, { "x-hub-signature-256": sign(raw) });
    expect(res).toEqual({ status: 503, body: { error: "not-configured" } });
    expect(processMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong signature and for a missing header", async () => {
    const raw = JSON.stringify(COMMENT_BODY);
    const wrong = await postWebhook(raw, { "x-hub-signature-256": `sha256=${"0".repeat(64)}` });
    const missing = await postWebhook(raw);
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("returns 400 for broken JSON that carries a valid signature over the raw body", async () => {
    const raw = "{не json";
    const res = await postWebhook(raw, { "x-hub-signature-256": sign(raw) });
    expect(res.status).toBe(400);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("returns 200 at once and hands the parsed events and the config to processing", async () => {
    const raw = JSON.stringify(COMMENT_BODY);
    const res = await postWebhook(raw, { "x-hub-signature-256": sign(raw) });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(processMock).toHaveBeenCalledWith(
      [
        {
          type: "comment",
          accountId: ACCOUNT,
          commentId: "C1",
          fromId: USER,
          fromUsername: "fake_user",
          text: "Сколько стоит?",
          mediaId: "MEDIA1",
        },
      ],
      expect.objectContaining({ cfg: expect.objectContaining({ accessToken: TOKEN, appSecret: SECRET }) }),
    );
  });

  it("still returns 200 when the background processing rejects, and logs the failure", async () => {
    processMock.mockRejectedValueOnce(new Error("processing failed"));
    const raw = JSON.stringify(COMMENT_BODY);
    const res = await postWebhook(raw, { "x-hub-signature-256": sign(raw) });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(console.error).toHaveBeenCalled();
  });

  it("still returns 200 for an empty event list or garbage in entry", async () => {
    for (const body of [{ object: "page" }, { object: "instagram", entry: "garbage" }]) {
      const raw = JSON.stringify(body);
      const res = await postWebhook(raw, { "x-hub-signature-256": sign(raw) });
      expect(res).toEqual({ status: 200, body: { ok: true } });
    }
    expect(processMock).toHaveBeenCalledTimes(2);
    expect(processMock).toHaveBeenNthCalledWith(1, [], expect.anything());
    expect(processMock).toHaveBeenNthCalledWith(2, [], expect.anything());
  });
});

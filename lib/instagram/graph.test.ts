import {
  getAccount,
  getSubscriptions,
  refreshAccessToken,
  replyToComment,
  sendDirect,
  subscribeAccount,
} from "./graph";

const cfg = { graphVersion: "v23.0" };
const TOKEN = "test-ig-token-0001";
const BASE = "https://graph.instagram.com/v23.0/";
const USER = "17841400000000002";
const COMMENT = "17900000000000100";

type FetchCall = [string, { method: string; headers: Record<string, string>; body?: string; signal?: unknown }];

// Имитация ответа fetch: json() без тела бросает, как настоящий ответ без JSON.
function reply(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  };
}

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

describe("Graph API client: запросы", () => {
  it("replyToComment публикует ответ на комментарий и возвращает id", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: "17900000000000500" }));

    const result = await replyToComment(cfg, TOKEN, COMMENT, "Спасибо!");

    expect(result).toEqual({ ok: true, data: { id: "17900000000000500" } });
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(`${BASE}${COMMENT}/replies`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ message: "Спасибо!" });
  });

  it("sendDirect шлёт личное сообщение по userId", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { recipient_id: USER, message_id: "aWdfZAG1f0000000000000009" }));

    const result = await sendDirect(cfg, TOKEN, { userId: USER }, "Hi");

    expect(result).toEqual({ ok: true, data: { recipient_id: USER, message_id: "aWdfZAG1f0000000000000009" } });
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(`${BASE}me/messages`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ recipient: { id: USER }, message: { text: "Hi" } });
  });

  it("sendDirect шлёт личный ответ на комментарий через comment_id", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { recipient_id: USER, message_id: "m1" }));

    await sendDirect(cfg, TOKEN, { commentId: COMMENT }, "Private reply");

    const [, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: { comment_id: COMMENT },
      message: { text: "Private reply" },
    });
  });

  it("getAccount запрашивает user_id и username без тела и Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { user_id: "17841400000000001", username: "sample_clinic" }));

    const result = await getAccount(cfg, TOKEN);

    expect(result).toEqual({ ok: true, data: { user_id: "17841400000000001", username: "sample_clinic" } });
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(`${BASE}me?fields=user_id,username`);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(init.body).toBeUndefined();
  });

  it("getSubscriptions читает подписки приложения", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { data: [{ id: "17841400000000001", subscribed_fields: ["comments"] }] }));

    const result = await getSubscriptions(cfg, TOKEN);

    expect(result).toEqual({
      ok: true,
      data: { data: [{ id: "17841400000000001", subscribed_fields: ["comments"] }] },
    });
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(`${BASE}me/subscribed_apps`);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it("subscribeAccount подписывает на список полей через запятую", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { success: true }));

    const result = await subscribeAccount(cfg, TOKEN, ["comments", "messages"]);

    expect(result).toEqual({ ok: true, data: { success: true } });
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(`${BASE}me/subscribed_apps?subscribed_fields=comments,messages`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
    expect(init.body).toBeUndefined();
  });

  it("refreshAccessToken обновляет токен по адресу без версии API, токен в query", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { access_token: "test-refreshed-token", expires_in: 5184000 }));

    const result = await refreshAccessToken(TOKEN);

    expect(result).toEqual({ ok: true, data: { access_token: "test-refreshed-token", expires_in: 5184000 } });
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${TOKEN}`,
    );
    expect(url).not.toContain("/v23.0/");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it("версия Graph API берётся из конфигурации", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: "1" }));

    await replyToComment({ graphVersion: "v24.0" }, TOKEN, COMMENT, "x");

    const [url] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(`https://graph.instagram.com/v24.0/${COMMENT}/replies`);
  });

  it("каждый запрос получает таймаут 10 секунд через сигнал", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: "1" }));

    await replyToComment(cfg, TOKEN, COMMENT, "x");

    const [, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("Graph API client: ошибки и повторы", () => {
  it("4xx: переносит code, subcode и message из тела ошибки и не повторяет запрос", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(400, {
        error: { message: "(#100) Invalid parameter", type: "OAuthException", code: 100, error_subcode: 2534014 },
      }),
    );

    const result = await replyToComment(cfg, TOKEN, COMMENT, "x", { retryDelayMs: 0 });

    expect(result).toEqual({ ok: false, status: 400, code: 100, subcode: 2534014, message: "(#100) Invalid parameter" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("4xx без JSON-тела возвращает только статус", async () => {
    fetchMock.mockResolvedValueOnce(reply(403));

    const result = await getSubscriptions(cfg, TOKEN);

    expect(result).toEqual({ ok: false, status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5xx повторяется один раз и при успехе возвращает данные", async () => {
    fetchMock.mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200, { id: "17900000000000700" }));

    const result = await replyToComment(cfg, TOKEN, COMMENT, "x", { retryDelayMs: 0 });

    expect(result).toEqual({ ok: true, data: { id: "17900000000000700" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("5xx дважды даёт ошибку со статусом после одного повтора", async () => {
    fetchMock.mockResolvedValueOnce(reply(502)).mockResolvedValueOnce(reply(502));

    const result = await getAccount(cfg, TOKEN, { retryDelayMs: 0 });

    expect(result).toEqual({ ok: false, status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("сетевая ошибка повторяется и при повторном сбое даёт статус 0", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await subscribeAccount(cfg, TOKEN, ["comments"], { retryDelayMs: 0 });

    expect(result).toEqual({ ok: false, status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("сетевая ошибка, затем успех, возвращает успешный результат", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(reply(200, { success: true }));

    const result = await subscribeAccount(cfg, TOKEN, ["comments"], { retryDelayMs: 0 });

    expect(result).toEqual({ ok: true, data: { success: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("по умолчанию ждёт 1500 мс перед повтором", async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValueOnce(reply(500)).mockResolvedValueOnce(reply(200, { id: "1" }));

    const pending = replyToComment(cfg, TOKEN, COMMENT, "x");
    await jest.advanceTimersByTimeAsync(1499);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: true, data: { id: "1" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("токен не попадает в возвращаемое сообщение об ошибке", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { error: { message: `Invalid OAuth access token ${TOKEN}`, code: 190 } }));

    const result = await getAccount(cfg, TOKEN);

    expect(result).toEqual({ ok: false, status: 401, code: 190, message: "Invalid OAuth access token [redacted]" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("ошибка сети не возвращает текст исключения, в котором мог оказаться токен", async () => {
    fetchMock.mockRejectedValue(new Error(`connect failed for access_token=${TOKEN}`));

    const result = await refreshAccessToken(TOKEN, { retryDelayMs: 0 });

    expect(result).toEqual({ ok: false, status: 0 });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("ни один вызов не бросает исключение, даже при неожиданном ответе", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));

    await expect(sendDirect(cfg, TOKEN, { userId: USER }, "x", { retryDelayMs: 0 })).resolves.toEqual({ ok: false, status: 0 });
  });
});

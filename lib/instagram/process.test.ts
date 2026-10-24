import type { Logger } from "@/lib/logger";

import type { InstagramConfig } from "./config";
import { processInstagramEvents, resetBotSendLogForTests, type ProcessDeps } from "./process";
import { buildCommentPrivateReply, buildCommentReply, buildDirectInvite } from "./replies";
import type { IgMessageFrom, InstagramContact } from "./store";
import type { InstagramEvent } from "./webhook";

const ACCOUNT = "17841400000000001";
const USER = "17841400000000002";
const OTHER = "17841400000000003";
const TOKEN = "fake-token-for-process-tests";
const NOW = new Date("2026-10-22T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const RU_QUESTION = "Здравствуйте, сколько стоит лечение?";

const cfg: InstagramConfig = {
  enabled: true,
  accessToken: TOKEN,
  appSecret: "fake-secret-for-process-tests",
  verifyToken: "fake-verify-for-process-tests",
  graphVersion: "v23.0",
  whatsappNumber: "+992 00 550 77 77",
  whatsappDigits: "992005507777",
  dmCooldownMs: 12 * HOUR,
  commentCooldownMs: 6 * HOUR,
  replyDelay: true,
  aiReplies: false,
  aiDailyLimit: 30,
};
const CTX ={ whatsappNumber: cfg.whatsappNumber, whatsappDigits: cfg.whatsappDigits };

type CommentEvent = Extract<InstagramEvent, { type: "comment" }>;
type DmEvent = Extract<InstagramEvent, { type: "dm" }>;
type EchoEvent = Extract<InstagramEvent, { type: "echo" }>;

const comment = (over: Partial<CommentEvent> = {}): CommentEvent => ({
  type: "comment",
  accountId: ACCOUNT,
  commentId: "C1",
  fromId: USER,
  text: RU_QUESTION,
  ...over,
});
const dm = (over: Partial<DmEvent> = {}): DmEvent => ({
  type: "dm",
  accountId: ACCOUNT,
  mid: "M1",
  senderId: USER,
  text: "Здравствуйте, хочу узнать про лечение",
  hasAttachment: false,
  ...over,
});
const echo = (over: Partial<EchoEvent> = {}): EchoEvent => ({
  type: "echo",
  accountId: ACCOUNT,
  mid: "E1",
  recipientId: USER,
  ...over,
});

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = (status: number, code?: number) =>
  code === undefined ? { ok: false as const, status } : { ok: false as const, status, code };

type FakeMsg = { igUserId: string; from: IgMessageFrom; text: string; at: string; mid?: string };
type HarnessOpts = {
  cfg?: Partial<InstagramConfig>;
  contacts?: Record<string, InstagramContact>;
  random?: () => number;
  messages?: FakeMsg[];
  now?: () => Date;
};

// Хранилище в памяти: отметки, журнал событий и переписка ведут себя как в MongoDB.
function fakeStore(contacts: Record<string, InstagramContact> = {}, seed: FakeMsg[] = []) {
  const seen = new Set<string>();
  const messages: FakeMsg[] = [...seed];
  return {
    messages,
    claimEvent: jest.fn(async (key: string) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    getContact: jest.fn(async (id: string) => contacts[id] ?? null),
    markDmInvited: jest.fn(async (id: string, now: Date = new Date()) => {
      contacts[id] = { ...contacts[id], _id: id, lastDmInviteAt: now.toISOString() };
    }),
    markCommentReplied: jest.fn(async (id: string, now: Date = new Date()) => {
      contacts[id] = { ...contacts[id], _id: id, lastCommentReplyAt: now.toISOString() };
    }),
    addIgMessage: jest.fn(
      async (m: { igUserId: string; from: IgMessageFrom; text: string; at?: Date; mid?: string }) => {
        messages.push({
          igUserId: m.igUserId,
          from: m.from,
          text: m.text,
          at: (m.at ?? NOW).toISOString(),
          ...(m.mid !== undefined ? { mid: m.mid } : {}),
        });
      },
    ),
    getIgMessages: jest.fn(async (igUserId: string, limit = 30) =>
      messages
        .filter((m) => m.igUserId === igUserId)
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
        .slice(-limit)
        .map((m, i) => ({ id: `${igUserId}-${i}`, leadId: igUserId, from: m.from, text: m.text, at: m.at })),
    ),
    countIgAiMessagesSince: jest.fn(
      async (igUserId: string, sinceIso: string) =>
        messages.filter((m) => m.igUserId === igUserId && m.from === "ai" && m.at >= sinceIso).length,
    ),
    pauseAi: jest.fn(async (id: string, until: Date) => {
      contacts[id] = { ...contacts[id], _id: id, aiPausedUntil: until.toISOString() };
    }),
    findIgMessageByMid: jest.fn(async (mid: string) => messages.some((m) => m.mid === mid)),
  };
}

function fakeGraph() {
  return {
    replyToComment: jest.fn().mockResolvedValue(ok({ id: "R1" })),
    sendDirect: jest.fn().mockResolvedValue(ok({ recipient_id: USER, message_id: "S1" })),
  };
}

// Подставная модель: по умолчанию отвечает одним пузырём.
function fakeAi() {
  return { composeDirectReply: jest.fn().mockResolvedValue({ kind: "reply", bubbles: ["Ответ на ваш вопрос."] }) };
}

function fakeLog() {
  const info = jest.fn();
  const warn = jest.fn();
  const error = jest.fn();
  const log: Logger = { info, warn, error, child: () => log };
  return { log, info, warn, error };
}

function harness(opts: HarnessOpts = {}) {
  const store = fakeStore(opts.contacts, opts.messages);
  const graph = fakeGraph();
  const logs = fakeLog();
  const sleep = jest.fn().mockResolvedValue(undefined);
  const getToken = jest.fn().mockResolvedValue(TOKEN);
  const ai = fakeAi();
  const deps: ProcessDeps = {
    cfg: { ...cfg, ...opts.cfg },
    now: opts.now ?? (() => NOW),
    sleep,
    random: opts.random ?? (() => 0.5),
    log: logs.log,
    getToken,
    store,
    graph,
    ai,
  };
  return { deps, store, graph, logs, sleep, getToken, ai };
}

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

describe("comments", () => {
  it("sends the public reply and the private reply with the exact template texts and the token", async () => {
    const h = harness();
    const out = await processInstagramEvents([comment()], h.deps);

    const publicText = buildCommentReply({ text: RU_QUESTION, commentId: "C1", ...CTX });
    const privateText = buildCommentPrivateReply({ text: RU_QUESTION, ...CTX });
    expect(publicText).toContain("+992 00 550 77 77");
    expect(privateText).toContain("https://wa.me/992005507777");
    expect(h.graph.replyToComment).toHaveBeenCalledWith(cfg, TOKEN, "C1", publicText);
    expect(h.graph.sendDirect).toHaveBeenCalledWith(cfg, TOKEN, { commentId: "C1" }, privateText);
    expect(h.store.claimEvent).toHaveBeenCalledWith("comment:C1", NOW);
    expect(h.store.markCommentReplied).toHaveBeenCalledWith(USER, NOW);
    expect(h.store.markDmInvited).toHaveBeenCalledWith(USER, NOW);
    expect(h.getToken).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ key: "comment:C1", outcome: "replied" }]);
  });

  it("skips our own comment without any request", async () => {
    const h = harness();
    const out = await processInstagramEvents([comment({ fromId: ACCOUNT })], h.deps);
    expect(out).toEqual([{ key: "comment:C1", outcome: "skipped", reason: "own" }]);
    expect(h.store.claimEvent).not.toHaveBeenCalled();
    expect(h.graph.replyToComment).not.toHaveBeenCalled();
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });

  it("skips a reply to a comment (parentId is set)", async () => {
    const h = harness();
    const out = await processInstagramEvents([comment({ parentId: "P1" })], h.deps);
    expect(out).toEqual([{ key: "comment:C1", outcome: "skipped", reason: "reply" }]);
    expect(h.graph.replyToComment).not.toHaveBeenCalled();
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });

  it("skips an emoji-only comment", async () => {
    const h = harness();
    const out = await processInstagramEvents([comment({ text: "🔥🔥🔥" })], h.deps);
    expect(out).toEqual([{ key: "comment:C1", outcome: "skipped", reason: "not-worth" }]);
    expect(h.graph.replyToComment).not.toHaveBeenCalled();
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });

  it("a duplicate delivery of the same comment sends nothing", async () => {
    const h = harness();
    h.store.claimEvent.mockResolvedValueOnce(false);
    const out = await processInstagramEvents([comment()], h.deps);
    expect(out).toEqual([{ key: "comment:C1", outcome: "skipped", reason: "duplicate" }]);
    expect(h.store.markCommentReplied).not.toHaveBeenCalled();
    expect(h.graph.replyToComment).not.toHaveBeenCalled();
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });

  it("comment cooldown: neither the public nor the private reply is sent", async () => {
    const h = harness({ contacts: { [USER]: { _id: USER, lastCommentReplyAt: hoursAgo(1) } } });
    const out = await processInstagramEvents([comment()], h.deps);
    expect(out).toEqual([{ key: "comment:C1", outcome: "skipped", reason: "cooldown" }]);
    expect(h.store.markCommentReplied).not.toHaveBeenCalled();
    expect(h.graph.replyToComment).not.toHaveBeenCalled();
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });

  it("the private reply is skipped inside the DM cooldown while the public reply is still sent", async () => {
    const h = harness({ contacts: { [USER]: { _id: USER, lastDmInviteAt: hoursAgo(1) } } });
    const out = await processInstagramEvents([comment()], h.deps);
    expect(h.graph.replyToComment).toHaveBeenCalledTimes(1);
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
    expect(out).toEqual([{ key: "comment:C1", outcome: "replied" }]);
  });

  it("re-reads the contact before the private reply: a DM invitation made during the pause suppresses it", async () => {
    const h = harness();
    h.store.getContact
      .mockResolvedValueOnce({ _id: USER })
      .mockResolvedValueOnce({ _id: USER, lastDmInviteAt: NOW.toISOString() });
    const out = await processInstagramEvents([comment()], h.deps);
    expect(h.graph.replyToComment).toHaveBeenCalledTimes(1);
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
    expect(out).toEqual([{ key: "comment:C1", outcome: "replied" }]);
  });

  it("a failed public reply does not stop the private reply", async () => {
    const h = harness();
    h.graph.replyToComment.mockResolvedValueOnce(fail(400, 100));
    const out = await processInstagramEvents([comment()], h.deps);
    expect(h.graph.sendDirect).toHaveBeenCalledTimes(1);
    expect(h.store.markDmInvited).toHaveBeenCalledWith(USER, NOW);
    expect(h.logs.error).toHaveBeenCalled();
    expect(out).toEqual([{ key: "comment:C1", outcome: "replied" }]);
  });

  it("both replies failing gives 'failed' with the codes and does not throw", async () => {
    const h = harness();
    h.graph.replyToComment.mockResolvedValueOnce(fail(400, 100));
    h.graph.sendDirect.mockResolvedValueOnce(fail(403, 10));
    const out = await processInstagramEvents([comment()], h.deps);
    expect(out).toEqual([
      {
        key: "comment:C1",
        outcome: "failed",
        reason: "public status 400, code 100; private status 403, code 10",
      },
    ]);
    expect(h.store.markDmInvited).not.toHaveBeenCalled();
  });
});

describe("direct messages", () => {
  it("answers a Russian message with the Russian invitation", async () => {
    const h = harness();
    const out = await processInstagramEvents([dm()], h.deps);
    const text = buildDirectInvite({ text: "Здравствуйте, хочу узнать про лечение", ...CTX });
    expect(text).toContain("https://wa.me/992005507777");
    expect(h.graph.sendDirect).toHaveBeenCalledWith(cfg, TOKEN, { userId: USER }, text);
    expect(h.store.markDmInvited).toHaveBeenCalledWith(USER, NOW);
    expect(out).toEqual([{ key: "dm:M1", outcome: "replied" }]);
  });

  it("answers an English message with the English invitation", async () => {
    const h = harness();
    await processInstagramEvents([dm({ text: "Hi, how much is treatment in India?" })], h.deps);
    const sent = h.graph.sendDirect.mock.calls[0][3] as string;
    expect(sent).toBe(buildDirectInvite({ text: "Hi, how much is treatment in India?", ...CTX }));
    expect(sent).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(sent).toContain("https://wa.me/992005507777");
  });

  it("DM cooldown: no invitation is sent", async () => {
    const h = harness({ contacts: { [USER]: { _id: USER, lastDmInviteAt: hoursAgo(1) } } });
    const out = await processInstagramEvents([dm()], h.deps);
    expect(out).toEqual([{ key: "dm:M1", outcome: "skipped", reason: "cooldown" }]);
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
    expect(h.store.markDmInvited).not.toHaveBeenCalled();
  });

  it("a duplicate mid sends nothing", async () => {
    const h = harness();
    h.store.claimEvent.mockResolvedValueOnce(false);
    const out = await processInstagramEvents([dm()], h.deps);
    expect(out).toEqual([{ key: "dm:M1", outcome: "skipped", reason: "duplicate" }]);
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });

  it("our own message is skipped before any claim", async () => {
    const h = harness();
    const out = await processInstagramEvents([dm({ senderId: ACCOUNT })], h.deps);
    expect(out).toEqual([{ key: "dm:M1", outcome: "skipped", reason: "own" }]);
    expect(h.store.claimEvent).not.toHaveBeenCalled();
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });

  it("two messages from one sender in one batch produce exactly one invitation", async () => {
    const h = harness();
    const out = await processInstagramEvents([dm({ mid: "M1" }), dm({ mid: "M2" })], h.deps);
    expect(h.graph.sendDirect).toHaveBeenCalledTimes(1);
    expect(out.map((o) => o.outcome).sort()).toEqual(["replied", "skipped"]);
    expect(out.find((o) => o.outcome === "skipped")).toMatchObject({ reason: "inflight" });

    // Следующее сообщение позже той же пачки упирается в cooldown: отметка уже стоит.
    const later = await processInstagramEvents([dm({ mid: "M3" })], h.deps);
    expect(later).toEqual([{ key: "dm:M3", outcome: "skipped", reason: "cooldown" }]);
    expect(h.graph.sendDirect).toHaveBeenCalledTimes(1);
  });
});

describe("echoes", () => {
  it("marks the contact for the DM cooldown and sends nothing", async () => {
    const h = harness();
    const out = await processInstagramEvents([echo()], h.deps);
    expect(h.store.markDmInvited).toHaveBeenCalledWith(USER, NOW);
    expect(out).toEqual([{ key: "echo:E1", outcome: "skipped", reason: "echo" }]);
    expect(h.graph.replyToComment).not.toHaveBeenCalled();
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });

  it("an echo to our own account is ignored", async () => {
    const h = harness();
    const out = await processInstagramEvents([echo({ recipientId: ACCOUNT })], h.deps);
    expect(out).toEqual([{ key: "echo:E1", outcome: "skipped", reason: "own" }]);
    expect(h.store.markDmInvited).not.toHaveBeenCalled();
  });
});

describe("switches and tokens", () => {
  it("with the auto-reply disabled every event is skipped, echoes included, and nothing is requested", async () => {
    const h = harness({ cfg: { enabled: false } });
    const out = await processInstagramEvents([comment(), dm(), echo()], h.deps);
    expect(out.map((o) => [o.key, o.reason])).toEqual([
      ["comment:C1", "disabled"],
      ["dm:M1", "disabled"],
      ["echo:E1", "disabled"],
    ]);
    expect(h.store.claimEvent).not.toHaveBeenCalled();
    expect(h.store.markDmInvited).not.toHaveBeenCalled();
    expect(h.graph.replyToComment).not.toHaveBeenCalled();
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });

  it("without an access token every event is skipped with one warning", async () => {
    const h = harness({ cfg: { accessToken: "" } });
    const out = await processInstagramEvents([comment(), dm()], h.deps);
    expect(out.map((o) => o.reason)).toEqual(["no-token", "no-token"]);
    expect(h.logs.warn).toHaveBeenCalledTimes(1);
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.graph.sendDirect).not.toHaveBeenCalled();
  });
});

describe("delays", () => {
  it("with random() = 0 the pauses are the lower bounds: 15000 and 2000 for a comment, 4000 for a DM", async () => {
    const c = harness({ random: () => 0 });
    await processInstagramEvents([comment()], c.deps);
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([15000, 2000]);

    const d = harness({ random: () => 0 });
    await processInstagramEvents([dm()], d.deps);
    expect(d.sleep.mock.calls.map(([ms]) => ms)).toEqual([4000]);
  });

  it("with random() close to 1 the pauses stay inside the ranges", async () => {
    const c = harness({ random: () => 0.999999 });
    await processInstagramEvents([comment()], c.deps);
    const [publicDelay, privateDelay] = c.sleep.mock.calls.map(([ms]) => ms as number);
    expect(publicDelay).toBeGreaterThanOrEqual(15000);
    expect(publicDelay).toBeLessThan(45000);
    expect(privateDelay).toBeGreaterThanOrEqual(2000);
    expect(privateDelay).toBeLessThan(6000);

    const d = harness({ random: () => 0.999999 });
    await processInstagramEvents([dm()], d.deps);
    const [dmDelay] = d.sleep.mock.calls.map(([ms]) => ms as number);
    expect(dmDelay).toBeGreaterThanOrEqual(4000);
    expect(dmDelay).toBeLessThan(10000);
  });

  it("with replyDelay off sleep is never called", async () => {
    const h = harness({ cfg: { replyDelay: false } });
    const out = await processInstagramEvents([comment(), dm({ mid: "M2", senderId: OTHER })], h.deps);
    expect(h.sleep).not.toHaveBeenCalled();
    expect(out.map((o) => o.outcome)).toEqual(["replied", "replied"]);
  });
});

describe("isolation and logging", () => {
  it("a throwing store call in one event does not stop another event", async () => {
    const h = harness();
    h.store.claimEvent.mockImplementation(async (key: string) => {
      if (key === "dm:M-BAD") throw new Error("boom");
      return true;
    });
    const out = await processInstagramEvents(
      [dm({ mid: "M-BAD" }), dm({ mid: "M-OK", senderId: OTHER })],
      h.deps,
    );
    expect(out).toEqual([
      { key: "dm:M-BAD", outcome: "failed", reason: "exception" },
      { key: "dm:M-OK", outcome: "replied" },
    ]);
  });

  it("a rejecting graph call in one event does not stop another event", async () => {
    const h = harness();
    h.graph.sendDirect.mockImplementation(async (_cfg: unknown, _token: unknown, target: { userId?: string }) => {
      if (target.userId === USER) throw new Error("network");
      return ok({ recipient_id: OTHER, message_id: "S2" });
    });
    const out = await processInstagramEvents([dm({ mid: "M1" }), comment({ commentId: "C2", fromId: OTHER })], h.deps);
    expect(out).toEqual([
      { key: "dm:M1", outcome: "failed", reason: "exception" },
      { key: "comment:C2", outcome: "replied" },
    ]);
  });

  it("no log call contains the message text or the token", async () => {
    const secret = "Секретный текст пациента 4815162342";
    const h = harness();
    h.graph.replyToComment.mockResolvedValueOnce(fail(400, 100));
    await processInstagramEvents([comment({ text: secret }), dm({ mid: "M9", senderId: OTHER, text: secret })], h.deps);

    const logged = JSON.stringify([h.logs.info.mock.calls, h.logs.warn.mock.calls, h.logs.error.mock.calls]);
    expect(h.logs.info).toHaveBeenCalled();
    expect(h.logs.error).toHaveBeenCalled();
    expect(logged).not.toContain("Секретный");
    expect(logged).not.toContain(TOKEN);
  });
});

describe("AI mode", () => {
  beforeEach(() => resetBotSendLogForTests());

  const NOW_ISO = NOW.toISOString();
  const aiHarness = (opts: HarnessOpts = {}) => harness({ ...opts, cfg: { aiReplies: true, ...opts.cfg } });
  const seeded = (from: IgMessageFrom, text: string, at: string, mid?: string): FakeMsg =>
    mid === undefined ? { igUserId: USER, from, text, at } : { igUserId: USER, from, text, at, mid };
  const sent = (mid: string) => ok({ recipient_id: USER, message_id: mid });
  const sentTexts = (h: ReturnType<typeof harness>) => h.graph.sendDirect.mock.calls.map((c) => c[3]);
  const invite = (text: string) => buildDirectInvite({ text, ...CTX });
  const RU_FIRST = "Здравствуйте, хочу узнать про лечение";

  describe("first contact", () => {
    it("sends the template invitation, stores it as an AI message with its mid and stores the incoming message", async () => {
      const h = aiHarness();
      const out = await processInstagramEvents([dm()], h.deps);

      expect(h.graph.sendDirect).toHaveBeenCalledWith(h.deps.cfg, TOKEN, { userId: USER }, invite(RU_FIRST));
      expect(h.ai.composeDirectReply).not.toHaveBeenCalled();
      expect(h.store.messages).toEqual([
        seeded("patient", RU_FIRST, NOW_ISO, "M1"),
        seeded("ai", invite(RU_FIRST), NOW_ISO, "S1"),
      ]);
      expect(out).toEqual([{ key: "dm:M1", outcome: "replied" }]);
    });

    it("inside the DM cooldown a first contact gets no invitation, but the message is still stored", async () => {
      const h = aiHarness({ contacts: { [USER]: { _id: USER, lastDmInviteAt: hoursAgo(1) } } });
      const out = await processInstagramEvents([dm()], h.deps);

      expect(h.graph.sendDirect).not.toHaveBeenCalled();
      expect(h.store.messages).toEqual([seeded("patient", RU_FIRST, NOW_ISO, "M1")]);
      expect(out).toEqual([{ key: "dm:M1", outcome: "skipped", reason: "cooldown" }]);
    });

    it("an attachment-only message is stored as a placeholder and gets the template invitation", async () => {
      const h = aiHarness();
      const out = await processInstagramEvents([dm({ text: undefined, hasAttachment: true })], h.deps);

      expect(h.store.messages[0]).toEqual(seeded("patient", "[вложение]", NOW_ISO, "M1"));
      expect(sentTexts(h)).toEqual([invite("[вложение]")]);
      expect(out).toEqual([{ key: "dm:M1", outcome: "replied" }]);
    });
  });

  describe("answers from the model", () => {
    it("the history before the new messages is the base, the new text is the item, bubbles go in order with pauses and each is stored", async () => {
      const h = aiHarness({
        messages: [
          seeded("patient", "Привет", hoursAgo(2), "P0"),
          seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0"),
        ],
      });
      h.ai.composeDirectReply.mockResolvedValueOnce({ kind: "reply", bubbles: ["Первый пузырь", "Второй пузырь"] });
      h.graph.sendDirect.mockResolvedValueOnce(sent("S10")).mockResolvedValueOnce(sent("S11"));

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Сколько стоит МРТ?" })], h.deps);

      expect(h.ai.composeDirectReply).toHaveBeenCalledTimes(1);
      const [params] = h.ai.composeDirectReply.mock.calls[0];
      expect(params.history.map((m: { from: string; text: string }) => [m.from, m.text])).toEqual([
        ["patient", "Привет"],
        ["ai", "Здравствуйте!"],
      ]);
      expect(params.items).toEqual([{ text: "Сколько стоит МРТ?" }]);
      expect(params.ctx).toEqual(CTX);
      expect(params.now).toEqual(NOW);

      expect(sentTexts(h)).toEqual(["Первый пузырь", "Второй пузырь"]);
      expect(h.sleep.mock.calls.map(([ms]) => ms)).toEqual([7000, 2500]);
      expect(h.store.messages).toEqual([
        seeded("patient", "Привет", hoursAgo(2), "P0"),
        seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0"),
        seeded("patient", "Сколько стоит МРТ?", NOW_ISO, "M2"),
        seeded("ai", "Первый пузырь", NOW_ISO, "S10"),
        seeded("ai", "Второй пузырь", NOW_ISO, "S11"),
      ]);
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("a burst: two trailing patient messages are answered by one AI call with both items", async () => {
      const h = aiHarness({
        messages: [
          seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0"),
          seeded("patient", "Сколько стоит МРТ?", hoursAgo(0.1), "P1"),
        ],
      });
      h.ai.composeDirectReply.mockResolvedValueOnce({ kind: "reply", bubbles: ["Ответ на оба вопроса."] });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "А документы нужны?" })], h.deps);

      expect(h.ai.composeDirectReply).toHaveBeenCalledTimes(1);
      const [params] = h.ai.composeDirectReply.mock.calls[0];
      expect(params.items).toEqual([{ text: "Сколько стоит МРТ?" }, { text: "А документы нужны?" }]);
      expect(params.history.map((m: { text: string }) => m.text)).toEqual(["Здравствуйте!"]);
      expect(sentTexts(h)).toEqual(["Ответ на оба вопроса."]);
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("an attachment-only message in an ongoing dialogue is stored as a placeholder and answered by the model", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });

      const out = await processInstagramEvents([dm({ mid: "M2", text: undefined, hasAttachment: true })], h.deps);

      const [params] = h.ai.composeDirectReply.mock.calls[0];
      expect(params.items).toEqual([{ text: "[вложение]" }]);
      expect(h.store.messages).toContainEqual(seeded("patient", "[вложение]", NOW_ISO, "M2"));
      expect(sentTexts(h)).toEqual(["Ответ на ваш вопрос."]);
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("a message that arrives while the model is thinking is answered in a second turn", async () => {
      // Часы идут: пока модель думает, приходит второй вопрос.
      let clock = NOW;
      const h = aiHarness({ now: () => clock, messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });
      const LATER = new Date(NOW.getTime() + 1000);
      h.ai.composeDirectReply
        .mockImplementationOnce(async () => {
          clock = LATER;
          h.store.messages.push(seeded("patient", "Второй вопрос", LATER.toISOString(), "M3"));
          return { kind: "reply", bubbles: ["Ответ на первый."] };
        })
        .mockResolvedValueOnce({ kind: "reply", bubbles: ["Ответ на второй."] });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Первый вопрос" })], h.deps);

      const asked = h.ai.composeDirectReply.mock.calls.map(([p]) => p.items.map((i: { text: string }) => i.text));
      expect(asked).toEqual([["Первый вопрос"], ["Второй вопрос"]]);
      expect(sentTexts(h)).toEqual(["Ответ на первый.", "Ответ на второй."]);
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("a message merged into a busy turn is still answered by that turn, even when it arrives during the final check", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });
      const readHistory = h.store.getIgMessages.getMockImplementation()!;
      let reads = 0;
      let mergedOut: unknown;
      h.store.getIgMessages.mockImplementation(async (igUserId: string, limit?: number) => {
        const snapshot = await readHistory(igUserId, limit);
        reads += 1;
        if (reads === 3) {
          // Холдер уже увидел, что отвечать нечего; новое сообщение приходит, пока блокировка ещё занята.
          mergedOut = await processInstagramEvents([dm({ mid: "M3", text: "Ещё вопрос" })], h.deps);
        }
        return snapshot;
      });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Первый вопрос" })], h.deps);

      expect(mergedOut).toEqual([{ key: "dm:M3", outcome: "skipped", reason: "merged" }]);
      const asked = h.ai.composeDirectReply.mock.calls.map(([p]) => p.items.map((i: { text: string }) => i.text));
      expect(asked).toEqual([["Первый вопрос"], ["Ещё вопрос"]]);
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("two messages of one sender in one batch: the second is merged and each message is answered exactly once", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });

      const out = await processInstagramEvents(
        [dm({ mid: "M2", text: "Первый вопрос" }), dm({ mid: "M3", text: "Второй вопрос" })],
        h.deps,
      );

      const asked = h.ai.composeDirectReply.mock.calls.flatMap(([p]) => p.items.map((i: { text: string }) => i.text));
      expect(asked).toEqual(["Первый вопрос", "Второй вопрос"]);
      expect(out).toEqual([
        { key: "dm:M2", outcome: "replied" },
        { key: "dm:M3", outcome: "skipped", reason: "merged" },
      ]);
    });

    it("a second bubble that fails to send stops the sending: no third bubble, the first one is stored", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });
      h.ai.composeDirectReply.mockResolvedValueOnce({ kind: "reply", bubbles: ["Один", "Два", "Три"] });
      h.graph.sendDirect.mockResolvedValueOnce(sent("S10")).mockResolvedValueOnce(fail(500));

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" })], h.deps);

      expect(sentTexts(h)).toEqual(["Один", "Два"]);
      expect(h.store.messages.slice(-2)).toEqual([
        seeded("patient", "Вопрос", NOW_ISO, "M2"),
        seeded("ai", "Один", NOW_ISO, "S10"),
      ]);
      expect(h.logs.error).toHaveBeenCalled();
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("when the first bubble fails nothing is stored and the event is failed with the status and code", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });
      h.ai.composeDirectReply.mockResolvedValueOnce({ kind: "reply", bubbles: ["Один", "Два"] });
      h.graph.sendDirect.mockResolvedValueOnce(fail(400, 100));

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" })], h.deps);

      expect(sentTexts(h)).toEqual(["Один"]);
      expect(h.store.messages.at(-1)).toEqual(seeded("patient", "Вопрос", NOW_ISO, "M2"));
      expect(out).toEqual([{ key: "dm:M2", outcome: "failed", reason: "status 400, code 100" }]);
    });

    it("a patient message with a trailing AI answer that is already in the store is not asked again", async () => {
      const h = aiHarness({
        messages: [seeded("patient", "Вопрос", hoursAgo(2), "P1"), seeded("ai", "Ответ", hoursAgo(1), "AI1")],
      });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Ещё вопрос" })], h.deps);

      const [params] = h.ai.composeDirectReply.mock.calls[0];
      expect(params.items).toEqual([{ text: "Ещё вопрос" }]);
      expect(params.history.map((m: { text: string }) => m.text)).toEqual(["Вопрос", "Ответ"]);
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("a staff reply that arrives while the AI is preparing its answer cancels that answer", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });
      h.sleep.mockImplementationOnce(async () => {
        h.store.messages.push(seeded("coordinator", "Сейчас ответим сами", NOW_ISO, "E7"));
      });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Сколько стоит?" })], h.deps);

      expect(h.ai.composeDirectReply).not.toHaveBeenCalled();
      expect(h.graph.sendDirect).not.toHaveBeenCalled();
      expect(out).toEqual([{ key: "dm:M2", outcome: "skipped", reason: "answered" }]);
    });
  });

  describe("limits, pauses and fallbacks", () => {
    it("a paused contact: the message is stored, nothing is sent or asked", async () => {
      const h = aiHarness({
        contacts: { [USER]: { _id: USER, aiPausedUntil: new Date(NOW.getTime() + HOUR).toISOString() } },
        messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")],
      });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" })], h.deps);

      expect(h.store.messages.at(-1)).toEqual(seeded("patient", "Вопрос", NOW_ISO, "M2"));
      expect(h.ai.composeDirectReply).not.toHaveBeenCalled();
      expect(h.graph.sendDirect).not.toHaveBeenCalled();
      expect(out).toEqual([{ key: "dm:M2", outcome: "skipped", reason: "paused" }]);
    });

    it("the daily limit: after the limit only the message is stored", async () => {
      const h = aiHarness({
        cfg: { aiDailyLimit: 2 },
        messages: [
          seeded("patient", "Раз", hoursAgo(5), "P1"),
          seeded("ai", "Ответ раз", hoursAgo(4), "AI1"),
          seeded("patient", "Два", hoursAgo(3), "P2"),
          seeded("ai", "Ответ два", hoursAgo(2), "AI2"),
        ],
      });

      const out = await processInstagramEvents([dm({ mid: "M9", text: "Три" })], h.deps);

      expect(h.ai.composeDirectReply).not.toHaveBeenCalled();
      expect(h.graph.sendDirect).not.toHaveBeenCalled();
      expect(h.store.messages.at(-1)).toEqual(seeded("patient", "Три", NOW_ISO, "M9"));
      expect(out).toEqual([{ key: "dm:M9", outcome: "skipped", reason: "limit" }]);
    });

    it("AI replies older than 24 hours do not count against the daily limit", async () => {
      const h = aiHarness({
        cfg: { aiDailyLimit: 2 },
        messages: [
          seeded("patient", "Давно", hoursAgo(26), "P0"),
          seeded("ai", "Старый ответ", hoursAgo(25), "AI0"),
          seeded("ai", "Недавний ответ", hoursAgo(1), "AI1"),
        ],
      });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" })], h.deps);

      expect(h.ai.composeDirectReply).toHaveBeenCalledTimes(1);
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("a handoff sends the template invitation and pauses the AI for the DM cooldown", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });
      h.ai.composeDirectReply.mockResolvedValueOnce({ kind: "handoff" });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Хочу поговорить с врачом" })], h.deps);

      expect(sentTexts(h)).toEqual([invite("Хочу поговорить с врачом")]);
      expect(h.store.pauseAi).toHaveBeenCalledWith(USER, new Date(NOW.getTime() + 12 * HOUR));
      expect(h.store.messages.at(-1)).toEqual(seeded("ai", invite("Хочу поговорить с врачом"), NOW_ISO, "S1"));
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("a suppressed reply falls back to the template invitation", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });
      h.ai.composeDirectReply.mockResolvedValueOnce({ kind: "none", reason: "arabic-script" });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" })], h.deps);

      expect(sentTexts(h)).toEqual([invite("Вопрос")]);
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
    });

    it("a suppressed reply inside the DM cooldown stays silent", async () => {
      const h = aiHarness({
        contacts: { [USER]: { _id: USER, lastDmInviteAt: hoursAgo(1) } },
        messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")],
      });
      h.ai.composeDirectReply.mockResolvedValueOnce({ kind: "none", reason: "empty" });

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" })], h.deps);

      expect(h.graph.sendDirect).not.toHaveBeenCalled();
      expect(out).toEqual([{ key: "dm:M2", outcome: "skipped", reason: "cooldown" }]);
    });

    it("a thrown error from the model falls back to the template, and its text never reaches the log", async () => {
      const secret = "Секретный сбой 4815162342";
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });
      h.ai.composeDirectReply.mockRejectedValueOnce(new Error(secret));

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" })], h.deps);

      expect(sentTexts(h)).toEqual([invite("Вопрос")]);
      expect(out).toEqual([{ key: "dm:M2", outcome: "replied" }]);
      expect(h.logs.error).toHaveBeenCalled();
      expect(JSON.stringify(h.logs.error.mock.calls)).not.toContain("4815162342");
    });

    it("a thrown error inside the DM cooldown stays silent", async () => {
      const h = aiHarness({
        contacts: { [USER]: { _id: USER, lastDmInviteAt: hoursAgo(1) } },
        messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")],
      });
      h.ai.composeDirectReply.mockRejectedValueOnce(new Error("boom"));

      const out = await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" })], h.deps);

      expect(h.graph.sendDirect).not.toHaveBeenCalled();
      expect(out).toEqual([{ key: "dm:M2", outcome: "skipped", reason: "cooldown" }]);
    });
  });

  describe("staff and bot echoes", () => {
    it("a staff reply written in the app is stored as the coordinator's, pauses the AI and blocks the invitation", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });

      const out = await processInstagramEvents([echo({ mid: "E1", text: "Отправим список документов?" })], h.deps);

      expect(h.store.messages.at(-1)).toEqual(seeded("coordinator", "Отправим список документов?", NOW_ISO, "E1"));
      expect(h.store.pauseAi).toHaveBeenCalledWith(USER, new Date(NOW.getTime() + 12 * HOUR));
      expect(h.store.markDmInvited).toHaveBeenCalledWith(USER, NOW);
      expect(h.graph.sendDirect).not.toHaveBeenCalled();
      expect(out).toEqual([{ key: "echo:E1", outcome: "skipped", reason: "echo-staff" }]);
    });

    it("a staff message without text is stored under a placeholder", async () => {
      const h = aiHarness();

      await processInstagramEvents([echo({ mid: "E2" })], h.deps);

      expect(h.store.messages).toEqual([seeded("coordinator", "[сообщение сотрудника]", NOW_ISO, "E2")]);
    });

    it("our own bot message is recognised by its known mid even when the last send is long ago", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Ответ бота", hoursAgo(1), "E2")] });
      const before = h.store.messages.length;

      const out = await processInstagramEvents([echo({ mid: "E2", text: "Ответ бота" })], h.deps);

      expect(h.store.messages).toHaveLength(before);
      expect(h.store.pauseAi).not.toHaveBeenCalled();
      expect(h.store.markDmInvited).not.toHaveBeenCalled();
      expect(out).toEqual([{ key: "echo:E2", outcome: "skipped", reason: "echo-bot" }]);
    });

    it("our own bot message is recognised by a recent send even when its mid is unknown", async () => {
      const h = aiHarness({ messages: [seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0")] });
      await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" })], h.deps);
      const before = h.store.messages.length;

      const out = await processInstagramEvents([echo({ mid: "E-UNKNOWN" })], h.deps);

      expect(h.store.messages).toHaveLength(before);
      expect(h.store.pauseAi).not.toHaveBeenCalled();
      expect(out).toEqual([{ key: "echo:E-UNKNOWN", outcome: "skipped", reason: "echo-bot" }]);
    });
  });

  describe("comments", () => {
    it("the comment is recorded as patient context and the private reply as an AI message", async () => {
      const h = aiHarness();

      const out = await processInstagramEvents([comment()], h.deps);

      const privateText = buildCommentPrivateReply({ text: RU_QUESTION, ...CTX });
      expect(h.graph.sendDirect).toHaveBeenCalledWith(h.deps.cfg, TOKEN, { commentId: "C1" }, privateText);
      expect(h.store.messages).toEqual([
        seeded("patient", `[комментарий под постом] ${RU_QUESTION}`, NOW_ISO),
        seeded("ai", privateText, NOW_ISO, "S1"),
      ]);
      expect(out).toEqual([{ key: "comment:C1", outcome: "replied" }]);
    });

    it("the public reply is not recorded in the direct history", async () => {
      const h = aiHarness();

      await processInstagramEvents([comment()], h.deps);

      expect(h.graph.replyToComment).toHaveBeenCalledTimes(1);
      const publicText = buildCommentReply({ text: RU_QUESTION, commentId: "C1", ...CTX });
      expect(h.store.messages.some((m) => m.text === publicText)).toBe(false);
    });
  });

  describe("switches and logs", () => {
    it("with aiReplies off nothing is written to the history and the model is never called", async () => {
      const h = harness();
      await processInstagramEvents([dm({ mid: "M2", text: "Вопрос" }), comment(), echo({ mid: "E5" })], h.deps);

      expect(h.store.messages).toEqual([]);
      expect(h.ai.composeDirectReply).not.toHaveBeenCalled();
      expect(h.store.addIgMessage).not.toHaveBeenCalled();
    });

    it("no log call contains the message text, the model reply or the model error", async () => {
      const secret = "Секретный текст пациента 4815162342";
      const h = aiHarness({
        messages: [
          seeded("ai", "Здравствуйте!", hoursAgo(1), "AI0"),
          { igUserId: OTHER, from: "ai", text: "Здравствуйте!", at: hoursAgo(1), mid: "AI9" },
        ],
      });
      h.ai.composeDirectReply
        .mockRejectedValueOnce(new Error(secret))
        .mockResolvedValueOnce({ kind: "reply", bubbles: [`Ответ с ${secret}`] });

      await processInstagramEvents([dm({ mid: "M2", text: secret })], h.deps);
      await processInstagramEvents([dm({ mid: "M3", senderId: OTHER, text: secret })], h.deps);
      expect(h.ai.composeDirectReply).toHaveBeenCalledTimes(2);
      expect(sentTexts(h)).toContain(`Ответ с ${secret}`);

      const logged = JSON.stringify([h.logs.info.mock.calls, h.logs.warn.mock.calls, h.logs.error.mock.calls]);
      expect(h.logs.info).toHaveBeenCalled();
      expect(logged).not.toContain("Секретный");
      expect(logged).not.toContain("4815162342");
    });
  });
});

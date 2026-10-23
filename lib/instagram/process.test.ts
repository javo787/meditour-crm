import type { Logger } from "@/lib/logger";

import type { InstagramConfig } from "./config";
import { processInstagramEvents, type ProcessDeps } from "./process";
import { buildCommentPrivateReply, buildCommentReply, buildDirectInvite } from "./replies";
import type { InstagramContact } from "./store";
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

// Хранилище в памяти: отметки и журнал событий ведут себя как в MongoDB.
function fakeStore(contacts: Record<string, InstagramContact> = {}) {
  const seen = new Set<string>();
  return {
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
  };
}

function fakeGraph() {
  return {
    replyToComment: jest.fn().mockResolvedValue(ok({ id: "R1" })),
    sendDirect: jest.fn().mockResolvedValue(ok({ recipient_id: USER, message_id: "S1" })),
  };
}

function fakeLog() {
  const info = jest.fn();
  const warn = jest.fn();
  const error = jest.fn();
  const log: Logger = { info, warn, error, child: () => log };
  return { log, info, warn, error };
}

function harness(
  opts: { cfg?: Partial<InstagramConfig>; contacts?: Record<string, InstagramContact>; random?: () => number } = {},
) {
  const store = fakeStore(opts.contacts);
  const graph = fakeGraph();
  const logs = fakeLog();
  const sleep = jest.fn().mockResolvedValue(undefined);
  const getToken = jest.fn().mockResolvedValue(TOKEN);
  const deps: ProcessDeps = {
    cfg: { ...cfg, ...opts.cfg },
    now: () => NOW,
    sleep,
    random: opts.random ?? (() => 0.5),
    log: logs.log,
    getToken,
    store,
    graph,
  };
  return { deps, store, graph, logs, sleep, getToken };
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

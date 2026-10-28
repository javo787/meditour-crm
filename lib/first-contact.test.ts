export {};

// Логгер создаётся при загрузке lib/first-contact.ts, раньше любых переменных теста — поэтому целиком внутри фабрики.
jest.mock("@/lib/logger", () => {
  const logger: Record<string, jest.Mock> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return { createLogger: () => logger, newRequestId: () => "req" };
});
jest.mock("@/lib/evolution", () => ({ sendWhatsAppText: jest.fn(async () => undefined) }));
jest.mock("@/lib/gemini", () => ({
  summarizeLeadBrief: jest.fn(async () => "Сводка: лид получил видео, ничего не написал."),
  composeFirstContactMessage: jest.fn(async () => "Ассалому алейкум! Это Meditur HBG. Вы интересовались лечением — чем можем помочь?"),
}));
jest.mock("@/lib/db", () => ({
  addMessage: jest.fn(async () => undefined),
  claimFirstContactTouch1: jest.fn(async () => true),
  closeFirstContact: jest.fn(async () => undefined),
  getFirstContactCandidates: jest.fn(async () => []),
  getMessages: jest.fn(async () => []),
  revertFirstContactTouch1: jest.fn(async () => undefined),
  saveFirstContactSchedule: jest.fn(async () => undefined),
}));

import * as db from "@/lib/db";
import { sendWhatsAppText } from "@/lib/evolution";
import * as gemini from "@/lib/gemini";
import {
  FALLBACK_TOUCH_TEXT,
  cleanFollowUpText,
  decideFirstContact,
  detectLanguage,
  hourInZone,
  inSendWindow,
  isOptOut,
  processFirstContactLead,
  runFirstContactPass,
  type DecisionMessage,
} from "@/lib/first-contact";
import type { Lead } from "@/lib/types";

const TZ = "Asia/Dushanbe"; // UTC+5
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = new Date("2026-10-28T08:00:00Z"); // 13:00 в Душанбе — внутри окна отправки

const ago = (ms: number, from: Date = NOW) => new Date(from.getTime() - ms).toISOString();
const msg = (from: DecisionMessage["from"], msAgo: number, text = "привет", extra: Partial<DecisionMessage> = {}): DecisionMessage => ({
  from,
  at: ago(msAgo),
  text,
  ...extra,
});
const makeLead = (over: Partial<Lead> = {}): Lead => ({
  id: "lead1",
  name: "Рахимов Изатулло",
  phone: "992901234567",
  diagnosis: "",
  stage: "first_contact",
  assignee: "",
  nextTouch: NOW.toISOString(),
  createdAt: ago(5 * DAY),
  aiPaused: false,
  ...over,
});
const decide = (lead: Lead, messages: DecisionMessage[], now: Date = NOW) =>
  decideFirstContact({ lead, messages, now, timeZone: TZ });

describe("decideFirstContact: who is eligible", () => {
  const botSilent = [msg("ai", 4 * HOUR)];

  it.each([
    ["a later stage", makeLead({ stage: "consult_scheduled" }), botSilent, "stage"],
    ["AI paused", makeLead({ aiPaused: true }), botSilent, "ai-paused"],
    ["already without answer", makeLead({ noResponse: true }), botSilent, "no-response"],
    ["no usable phone (e.g. Instagram)", makeLead({ phone: "ig_1234" }), botSilent, "no-phone"],
    ["no messages", makeLead(), [], "no-messages"],
    ["the patient wrote last", makeLead(), [msg("ai", 5 * HOUR), msg("patient", 4 * HOUR)], "patient-last"],
    ["a coordinator wrote last", makeLead(), [msg("ai", 5 * HOUR), msg("coordinator", 4 * HOUR)], "coordinator-last"],
    ["our last message was never delivered", makeLead(), [msg("ai", 4 * HOUR, "x", { deliveryFailed: true })], "delivery-failed"],
  ])("skips: %s", (_label, lead, messages, reason) => {
    expect(decide(lead, messages)).toEqual({ kind: "skip", reason });
  });
});

describe("decideFirstContact: the 3 hours / 2 days / week timeline", () => {
  it("waits during the first 3 hours after the bot's message", () => {
    expect(decide(makeLead(), [msg("ai", 2 * HOUR)])).toEqual({ kind: "skip", reason: "waiting-3h" });
  });

  it("after 3 hours of silence: write the summary and schedule the touch 2 days after the bot's last message", () => {
    const d = decide(makeLead(), [msg("patient", 6 * HOUR), msg("ai", 3 * HOUR + 1000)]);
    expect(d).toEqual({
      kind: "summarize",
      cycleKey: ago(6 * HOUR),
      anchorAt: ago(3 * HOUR + 1000),
      touch1DueAt: new Date(NOW.getTime() - 3 * HOUR - 1000 + 2 * DAY).toISOString(),
    });
  });

  it("uses 'none' as the cycle key when the lead never wrote", () => {
    expect(decide(makeLead(), [msg("ai", 4 * HOUR)])).toMatchObject({ kind: "summarize", cycleKey: "none" });
  });

  const scheduled = (anchorAgo: number, over: Partial<NonNullable<Lead["firstContact"]>> = {}): Lead =>
    makeLead({
      firstContact: {
        phase: "scheduled",
        cycleKey: "none",
        anchorAt: ago(anchorAgo),
        touch1DueAt: new Date(NOW.getTime() - anchorAgo + 2 * DAY).toISOString(),
        ...over,
      },
    });

  it("does not write before the 2 days have passed", () => {
    expect(decide(scheduled(DAY), [msg("ai", DAY)])).toEqual({ kind: "skip", reason: "touch1-not-due" });
  });

  it("writes once 2 days have passed and it is daytime", () => {
    expect(decide(scheduled(2 * DAY + HOUR), [msg("ai", 2 * DAY + HOUR)])).toEqual({ kind: "send-touch1", cycleKey: "none" });
  });

  it("waits for the morning instead of writing at night", () => {
    const night = new Date("2026-10-28T20:00:00Z"); // 01:00 в Душанбе
    const lead = scheduled(2 * DAY + HOUR);
    const bot = [{ ...msg("ai", 0), at: new Date(night.getTime() - 2 * DAY - HOUR).toISOString() }];
    const l = { ...lead, firstContact: { ...lead.firstContact!, anchorAt: bot[0].at, touch1DueAt: new Date(Date.parse(bot[0].at) + 2 * DAY).toISOString() } };
    expect(decide(l, bot, night)).toEqual({ kind: "skip", reason: "quiet-hours" });
  });

  it("closes without writing when the schedule is long overdue (9+ days since the bot's last message)", () => {
    expect(decide(scheduled(10 * DAY), [msg("ai", 10 * DAY)])).toEqual({ kind: "close", reason: "stale" });
    expect(decide(makeLead(), [msg("ai", 10 * DAY)])).toEqual({ kind: "close", reason: "stale" });
  });

  const sent = (touchAgo: number): Lead =>
    makeLead({
      firstContact: { phase: "touch1_sent", cycleKey: "none", anchorAt: ago(touchAgo + 2 * DAY), touch1DueAt: ago(touchAgo), touch1At: ago(touchAgo) },
    });

  it("after the touch: waits a week, then closes as 'without answer'", () => {
    expect(decide(sent(3 * DAY), [msg("ai", 3 * DAY)])).toEqual({ kind: "skip", reason: "waiting-week" });
    expect(decide(sent(7 * DAY + HOUR), [msg("ai", 7 * DAY + HOUR)])).toEqual({ kind: "close", reason: "silent-week" });
  });

  it("starts the cycle over when the patient wrote after the saved state", () => {
    const lead = sent(3 * DAY); // состояние привязано к «none», а пациент с тех пор написал и снова замолчал
    const messages = [msg("patient", 2 * DAY), msg("ai", 5 * HOUR)];
    expect(decide(lead, messages)).toMatchObject({ kind: "summarize", cycleKey: ago(2 * DAY) });
  });

  it("closes right away when the patient asked not to be contacted", () => {
    const messages = [msg("patient", 6 * HOUR, "Не пишите мне больше, пожалуйста"), msg("ai", 5 * HOUR)];
    expect(decide(makeLead(), messages)).toEqual({ kind: "close", reason: "opt-out" });
    expect(isOptOut("Bezovta qilmang")).toBe(true);
    expect(isOptOut("Ба ман нанависед")).toBe(true);
    expect(isOptOut("Здравствуйте, меня интересует лечение")).toBe(false);
  });
});

describe("send window and helpers", () => {
  it("allows sending 10:00–19:00 Dushanbe time only", () => {
    expect(inSendWindow(new Date("2026-10-28T04:59:00Z"), TZ)).toBe(false); // 09:59
    expect(inSendWindow(new Date("2026-10-28T05:00:00Z"), TZ)).toBe(true); // 10:00
    expect(inSendWindow(new Date("2026-10-28T13:59:00Z"), TZ)).toBe(true); // 18:59
    expect(inSendWindow(new Date("2026-10-28T14:00:00Z"), TZ)).toBe(false); // 19:00
    expect(hourInZone(new Date("2026-10-28T19:30:00Z"), TZ)).toBe(0); // полночь — 0, а не 24
  });

  it("detects the language the lead actually wrote", () => {
    const p = (text: string) => [msg("patient", HOUR, text)];
    expect(detectLanguage(p("Салом, ман ҳамроҳи бемор ҳастам"))).toBe("tg");
    expect(detectLanguage(p("Salom, davolanish haqida bilmoqchi edim"))).toBe("uz");
    expect(detectLanguage(p("Здравствуйте, хочу узнать про лечение"))).toBe("ru");
  });

  it("falls back to Tajik when the lead wrote nothing, and ignores photo/voice placeholders", () => {
    expect(detectLanguage([msg("ai", HOUR, "Ассалому алейкум!")])).toBe("tg");
    expect(detectLanguage([msg("patient", HOUR, "📎 [изображение без подписи]")])).toBe("tg");
    expect(detectLanguage([msg("patient", HOUR, "🎤 [голосовое сообщение]", { transcript: { text: "Salom, qalaysiz" } })])).toBe("uz");
  });

  it("cleans the model's text and rejects unusable ones", () => {
    expect(cleanFollowUpText('«Ассалому алейкум!\n Чем можем   помочь?»')).toBe("Ассалому алейкум! Чем можем помочь?");
    expect(cleanFollowUpText("")).toBeNull();
    expect(cleanFollowUpText("Смотрите https://example.com/video")).toBeNull();
    expect(cleanFollowUpText("а".repeat(700))).toBeNull();
  });
});

describe("processFirstContactLead", () => {
  const silentLead = makeLead();
  const silentMessages = [msg("ai", 4 * HOUR, "Ассалому алейкум! Видео ниже.")];
  const readyLead = makeLead({
    aiBrief: { text: "Родственник, интересуется лечением суставов.", at: ago(2 * DAY) },
    firstContact: {
      phase: "scheduled",
      cycleKey: "none",
      anchorAt: ago(2 * DAY + HOUR),
      touch1DueAt: ago(HOUR),
    },
  });
  const readyMessages = [msg("ai", 2 * DAY + HOUR, "Ассалому алейкум! Видео ниже.")];
  const fresh = () => ({ summaries: 10, sends: 5 });
  const run = (lead: Lead, messages: DecisionMessage[], opts: { dryRun?: boolean; budget?: { summaries: number; sends: number } } = {}) => {
    jest.mocked(db.getMessages).mockResolvedValue(messages as never);
    return processFirstContactLead(lead, { now: NOW, dryRun: opts.dryRun ?? false, budget: opts.budget ?? fresh(), timeZone: TZ });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(db.claimFirstContactTouch1).mockResolvedValue(true);
    jest.mocked(sendWhatsAppText).mockResolvedValue(undefined as never);
  });

  it("dry run decides but touches nothing", async () => {
    const out = await run(silentLead, silentMessages, { dryRun: true });
    expect(out).toMatchObject({ kind: "summarize", done: false });
    expect(gemini.summarizeLeadBrief).not.toHaveBeenCalled();
    expect(db.saveFirstContactSchedule).not.toHaveBeenCalled();
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("3 hours of silence: reads the chat once, saves the brief and moves the touch to the evening of day +2", async () => {
    const out = await run(silentLead, silentMessages);
    expect(out).toMatchObject({ kind: "summarize", done: true });
    expect(gemini.summarizeLeadBrief).toHaveBeenCalledTimes(1);
    expect(jest.mocked(gemini.summarizeLeadBrief).mock.calls[0][0].transcript).toContain("Видео ниже");

    const saved = jest.mocked(db.saveFirstContactSchedule).mock.calls[0];
    expect(saved[0]).toBe("lead1");
    expect(saved[1].brief.text).toContain("лид получил видео");
    expect(saved[1].state).toMatchObject({ phase: "scheduled", cycleKey: "none" });
    // якорь = 04:00Z 28 окт → срок 04:00Z 30 окт (09:00 в Душанбе) → касание на конец 30 октября по Душанбе
    expect(saved[1].state.touch1DueAt).toBe("2026-10-30T04:00:00.000Z");
    expect(saved[1].nextTouch).toBe("2026-10-30T18:59:59.999Z");
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("touch time: writes using the saved brief, claims the touch BEFORE sending, then records the message", async () => {
    const out = await run(readyLead, readyMessages);
    expect(out).toMatchObject({ kind: "send-touch1", done: true });

    const compose = jest.mocked(gemini.composeFirstContactMessage).mock.calls[0][0];
    expect(compose.brief).toBe("Родственник, интересуется лечением суставов.");
    expect(compose.transcript).toContain("Видео ниже");

    const claimOrder = jest.mocked(db.claimFirstContactTouch1).mock.invocationCallOrder[0];
    const sendOrder = jest.mocked(sendWhatsAppText).mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(sendOrder);

    const claim = jest.mocked(db.claimFirstContactTouch1).mock.calls[0];
    expect(claim[1]).toBe("none");
    expect(claim[2].touch1At).toBe(NOW.toISOString());
    expect(claim[2].nextTouch).toBe("2026-11-04T18:59:59.999Z"); // через неделю, конец дня по Душанбе
    expect(sendWhatsAppText).toHaveBeenCalledWith("992901234567", expect.stringContaining("Ассалому алейкум"));
    expect(db.addMessage).toHaveBeenCalledWith("lead1", "ai", expect.stringContaining("Ассалому алейкум"));
  });

  it("uses the fallback text in the lead's language when Gemini fails or returns a link", async () => {
    jest.mocked(gemini.composeFirstContactMessage).mockRejectedValueOnce(new Error("503"));
    await run(readyLead, readyMessages);
    expect(sendWhatsAppText).toHaveBeenLastCalledWith("992901234567", FALLBACK_TOUCH_TEXT.tg);

    jest.mocked(gemini.composeFirstContactMessage).mockResolvedValueOnce("Смотрите https://spam.example");
    const ruMessages = [msg("patient", 3 * DAY, "Здравствуйте, интересует лечение"), msg("ai", 2 * DAY + HOUR)];
    const ruLead = { ...readyLead, firstContact: { ...readyLead.firstContact!, cycleKey: ago(3 * DAY) } };
    await run(ruLead, ruMessages);
    expect(sendWhatsAppText).toHaveBeenLastCalledWith("992901234567", FALLBACK_TOUCH_TEXT.ru);
  });

  it("does not send when another pass already claimed the touch", async () => {
    jest.mocked(db.claimFirstContactTouch1).mockResolvedValueOnce(false);
    const out = await run(readyLead, readyMessages);
    expect(out).toMatchObject({ reason: "already-claimed", done: false });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("a failed send puts the touch back for the next pass; the third failure closes the lead", async () => {
    jest.mocked(sendWhatsAppText).mockRejectedValueOnce(new Error("Evolution 500"));
    const out = await run(readyLead, readyMessages);
    expect(out).toMatchObject({ reason: "send-failed", done: false });
    expect(db.revertFirstContactTouch1).toHaveBeenCalledWith("lead1", "none", expect.objectContaining({ attempts: 1 }));
    expect(db.addMessage).not.toHaveBeenCalled();
    expect(db.closeFirstContact).not.toHaveBeenCalled();

    jest.clearAllMocks();
    jest.mocked(db.claimFirstContactTouch1).mockResolvedValue(true);
    jest.mocked(sendWhatsAppText).mockRejectedValueOnce(new Error("Evolution 500"));
    const third = { ...readyLead, firstContact: { ...readyLead.firstContact!, attempts: 2 } };
    const closed = await run(third, readyMessages);
    expect(closed).toMatchObject({ reason: "send-failed-closed", done: true });
    expect(db.closeFirstContact).toHaveBeenCalledWith("lead1");
    expect(db.addMessage).toHaveBeenCalledWith("lead1", "coordinator", expect.stringContaining("не удалось отправить"));
  });

  it("a week without an answer moves the lead to 'Без ответа' with a note in the chat", async () => {
    const lead = makeLead({
      firstContact: { phase: "touch1_sent", cycleKey: "none", anchorAt: ago(9 * DAY), touch1DueAt: ago(7 * DAY + HOUR), touch1At: ago(7 * DAY + HOUR) },
    });
    const out = await run(lead, [msg("ai", 7 * DAY + HOUR)]);
    expect(out).toMatchObject({ kind: "close", reason: "silent-week", done: true });
    expect(db.closeFirstContact).toHaveBeenCalledWith("lead1");
    expect(db.addMessage).toHaveBeenCalledWith("lead1", "coordinator", expect.stringContaining("«Без ответа»"));
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("respects the per-pass budgets", async () => {
    const noSummaries = await run(silentLead, silentMessages, { budget: { summaries: 0, sends: 5 } });
    expect(noSummaries).toMatchObject({ reason: "budget", done: false });
    expect(gemini.summarizeLeadBrief).not.toHaveBeenCalled();

    const noSends = await run(readyLead, readyMessages, { budget: { summaries: 10, sends: 0 } });
    expect(noSends).toMatchObject({ reason: "budget", done: false });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("an error while reading or summarising does not advance the cycle", async () => {
    jest.mocked(gemini.summarizeLeadBrief).mockRejectedValueOnce(new Error("429"));
    const out = await run(silentLead, silentMessages);
    expect(out).toMatchObject({ kind: "summarize", done: false, error: "429" });
    expect(db.saveFirstContactSchedule).not.toHaveBeenCalled();
  });
});

describe("runFirstContactPass", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(db.claimFirstContactTouch1).mockResolvedValue(true);
  });

  const readyLead = (n: number): Lead =>
    makeLead({
      id: `lead${n}`,
      firstContact: { phase: "scheduled", cycleKey: "none", anchorAt: ago(2 * DAY + HOUR), touch1DueAt: ago(HOUR) },
    });

  it("sends at most 5 messages per pass, the rest wait for the next one", async () => {
    jest.mocked(db.getFirstContactCandidates).mockResolvedValue(Array.from({ length: 7 }, (_, i) => readyLead(i)));
    jest.mocked(db.getMessages).mockResolvedValue([msg("ai", 2 * DAY + HOUR)] as never);

    const report = await runFirstContactPass({ now: NOW });
    expect(report?.summary).toEqual({ "send-touch1": 5, "send-touch1:budget": 2 });
    expect(sendWhatsAppText).toHaveBeenCalledTimes(5);
  });

  it("a dry run reports without side effects and does not block the real pass", async () => {
    jest.mocked(db.getFirstContactCandidates).mockResolvedValue([readyLead(1), makeLead({ id: "x", aiPaused: true })]);
    jest.mocked(db.getMessages).mockResolvedValue([msg("ai", 2 * DAY + HOUR)] as never);

    const dry = await runFirstContactPass({ dryRun: true, now: NOW });
    expect(dry).toMatchObject({ dryRun: true, total: 2, summary: { "send-touch1": 1, "skip:ai-paused": 1 } });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("two real passes never overlap", async () => {
    let release: (leads: Lead[]) => void = () => undefined;
    jest.mocked(db.getFirstContactCandidates).mockImplementationOnce(() => new Promise<Lead[]>((r) => (release = r)));
    const first = runFirstContactPass({ now: NOW });
    expect(await runFirstContactPass({ now: NOW })).toBeNull(); // второй прогон, пока идёт первый
    release([]);
    expect(await first).toMatchObject({ total: 0 });
  });
});

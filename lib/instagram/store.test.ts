import { createHash } from "crypto";
import { ObjectId } from "mongodb";

import { getDb } from "@/lib/mongodb";
import type { GraphResult } from "./graph";
import {
  addIgMessage,
  claimEvent,
  countIgAiMessagesSince,
  ensureFreshToken,
  findIgMessageByMid,
  getContact,
  getEffectiveToken,
  getIgMessages,
  markCommentReplied,
  markDmInvited,
  pauseAi,
} from "./store";

jest.mock("@/lib/mongodb", () => ({ getDb: jest.fn() }));

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-10-20T10:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

const ENV = "test-env-token-A";
const OTHER_ENV = "test-env-token-B";
const STORED = "test-stored-token";
const CONTACT = "17841400000000002";

// Отпечаток токена окружения, как его считает store (первые 16 hex от sha256).
function sourceOf(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function duplicateKeyError(): Error {
  return Object.assign(new Error("E11000 duplicate key error collection: meditur.InstagramEvents"), { code: 11000 });
}

const events = { insertOne: jest.fn() };
const contacts = { findOne: jest.fn(), updateOne: jest.fn() };
const auth = { findOne: jest.fn(), replaceOne: jest.fn() };
const messages = { insertOne: jest.fn(), find: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn() };
const collections: Record<string, unknown> = {
  InstagramEvents: events,
  InstagramContacts: contacts,
  InstagramAuth: auth,
  InstagramMessages: messages,
};

const getDbMock = getDb as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  getDbMock.mockResolvedValue({ collection: (name: string) => collections[name] });
});

describe("InstagramEvents: claimEvent", () => {
  it("первый раз ключ занимается и возвращается true", async () => {
    events.insertOne.mockResolvedValueOnce({ acknowledged: true });

    expect(await claimEvent("aWdfZAG1f0000000000000001", NOW)).toBe(true);
    expect(getDbMock).toHaveBeenCalled();
    expect(events.insertOne).toHaveBeenCalledWith({ _id: "aWdfZAG1f0000000000000001", at: NOW_ISO });
  });

  it("повторный ключ (дубликат 11000) возвращает false, а не ошибку", async () => {
    events.insertOne.mockRejectedValueOnce(duplicateKeyError());

    expect(await claimEvent("m-dup", NOW)).toBe(false);
  });

  it("второе событие с тем же ключом получает false после первого true", async () => {
    events.insertOne.mockResolvedValueOnce({ acknowledged: true }).mockRejectedValueOnce(duplicateKeyError());

    expect(await claimEvent("m-twice", NOW)).toBe(true);
    expect(await claimEvent("m-twice", NOW)).toBe(false);
  });

  it("прочие ошибки базы пробрасываются наружу", async () => {
    events.insertOne.mockRejectedValueOnce(new Error("connection lost"));

    await expect(claimEvent("m-fail", NOW)).rejects.toThrow("connection lost");
  });

  it("без явного времени берётся текущее", async () => {
    events.insertOne.mockResolvedValueOnce({ acknowledged: true });

    await claimEvent("m-now");
    const [doc] = events.insertOne.mock.calls[0] as [{ at: string }];
    expect(Math.abs(Date.parse(doc.at) - Date.now())).toBeLessThan(60 * 1000);
  });
});

describe("InstagramContacts", () => {
  it("getContact возвращает запись контакта", async () => {
    const doc = { _id: CONTACT, lastDmInviteAt: ago(HOUR_MS) };
    contacts.findOne.mockResolvedValueOnce(doc);

    expect(await getContact(CONTACT)).toEqual(doc);
    expect(contacts.findOne).toHaveBeenCalledWith({ _id: CONTACT });
  });

  it("getContact возвращает null, если контакта нет", async () => {
    contacts.findOne.mockResolvedValueOnce(null);

    expect(await getContact("17841400000000099")).toBeNull();
  });

  it("markDmInvited записывает время приглашения в личку через upsert", async () => {
    contacts.updateOne.mockResolvedValueOnce({ acknowledged: true });

    await markDmInvited(CONTACT, NOW);

    expect(contacts.updateOne).toHaveBeenCalledWith(
      { _id: CONTACT },
      { $set: { lastDmInviteAt: NOW_ISO } },
      { upsert: true },
    );
  });

  it("markCommentReplied записывает время ответа на комментарий через upsert", async () => {
    contacts.updateOne.mockResolvedValueOnce({ acknowledged: true });

    await markCommentReplied(CONTACT, NOW);

    expect(contacts.updateOne).toHaveBeenCalledWith(
      { _id: CONTACT },
      { $set: { lastCommentReplyAt: NOW_ISO } },
      { upsert: true },
    );
  });
});

describe("InstagramAuth: getEffectiveToken", () => {
  it("без сохранённого токена возвращает токен из окружения", async () => {
    auth.findOne.mockResolvedValueOnce(null);

    expect(await getEffectiveToken(ENV)).toBe(ENV);
    expect(auth.findOne).toHaveBeenCalledWith({ _id: "token" });
  });

  it("сохранённый токен того же источника имеет приоритет", async () => {
    auth.findOne.mockResolvedValueOnce({ _id: "token", accessToken: STORED, source: sourceOf(ENV), refreshedAt: ago(DAY_MS) });

    expect(await getEffectiveToken(ENV)).toBe(STORED);
  });

  it("новый токен в окружении побеждает сохранённый токен от старого", async () => {
    auth.findOne.mockResolvedValueOnce({ _id: "token", accessToken: STORED, source: sourceOf(OTHER_ENV), refreshedAt: ago(DAY_MS) });

    expect(await getEffectiveToken(ENV)).toBe(ENV);
  });

  it("пустой токен окружения возвращается без обращения к базе", async () => {
    expect(await getEffectiveToken("")).toBe("");
    expect(auth.findOne).not.toHaveBeenCalled();
  });
});

describe("InstagramAuth: ensureFreshToken", () => {
  const refresh = jest.fn();

  beforeEach(() => {
    refresh.mockReset();
  });

  it("токен обновлялся меньше 30 дней назад: обновления нет, возвращается сохранённый", async () => {
    auth.findOne.mockResolvedValueOnce({ _id: "token", accessToken: STORED, source: sourceOf(ENV), refreshedAt: ago(5 * DAY_MS) });

    expect(await ensureFreshToken(ENV, refresh, NOW)).toBe(STORED);
    expect(refresh).not.toHaveBeenCalled();
    expect(auth.replaceOne).not.toHaveBeenCalled();
  });

  it("refreshedAt старше 30 дней и попытки давно не было: обновляет и сохраняет новый токен", async () => {
    auth.findOne.mockResolvedValueOnce({
      _id: "token",
      accessToken: STORED,
      source: sourceOf(ENV),
      refreshedAt: ago(31 * DAY_MS),
      lastAttemptAt: ago(13 * HOUR_MS),
    });
    refresh.mockResolvedValueOnce({ ok: true, data: { access_token: "test-new-token", expires_in: 5184000 } });

    expect(await ensureFreshToken(ENV, refresh, NOW)).toBe("test-new-token");
    expect(refresh).toHaveBeenCalledWith(STORED);
    expect(auth.replaceOne).toHaveBeenCalledWith(
      { _id: "token" },
      { accessToken: "test-new-token", source: sourceOf(ENV), refreshedAt: NOW_ISO },
      { upsert: true },
    );
  });

  it("нет сохранённой записи: обновляет токен из окружения", async () => {
    auth.findOne.mockResolvedValueOnce(null);
    refresh.mockResolvedValueOnce({ ok: true, data: { access_token: "test-new-token", expires_in: 5184000 } });

    expect(await ensureFreshToken(ENV, refresh, NOW)).toBe("test-new-token");
    expect(refresh).toHaveBeenCalledWith(ENV);
    expect(auth.replaceOne).toHaveBeenCalledWith(
      { _id: "token" },
      expect.objectContaining({ accessToken: "test-new-token", refreshedAt: NOW_ISO }),
      { upsert: true },
    );
  });

  it("после неудачной попытки не повторяет обновление раньше чем через 12 часов", async () => {
    auth.findOne.mockResolvedValueOnce({
      _id: "token",
      accessToken: STORED,
      source: sourceOf(ENV),
      refreshedAt: ago(40 * DAY_MS),
      lastAttemptAt: ago(2 * HOUR_MS),
    });

    expect(await ensureFreshToken(ENV, refresh, NOW)).toBe(STORED);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("неудача обновления возвращает прежний токен и записывает время попытки, сохраняя refreshedAt", async () => {
    const refreshedAt = ago(31 * DAY_MS);
    auth.findOne.mockResolvedValueOnce({ _id: "token", accessToken: STORED, source: sourceOf(ENV), refreshedAt });
    refresh.mockResolvedValueOnce({ ok: false, status: 400, code: 190, message: "Error validating access token" });

    expect(await ensureFreshToken(ENV, refresh, NOW)).toBe(STORED);
    expect(auth.replaceOne).toHaveBeenCalledWith(
      { _id: "token" },
      { accessToken: STORED, source: sourceOf(ENV), refreshedAt, lastAttemptAt: NOW_ISO },
      { upsert: true },
    );
  });

  it("исключение при обновлении не пробрасывается, возвращается прежний токен", async () => {
    auth.findOne.mockResolvedValueOnce({ _id: "token", accessToken: STORED, source: sourceOf(ENV), refreshedAt: ago(31 * DAY_MS) });
    refresh.mockRejectedValueOnce(new Error("socket hang up"));

    await expect(ensureFreshToken(ENV, refresh, NOW)).resolves.toBe(STORED);
    expect(auth.replaceOne).toHaveBeenCalledWith(
      { _id: "token" },
      expect.objectContaining({ accessToken: STORED, lastAttemptAt: NOW_ISO }),
      { upsert: true },
    );
  });

  it("ответ об успехе без access_token считается неудачей", async () => {
    auth.findOne.mockResolvedValueOnce({ _id: "token", accessToken: STORED, source: sourceOf(ENV), refreshedAt: ago(31 * DAY_MS) });
    refresh.mockResolvedValueOnce({ ok: true, data: null });

    expect(await ensureFreshToken(ENV, refresh, NOW)).toBe(STORED);
    expect(auth.replaceOne).toHaveBeenCalledWith(
      { _id: "token" },
      expect.objectContaining({ accessToken: STORED, lastAttemptAt: NOW_ISO }),
      { upsert: true },
    );
  });

  it("запись от старого токена не мешает: новый токен в окружении обновляется сразу", async () => {
    auth.findOne.mockResolvedValueOnce({
      _id: "token",
      accessToken: STORED,
      source: sourceOf(OTHER_ENV),
      refreshedAt: ago(1 * DAY_MS),
      lastAttemptAt: ago(1 * HOUR_MS),
    });
    refresh.mockResolvedValueOnce({ ok: true, data: { access_token: "test-new-token", expires_in: 5184000 } });

    expect(await ensureFreshToken(ENV, refresh, NOW)).toBe("test-new-token");
    expect(refresh).toHaveBeenCalledWith(ENV);
  });

  it("неудача для нового токена записывает токен окружения без refreshedAt", async () => {
    auth.findOne.mockResolvedValueOnce({ _id: "token", accessToken: STORED, source: sourceOf(OTHER_ENV), refreshedAt: ago(1 * DAY_MS) });
    refresh.mockResolvedValueOnce({ ok: false, status: 400 });

    expect(await ensureFreshToken(ENV, refresh, NOW)).toBe(ENV);
    const [, doc] = auth.replaceOne.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(doc).toEqual({ accessToken: ENV, source: sourceOf(ENV), lastAttemptAt: NOW_ISO });
    expect(doc).not.toHaveProperty("refreshedAt");
  });

  it("в записи нет самого токена в открытом виде, только отпечаток", async () => {
    auth.findOne.mockResolvedValueOnce(null);
    refresh.mockResolvedValueOnce({ ok: true, data: { access_token: "test-new-token", expires_in: 1 } } as GraphResult<{ access_token: string }>);

    await ensureFreshToken(ENV, refresh, NOW);
    const [, doc] = auth.replaceOne.mock.calls[0] as [unknown, { source: string }];
    expect(doc.source).toMatch(/^[0-9a-f]{16}$/);
    expect(doc.source).not.toContain(ENV);
  });

  it("пустой токен окружения возвращается без обращения к базе и к обновлению", async () => {
    expect(await ensureFreshToken("", refresh, NOW)).toBe("");
    expect(auth.findOne).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("InstagramContacts: pauseAi", () => {
  it("ставит паузу ИИ до указанного времени через upsert", async () => {
    contacts.updateOne.mockResolvedValueOnce({ acknowledged: true });
    const until = new Date(NOW.getTime() + 2 * HOUR_MS);

    await pauseAi(CONTACT, until);

    expect(contacts.updateOne).toHaveBeenCalledWith(
      { _id: CONTACT },
      { $set: { aiPausedUntil: until.toISOString() } },
      { upsert: true },
    );
  });
});

describe("InstagramMessages: addIgMessage", () => {
  it("сохраняет сообщение с временем в ISO и без mid, если mid не передан", async () => {
    messages.insertOne.mockResolvedValueOnce({ acknowledged: true });

    await addIgMessage({ igUserId: CONTACT, from: "patient", text: "Здравствуйте", at: NOW });

    expect(messages.insertOne).toHaveBeenCalledWith({ igUserId: CONTACT, from: "patient", text: "Здравствуйте", at: NOW_ISO });
    const [doc] = messages.insertOne.mock.calls[0] as [Record<string, unknown>];
    expect(doc).not.toHaveProperty("mid");
  });

  it("сохраняет mid, если он передан", async () => {
    messages.insertOne.mockResolvedValueOnce({ acknowledged: true });

    await addIgMessage({ igUserId: CONTACT, from: "ai", text: "Ответ", at: NOW, mid: "test-mid-1" });

    expect(messages.insertOne).toHaveBeenCalledWith({
      igUserId: CONTACT,
      from: "ai",
      text: "Ответ",
      at: NOW_ISO,
      mid: "test-mid-1",
    });
  });

  it("без явного времени берётся текущее", async () => {
    messages.insertOne.mockResolvedValueOnce({ acknowledged: true });

    await addIgMessage({ igUserId: CONTACT, from: "coordinator", text: "Позвоним завтра" });

    const [doc] = messages.insertOne.mock.calls[0] as [{ at: string }];
    expect(Math.abs(Date.parse(doc.at) - Date.now())).toBeLessThan(60 * 1000);
  });
});

describe("InstagramMessages: getIgMessages", () => {
  // Курсор запроса: sort и limit возвращают его же, toArray отдаёт заготовленные документы.
  function cursor(docs: unknown[]) {
    const c = { sort: jest.fn(), limit: jest.fn(), toArray: jest.fn().mockResolvedValue(docs) };
    c.sort.mockReturnValue(c);
    c.limit.mockReturnValue(c);
    return c;
  }

  const ID_OLD = new ObjectId("65f0c0ffee0000000000000a");
  const ID_NEW = new ObjectId("65f0c0ffee0000000000000b");

  it("возвращает последние сообщения по возрастанию времени в формате ChatMessage", async () => {
    // База отдаёт от новых к старым (sort по убыванию), функция переворачивает порядок.
    const c = cursor([
      { _id: ID_NEW, igUserId: CONTACT, from: "ai", text: "Новый ответ", at: ago(HOUR_MS) },
      { _id: ID_OLD, igUserId: CONTACT, from: "patient", text: "Старый вопрос", at: ago(2 * HOUR_MS) },
    ]);
    messages.find.mockReturnValueOnce(c);

    expect(await getIgMessages(CONTACT)).toEqual([
      { id: ID_OLD.toString(), leadId: CONTACT, from: "patient", text: "Старый вопрос", at: ago(2 * HOUR_MS) },
      { id: ID_NEW.toString(), leadId: CONTACT, from: "ai", text: "Новый ответ", at: ago(HOUR_MS) },
    ]);
    expect(messages.find).toHaveBeenCalledWith({ igUserId: CONTACT });
    expect(c.sort).toHaveBeenCalledWith({ at: -1, _id: -1 });
    expect(c.limit).toHaveBeenCalledWith(30);
  });

  it("лимит по умолчанию 30, свой лимит передаётся в запрос", async () => {
    const c = cursor([]);
    messages.find.mockReturnValueOnce(c);

    expect(await getIgMessages(CONTACT, 5)).toEqual([]);
    expect(c.limit).toHaveBeenCalledWith(5);
  });
});

describe("InstagramMessages: findIgMessageByMid", () => {
  it("возвращает true, если сообщение с таким mid уже сохранено", async () => {
    messages.findOne.mockResolvedValueOnce({ _id: new ObjectId("65f0c0ffee0000000000000c") });

    expect(await findIgMessageByMid("test-mid-1")).toBe(true);
    expect(messages.findOne).toHaveBeenCalledWith({ mid: "test-mid-1" });
  });

  it("возвращает false, если такого mid нет", async () => {
    messages.findOne.mockResolvedValueOnce(null);

    expect(await findIgMessageByMid("test-mid-unknown")).toBe(false);
  });
});

describe("InstagramMessages: countIgAiMessagesSince", () => {
  it("считает ответы ИИ этого собеседника с указанного момента", async () => {
    messages.countDocuments.mockResolvedValueOnce(3);

    expect(await countIgAiMessagesSince(CONTACT, ago(DAY_MS))).toBe(3);
    expect(messages.countDocuments).toHaveBeenCalledWith({
      igUserId: CONTACT,
      from: "ai",
      at: { $gte: ago(DAY_MS) },
    });
  });
});

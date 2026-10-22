import { createHmac } from "crypto";

import { parseInstagramWebhook, verifySignature } from "./webhook";

const ACCOUNT = "17841400000000001";
const USER = "17841400000000002";
const SECRET = "test-app-secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifySignature", () => {
  const body = JSON.stringify({ object: "instagram", entry: [{ id: ACCOUNT, time: 1730000000 }] });

  it("принимает подпись HMAC-SHA256 от сырого тела", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("принимает подпись тела с кириллицей", () => {
    const ru = JSON.stringify({ text: "Сколько стоит лечение?" });
    expect(verifySignature(ru, sign(ru), SECRET)).toBe(true);
  });

  it("отклоняет подпись, сделанную другим секретом", () => {
    expect(verifySignature(body, sign(body, "other-secret"), SECRET)).toBe(false);
  });

  it("отклоняет изменённое тело с подписью исходного", () => {
    const tampered = body.replace(ACCOUNT, "17841400000000009");
    expect(verifySignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it("отклоняет отсутствующий заголовок", () => {
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, "", SECRET)).toBe(false);
  });

  it("отклоняет пустой секрет приложения", () => {
    expect(verifySignature(body, sign(body, ""), "")).toBe(false);
  });

  it("отклоняет чужой префикс алгоритма", () => {
    const hex = sign(body).slice("sha256=".length);
    expect(verifySignature(body, `sha1=${hex}`, SECRET)).toBe(false);
    expect(verifySignature(body, hex, SECRET)).toBe(false);
  });

  it("отклоняет подпись другой длины", () => {
    expect(verifySignature(body, "sha256=abcd", SECRET)).toBe(false);
    expect(verifySignature(body, `${sign(body)}00`, SECRET)).toBe(false);
  });

  it("отклоняет подпись с не-hex символами нужной длины", () => {
    expect(verifySignature(body, `sha256=${"z".repeat(64)}`, SECRET)).toBe(false);
  });
});

describe("parseInstagramWebhook", () => {
  const commentValue = {
    from: { id: USER, username: "sample_user" },
    media: { id: "17900000000000001", media_product_type: "FEED" },
    id: "17900000000000100",
    text: "Сколько стоит лечение?",
  };

  const commentFixture = {
    object: "instagram",
    entry: [{ id: ACCOUNT, time: 1730000000, changes: [{ field: "comments", value: commentValue }] }],
  };

  it("разбирает новый комментарий к публикации", () => {
    expect(parseInstagramWebhook(commentFixture)).toEqual([
      {
        type: "comment",
        accountId: ACCOUNT,
        commentId: "17900000000000100",
        mediaId: "17900000000000001",
        fromId: USER,
        fromUsername: "sample_user",
        text: "Сколько стоит лечение?",
      },
    ]);
  });

  it("разбирает ответ на комментарий и сохраняет parent_id", () => {
    const reply = {
      object: "instagram",
      entry: [
        {
          id: ACCOUNT,
          changes: [
            {
              field: "comments",
              value: { ...commentValue, id: "17900000000000200", parent_id: "17900000000000100", text: "Spasibo!" },
            },
          ],
        },
      ],
    };
    expect(parseInstagramWebhook(reply)).toEqual([
      expect.objectContaining({
        type: "comment",
        commentId: "17900000000000200",
        parentId: "17900000000000100",
        text: "Spasibo!",
      }),
    ]);
  });

  it("комментарий без текста получает пустой text и без username не получает fromUsername", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: ACCOUNT,
          changes: [{ field: "comments", value: { id: "17900000000000300", from: { id: USER } } }],
        },
      ],
    };
    const [event] = parseInstagramWebhook(body);
    expect(event).toEqual({ type: "comment", accountId: ACCOUNT, commentId: "17900000000000300", fromId: USER, text: "" });
    expect(event).not.toHaveProperty("fromUsername");
    expect(event).not.toHaveProperty("mediaId");
    expect(event).not.toHaveProperty("parentId");
  });

  it("пропускает комментарий без from.id", () => {
    const body = {
      object: "instagram",
      entry: [{ id: ACCOUNT, changes: [{ field: "comments", value: { id: "17900000000000400", text: "hi" } }] }],
    };
    expect(parseInstagramWebhook(body)).toEqual([]);
  });

  it("разбирает личное сообщение с текстом", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: ACCOUNT,
          time: 1730000000,
          messaging: [
            {
              sender: { id: USER },
              recipient: { id: ACCOUNT },
              timestamp: 1730000000000,
              message: { mid: "aWdfZAG1f0000000000000001", text: "Hello, how much is it?" },
            },
          ],
        },
      ],
    };
    expect(parseInstagramWebhook(body)).toEqual([
      {
        type: "dm",
        accountId: ACCOUNT,
        mid: "aWdfZAG1f0000000000000001",
        senderId: USER,
        text: "Hello, how much is it?",
        hasAttachment: false,
      },
    ]);
  });

  it("личное сообщение с вложением помечает hasAttachment и не получает text", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: ACCOUNT,
          messaging: [
            {
              sender: { id: USER },
              recipient: { id: ACCOUNT },
              message: {
                mid: "aWdfZAG1f0000000000000002",
                attachments: [{ type: "image", payload: { url: "https://cdn.example.invalid/photo.jpg" } }],
              },
            },
          ],
        },
      ],
    };
    const [event] = parseInstagramWebhook(body);
    expect(event).toMatchObject({ type: "dm", senderId: USER, hasAttachment: true });
    expect(event).not.toHaveProperty("text");
  });

  it("пустой массив вложений не считается вложением", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: ACCOUNT,
          messaging: [
            { sender: { id: USER }, recipient: { id: ACCOUNT }, message: { mid: "m1", text: "x", attachments: [] } },
          ],
        },
      ],
    };
    expect(parseInstagramWebhook(body)[0]).toMatchObject({ hasAttachment: false });
  });

  it("эхо-сообщение (is_echo) разбирается как echo с получателем", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: ACCOUNT,
          messaging: [
            {
              sender: { id: ACCOUNT },
              recipient: { id: USER },
              message: { mid: "aWdfZAG1f0000000000000003", is_echo: true, text: "Our reply" },
            },
          ],
        },
      ],
    };
    expect(parseInstagramWebhook(body)).toEqual([
      { type: "echo", accountId: ACCOUNT, mid: "aWdfZAG1f0000000000000003", recipientId: USER },
    ]);
  });

  it("подтверждение прочтения, реакция и постбэк без message игнорируются", () => {
    const read = { sender: { id: USER }, recipient: { id: ACCOUNT }, timestamp: 1, read: { mid: "m1" } };
    const reaction = {
      sender: { id: USER },
      recipient: { id: ACCOUNT },
      timestamp: 2,
      reaction: { mid: "m2", action: "react", reaction: "love", emoji: "❤️" },
    };
    const postback = { sender: { id: USER }, recipient: { id: ACCOUNT }, timestamp: 3, postback: { title: "Start" } };
    const body = { object: "instagram", entry: [{ id: ACCOUNT, messaging: [read, reaction, postback] }] };
    expect(parseInstagramWebhook(body)).toEqual([]);
  });

  it("объект не instagram (например page) даёт пустой список", () => {
    expect(parseInstagramWebhook({ ...commentFixture, object: "page" })).toEqual([]);
  });

  it("мусорный вход не бросает исключение и даёт пустой список", () => {
    for (const garbage of [null, undefined, [], 42, "instagram", true, {}, { object: "instagram" }, { object: "instagram", entry: "x" }]) {
      expect(parseInstagramWebhook(garbage)).toEqual([]);
    }
  });

  it("запись с нестроковым id пропускается, остальные разбираются", () => {
    const body = {
      object: "instagram",
      entry: [
        { id: 17841400000000009, changes: [{ field: "comments", value: commentValue }] },
        { id: ACCOUNT, changes: [{ field: "comments", value: commentValue }] },
      ],
    };
    const events = parseInstagramWebhook(body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ accountId: ACCOUNT });
  });

  it("запись может содержать одновременно changes и messaging", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: ACCOUNT,
          changes: [{ field: "comments", value: commentValue }],
          messaging: [{ sender: { id: USER }, recipient: { id: ACCOUNT }, message: { mid: "m9", text: "Hi" } }],
        },
      ],
    };
    const events = parseInstagramWebhook(body);
    expect(events.map((e) => e.type)).toEqual(["comment", "dm"]);
  });

  it("пакет из нескольких записей и событий сохраняет порядок", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: ACCOUNT,
          changes: [
            { field: "comments", value: { ...commentValue, id: "c1" } },
            { field: "mentions", value: { id: "not-a-comment" } },
            { field: "comments", value: { ...commentValue, id: "c2" } },
          ],
        },
        {
          id: "17841400000000003",
          messaging: [
            { sender: { id: USER }, recipient: { id: "17841400000000003" }, message: { mid: "m1", text: "one" } },
            { sender: { id: USER }, recipient: { id: "17841400000000003" }, read: { mid: "m0" } },
            { sender: { id: "17841400000000003" }, recipient: { id: USER }, message: { mid: "m2", is_echo: true } },
          ],
        },
      ],
    };
    const events = parseInstagramWebhook(body);
    expect(events.map((e) => [e.type, e.accountId])).toEqual([
      ["comment", ACCOUNT],
      ["comment", ACCOUNT],
      ["dm", "17841400000000003"],
      ["echo", "17841400000000003"],
    ]);
    expect(events[0]).toMatchObject({ commentId: "c1" });
    expect(events[1]).toMatchObject({ commentId: "c2" });
  });
});

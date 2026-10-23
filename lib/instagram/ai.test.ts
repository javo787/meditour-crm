import type { askGemini } from "@/lib/gemini";
import type { ChatMessage } from "@/lib/types";
import {
  composeDirectReply,
  instagramChannelHint,
  needsWhatsAppLine,
  sanitizeBubbles,
  whatsappLine,
} from "./ai";

const N = "+992 00 550 77 77";
const D = "992005507777";
const CTX = { whatsappNumber: N, whatsappDigits: D };
const LINE_RU = `Подробнее и документы — в WhatsApp: ${N} (https://wa.me/${D})`;
const LINE_EN = `More details and documents — on WhatsApp: ${N} (https://wa.me/${D})`;
const NOW = new Date("2026-10-20T10:00:00.000Z");
const ITEMS_RU = [{ text: "Здравствуйте, сколько стоит МРТ?" }];

const msg = (from: ChatMessage["from"], text: string): ChatMessage => ({
  id: `${from}-${text}`,
  leadId: "17841400000000003",
  from,
  text,
  at: "2026-10-20T09:00:00.000Z",
});
const WA_AI = msg("ai", `Пишите нам: https://wa.me/${D}`);
const PLAIN_AI = msg("ai", "Хорошо, жду документы.");

type Ask = typeof askGemini;
type AskParams = Parameters<Ask>[0];
type FakeReply = { messages: string[]; handoff?: boolean; suppressed?: "empty" | "duplicate" | "arabic-script" };

// Подставной askGemini: отдаёт заготовленный ответ и запоминает, с чем его вызвали.
function fakeAsk(reply: FakeReply) {
  const mock = jest.fn(async (_params: AskParams) => ({ handoff: false, ...reply }));
  return { ask: mock as unknown as Ask, mock };
}

describe("instagramChannelHint", () => {
  it("возвращает служебную заметку о канале с номером и ссылкой WhatsApp", () => {
    expect(instagramChannelHint(CTX)).toBe(
      `Канал: Instagram Direct (не WhatsApp). Пиши коротко: 1–3 коротких сообщения, без markdown, без звёздочек и списков. Отвечай по существу на вопрос человека по регламенту. Подробное обсуждение и любые документы или фото — в WhatsApp: ${N} (https://wa.me/${D}); приглашай туда мягко и не в каждом сообщении. Не проси присылать документы, фото или анализы в Instagram и не предлагай звонок.`,
    );
  });
});

describe("whatsappLine", () => {
  it("по-русски: строка с номером и ссылкой", () => {
    expect(whatsappLine("ru", CTX)).toBe(LINE_RU);
  });

  it("по-английски: строка с номером и ссылкой", () => {
    expect(whatsappLine("en", CTX)).toBe(LINE_EN);
  });
});

describe("sanitizeBubbles", () => {
  it("убирает ** и __ и обратные кавычки", () => {
    expect(sanitizeBubbles(["**Важно:** цена __зависит__ от `клиники`"])).toEqual(["Важно: цена зависит от клиники"]);
  });

  it("убирает # в начале строки (заголовки)", () => {
    expect(sanitizeBubbles(["## Стоимость\nОт 3000 долларов"])).toEqual(["Стоимость\nОт 3000 долларов"]);
  });

  it("убирает * в начале строки (маркеры списка)", () => {
    expect(sanitizeBubbles(["* первый\n* второй"])).toEqual(["первый\nвторой"]);
  });

  it("дефис в начале строки становится тире с пробелом", () => {
    expect(sanitizeBubbles(["- первый\n- второй"])).toEqual(["— первый\n— второй"]);
  });

  it("дефис внутри строки не трогает", () => {
    expect(sanitizeBubbles(["цена - 100 долларов"])).toEqual(["цена - 100 долларов"]);
  });

  it("схлопывает три и более переносов строки в два", () => {
    expect(sanitizeBubbles(["Строка 1\n\n\n\nСтрока 2"])).toEqual(["Строка 1\n\nСтрока 2"]);
  });

  it("обрезает пробелы и отбрасывает пустые пузыри", () => {
    expect(sanitizeBubbles(["  Привет  ", "   ", "", "**"])).toEqual(["Привет"]);
  });

  it("пузырь длиннее 950 байт режется по последнему пробелу, уложившемуся в лимит, и получает многоточие", () => {
    const words = Array(86).fill("слово").join(" ");
    const [out] = sanitizeBubbles([`${words} слово`]);
    expect(out).toBe(`${words}…`);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(950);
  });

  it("пузырь ровно из 950 байт (475 кириллических букв) не режется", () => {
    const text = "а".repeat(475);
    expect(sanitizeBubbles([text])).toEqual([text]);
  });

  it("пузырь из 952 байт (476 кириллических букв) режется, итог не длиннее 950 байт", () => {
    const [out] = sanitizeBubbles(["а".repeat(476)]);
    expect(out).toBe(`${"а".repeat(473)}…`);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(950);
  });

  it("длинное слово без пробелов режется жёстко по байтам: 473 буквы и многоточие", () => {
    const [out] = sanitizeBubbles(["б".repeat(950)]);
    expect(out).toBe(`${"б".repeat(473)}…`);
    expect(Buffer.byteLength(out, "utf8")).toBe(949);
  });

  it("эмодзи (4 байта) не разрываются: 236 штук и многоточие", () => {
    const [out] = sanitizeBubbles(["😀".repeat(300)]);
    expect(out).toBe(`${"😀".repeat(236)}…`);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(950);
  });

  it("кириллица и эмодзи вперемешку: эмодзи считается в 4 байта, итог в лимите", () => {
    const [out] = sanitizeBubbles([`${"б".repeat(470)}😀${"б".repeat(10)}`]);
    expect(out).toBe(`${"б".repeat(470)}😀б…`);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(950);
  });

  it("суррогатная пара на границе лимита не разрывается", () => {
    const [out] = sanitizeBubbles([`${"a".repeat(945)}😀😀`]);
    expect(out).toBe(`${"a".repeat(945)}…`);
  });

  it("больше трёх пузырей: лишние дописываются к третьему через пустую строку", () => {
    expect(sanitizeBubbles(["1", "2", "3", "4", "5"])).toEqual(["1", "2", "3\n\n4\n\n5"]);
  });

  it("пустые пузыри не считаются в лимит из трёх", () => {
    expect(sanitizeBubbles(["1", "2", " ", "3", "4"])).toEqual(["1", "2", "3\n\n4"]);
  });

  it("объединённый третий пузырь тоже режется до 950 байт", () => {
    const out = sanitizeBubbles(["a", "b", "c", "x".repeat(600), "y".repeat(600)]);
    expect(out).toHaveLength(3);
    expect(out[2]).toBe(`c\n\n${"x".repeat(600)}…`);
  });

  it("пустой список остаётся пустым", () => {
    expect(sanitizeBubbles([])).toEqual([]);
  });
});

describe("needsWhatsAppLine", () => {
  it("без предыдущих ответов ИИ строка нужна", () => {
    expect(needsWhatsAppLine([], ["Ответ."])).toBe(true);
  });

  it("ссылка уже была в последнем ответе ИИ — строка не нужна", () => {
    expect(needsWhatsAppLine([WA_AI], ["Ответ."])).toBe(false);
  });

  it("один предыдущий ответ ИИ без ссылки — строка нужна", () => {
    expect(needsWhatsAppLine([PLAIN_AI], ["Ответ."])).toBe(true);
  });

  it("два предыдущих ответа ИИ без ссылки — строка нужна", () => {
    expect(needsWhatsAppLine([PLAIN_AI, PLAIN_AI], ["Ответ."])).toBe(true);
  });

  it("ссылка в одном из двух последних ответов ИИ — строка не нужна, в любом порядке", () => {
    expect(needsWhatsAppLine([PLAIN_AI, WA_AI], ["Ответ."])).toBe(false);
    expect(needsWhatsAppLine([WA_AI, PLAIN_AI], ["Ответ."])).toBe(false);
  });

  it("ссылка только в третьем с конца ответе ИИ — строка нужна (окно из двух)", () => {
    expect(needsWhatsAppLine([WA_AI, PLAIN_AI, PLAIN_AI], ["Ответ."])).toBe(true);
  });

  it("ссылка в середине из трёх — строка не нужна", () => {
    expect(needsWhatsAppLine([PLAIN_AI, WA_AI, PLAIN_AI], ["Ответ."])).toBe(false);
  });

  it("ссылки в сообщениях пациента и координатора не считаются", () => {
    const history = [msg("patient", `Вот ссылка https://wa.me/${D}`), msg("coordinator", `Пишите: ${N}`)];
    expect(needsWhatsAppLine(history, ["Ответ."])).toBe(true);
  });

  it("номер WhatsApp в новых пузырях — строка не нужна, даже без истории", () => {
    expect(needsWhatsAppLine([], [`Напишите нам в WhatsApp: ${N}`])).toBe(false);
  });

  it("упоминание wa.me без номера тоже считается ссылкой", () => {
    expect(needsWhatsAppLine([], ["Вот wa.me/xyz"])).toBe(false);
  });

  it("цифры 992 внутри другого числа (цена 9920) не считаются номером WhatsApp", () => {
    expect(needsWhatsAppLine([], ["Стоимость 9920 долларов"])).toBe(true);
  });

  it("номер с плюсом +992 в новом пузыре считается ссылкой на WhatsApp", () => {
    expect(needsWhatsAppLine([], ["Пишите: +992 00 550 77 77"])).toBe(false);
  });

  it("everyN = 1: строка нужна в каждом ответе, даже если ссылка была раньше", () => {
    expect(needsWhatsAppLine([WA_AI], ["Ответ."], 1)).toBe(true);
  });

  it("everyN = 5 смотрит на четыре последних ответа ИИ", () => {
    expect(needsWhatsAppLine([WA_AI, PLAIN_AI, PLAIN_AI, PLAIN_AI], ["Ответ."], 5)).toBe(false);
    expect(needsWhatsAppLine([WA_AI, PLAIN_AI, PLAIN_AI, PLAIN_AI, PLAIN_AI], ["Ответ."], 5)).toBe(true);
  });
});

describe("composeDirectReply", () => {
  it("вызывает ask с каналом Instagram, историей и вопросами, очищает пузыри и дописывает строку WhatsApp", async () => {
    const history = [msg("patient", "Привет"), msg("ai", "Здравствуйте! Чем помочь?")];
    const { ask, mock } = fakeAsk({ messages: ["**Стоимость** зависит от клиники.", "Пришлите, пожалуйста, диагноз."] });

    const r = await composeDirectReply({ history, items: ITEMS_RU, ctx: CTX, now: NOW, requestId: "req-1", ask });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toEqual({
      history,
      items: ITEMS_RU,
      requestId: "req-1",
      now: NOW,
      channelHint: instagramChannelHint(CTX),
    });
    expect(r).toEqual({
      kind: "reply",
      bubbles: ["Стоимость зависит от клиники.", `Пришлите, пожалуйста, диагноз.\n\n${LINE_RU}`],
    });
  });

  it("если ссылка WhatsApp уже была в последних ответах ИИ, строка не добавляется", async () => {
    const { ask } = fakeAsk({ messages: ["Хорошо."] });

    const r = await composeDirectReply({ history: [WA_AI], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "reply", bubbles: ["Хорошо."] });
  });

  it("если номер WhatsApp уже есть в пузырях, строка не дублируется", async () => {
    const { ask } = fakeAsk({ messages: [`Напишите нам в WhatsApp: ${N}.`] });

    const r = await composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "reply", bubbles: [`Напишите нам в WhatsApp: ${N}.`] });
  });

  it("последний вопрос на английском: строка на английском", async () => {
    const { ask } = fakeAsk({ messages: ["Around 300 USD, depending on the clinic."] });

    const r = await composeDirectReply({
      history: [],
      items: [{ text: "How much does an MRI cost in India?" }],
      ctx: CTX,
      now: NOW,
      ask,
    });

    expect(r).toEqual({ kind: "reply", bubbles: [`Around 300 USD, depending on the clinic.\n\n${LINE_EN}`] });
  });

  it("язык строки берётся из последнего вопроса, а не из первого", async () => {
    const { ask } = fakeAsk({ messages: ["Клиника в Дели."] });

    const r = await composeDirectReply({
      history: [],
      items: [{ text: "How much does it cost?" }, { text: "Спасибо, а где клиника?" }],
      ctx: CTX,
      now: NOW,
      ask,
    });

    expect(r).toEqual({ kind: "reply", bubbles: [`Клиника в Дели.\n\n${LINE_RU}`] });
  });

  it("handoff отдаёт только { kind: 'handoff' }, даже если пузыри есть", async () => {
    const { ask } = fakeAsk({ messages: ["Передам врачам."], handoff: true });

    const r = await composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "handoff" });
  });

  it.each(["empty", "duplicate", "arabic-script"] as const)("ask подавил ответ (%s): none с той же причиной", async (reason) => {
    const { ask } = fakeAsk({ messages: [], suppressed: reason });

    const r = await composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "none", reason });
  });

  it("после очистки пузырей ничего не осталось: none с причиной empty", async () => {
    const { ask } = fakeAsk({ messages: ["**", "   ", "`"] });

    const r = await composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "none", reason: "empty" });
  });

  it("ошибка ask пробрасывается наружу, обработка — на вызывающем", async () => {
    const ask = jest.fn(async () => {
      throw new Error("gemini unavailable");
    }) as unknown as Ask;

    await expect(composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask })).rejects.toThrow(
      "gemini unavailable",
    );
  });

  it("цена 9920 не считается номером WhatsApp: строка дописывается к пузырю", async () => {
    const { ask } = fakeAsk({ messages: ["Стоимость 9920 долларов."] });

    const r = await composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "reply", bubbles: [`Стоимость 9920 долларов.\n\n${LINE_RU}`] });
  });

  it("ответ длиннее 950 байт режется по байтам; строка WhatsApp не влезает и уходит отдельным пузырём", async () => {
    const { ask } = fakeAsk({ messages: ["я".repeat(600)] });

    const r = await composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "reply", bubbles: [`${"я".repeat(473)}…`, LINE_RU] });
  });

  it("последний пузырь 940 байт: строка WhatsApp не влезает, уходит отдельным пузырём", async () => {
    const { ask } = fakeAsk({ messages: ["б".repeat(470)] });

    const r = await composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "reply", bubbles: ["б".repeat(470), LINE_RU] });
  });

  it("строка WhatsApp ровно до 950 байт дописывается к последнему пузырю", async () => {
    const last = "a".repeat(948 - Buffer.byteLength(LINE_RU, "utf8"));
    const { ask } = fakeAsk({ messages: [last] });

    const r = await composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "reply", bubbles: [`${last}\n\n${LINE_RU}`] });
  });

  it("три пузыря от модели плюс отдельная строка WhatsApp дают четыре пузыря", async () => {
    const { ask } = fakeAsk({ messages: ["1", "2", "б".repeat(470)] });

    const r = await composeDirectReply({ history: [], items: ITEMS_RU, ctx: CTX, now: NOW, ask });

    expect(r).toEqual({ kind: "reply", bubbles: ["1", "2", "б".repeat(470), LINE_RU] });
  });
});

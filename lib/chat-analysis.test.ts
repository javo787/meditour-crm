import { analyzeMessages, isSystemNote, type AnalyzedMessage } from "./chat-analysis";

// Душанбе = UTC+5: 08:00Z — 13:00 (в окне 12–17), 14:00Z — 19:00 (вне окна).
const window = { timeZone: "Asia/Dushanbe", startHour: 12, endHour: 17 };

const msg = (
  leadId: string,
  from: AnalyzedMessage["from"],
  text: string,
  at: string,
  deliveryFailed?: boolean
): AnalyzedMessage => ({ leadId, from, text, at, ...(deliveryFailed ? { deliveryFailed } : {}) });

const first = "Салом! Чӣ тавр кумак карда метавонам?";
const invite = "Конечно! Можем созвониться прямо сейчас?";
const repeat = "Хорошо, ответ ниже.";

const sample: AnalyzedMessage[] = [
  // Лид L1, ход 1 — в окне, два пузыря с паузой 0,5 сек и приглашением на звонок
  msg("L1", "patient", "Салом", "2026-10-15T08:00:00.000Z"),
  msg("L1", "ai", first, "2026-10-15T08:00:10.000Z"),
  msg("L1", "ai", invite, "2026-10-15T08:00:10.500Z"),
  // Лид L1, ход 2 — вне окна, три пузыря; пометка посреди хода ход не рвёт
  msg("L1", "patient", "ok", "2026-10-15T14:00:00.000Z"),
  msg("L1", "ai", repeat, "2026-10-15T14:00:08.000Z"),
  msg("L1", "ai", "— ИИ автоматически поставлен на паузу —", "2026-10-15T14:00:20.000Z"),
  msg("L1", "ai", repeat, "2026-10-15T14:00:30.000Z"),
  msg("L1", "ai", "سلام", "2026-10-15T14:01:00.000Z"),
  // Недоставленный ответ — не пузырь
  msg("L1", "ai", "Не дошло", "2026-10-15T14:05:00.000Z", true),
  // Лид L2 — пациент пишет арабской графикой, в окне
  msg("L2", "patient", "سلام", "2026-10-15T09:00:00.000Z"),
];

describe("isSystemNote", () => {
  it("узнаёт служебные пометки и не путает их с репликами", () => {
    expect(isSystemNote("— ИИ поставлен на паузу —")).toBe(true);
    expect(isSystemNote("Салом — дӯст")).toBe(false);
  });
});

describe("analyzeMessages", () => {
  const r = analyzeMessages(sample, window);

  it("считает сообщения по отправителям, не принимая пометки и недоставленные за реплики", () => {
    expect(r.messages).toEqual({
      total: sample.length,
      leads: 2,
      patient: 3,
      ai: 5,
      coordinator: 0,
      systemNotes: 1,
      aiDeliveryFailed: 1,
    });
    expect(r.period).toEqual({ firstAt: "2026-10-15T08:00:00.000Z", lastAt: "2026-10-15T14:05:00.000Z" });
  });

  it("длина, «вода», восклицания, повторы и арабская графика в ответах бота", () => {
    const lengths = [first, invite, repeat, repeat, "سلام"].map((t) => t.length);
    expect(r.aiBubbles.count).toBe(5);
    expect(r.aiBubbles.length.max).toBe(Math.max(...lengths));
    expect(r.aiBubbles.over150Share).toBe(0);
    expect(r.aiBubbles.over300Share).toBe(0);
    expect(r.aiBubbles.fillerOpenerShare).toBe(0.6); // «Конечно!», «Хорошо,» ×2
    expect(r.aiBubbles.exclamationShare).toBe(0.4);
    expect(r.aiBubbles.repeatedShare).toBe(0.2); // второй «Хорошо, ответ ниже.»
    expect(r.aiBubbles.arabicScript).toBe(1);
    expect(r.patientArabicScriptMessages).toBe(1);
  });

  it("ходы: число пузырей и паузы между ними (доля «всё разом»)", () => {
    expect(r.turns.count).toBe(2);
    expect(r.turns.bubbles).toEqual({ "1": 0, "2": 1, "3": 1, "4+": 0 });
    expect(r.turns.avgBubbles).toBe(2.5);
    expect(r.turns.gapSeconds.count).toBe(3); // 0,5 / 22 / 30 сек
    expect(r.turns.gapSeconds.median).toBe(22);
    expect(r.turns.gapSeconds.under2sShare).toBe(0.333);
  });

  it("когда пишут пациенты (по часам в нужном поясе) и доля в рабочем окне", () => {
    expect(r.patientActivity.timeZone).toBe("Asia/Dushanbe");
    expect(r.patientActivity.window).toBe("12:00-17:00");
    expect(r.patientActivity.byHour[13]).toBe(1);
    expect(r.patientActivity.byHour[14]).toBe(1);
    expect(r.patientActivity.byHour[19]).toBe(1);
    expect(r.patientActivity.inWindowShare).toBe(0.667);
  });

  it("leadsByHour считает разных пациентов, а не сообщения: серия от одного не выглядит пиком", () => {
    const burst = analyzeMessages(
      [
        msg("A", "patient", "фото 1", "2026-10-15T08:00:00.000Z"),
        msg("A", "patient", "фото 2", "2026-10-15T08:01:00.000Z"),
        msg("A", "patient", "фото 3", "2026-10-15T08:02:00.000Z"),
        msg("B", "patient", "Салом", "2026-10-15T08:30:00.000Z"),
      ],
      window
    );
    expect(burst.patientActivity.byHour[13]).toBe(4);
    expect(burst.patientActivity.leadsByHour[13]).toBe(2);
    expect(r.patientActivity.leadsByHour[13]).toBe(1);
    expect(r.patientActivity.leadsByHour[19]).toBe(1);
  });

  it("зовёт ли бот на звонок: в окне — да, вне окна — нет", () => {
    expect(r.callInvites.inWindow).toEqual({ turns: 1, withCallMentionShare: 1 });
    expect(r.callInvites.outOfWindow).toEqual({ turns: 1, withCallMentionShare: 0 });
  });

  it("служебные пометки раскладываются по категориям", () => {
    expect(r.notes).toEqual({ autoPause: 1 });
  });

  it("не отдаёт тексты, имена и номера: в ответе только числа и служебные подписи", () => {
    const json = JSON.stringify(r);
    for (const secret of [first, invite, repeat, "L1", "L2"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("пустой ввод не падает и не выдумывает значения", () => {
    const empty = analyzeMessages([], window);
    expect(empty.messages.total).toBe(0);
    expect(empty.period).toEqual({ firstAt: null, lastAt: null });
    expect(empty.aiBubbles.length.median).toBeNull();
    expect(empty.turns.gapSeconds.under2sShare).toBeNull();
    expect(empty.callInvites.inWindow.withCallMentionShare).toBeNull();
  });

  it("ответы через паузу дольше двух минут — отдельные ходы", () => {
    const res = analyzeMessages(
      [
        msg("L", "ai", "Первый ответ про документы.", "2026-10-15T08:00:00.000Z"),
        msg("L", "ai", "Напоминание по расписанию.", "2026-10-15T08:10:00.000Z"),
      ],
      window
    );
    expect(res.turns.count).toBe(2);
    expect(res.turns.gapSeconds.count).toBe(0);
  });
});

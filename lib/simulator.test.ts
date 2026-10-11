import {
  buildPatientSystemPrompt,
  END_MARKER,
  parsePatientReply,
  toPatientContents,
  transcriptToText,
} from "./simulator";
import { SIM_PERSONAS, findPersona } from "./simulator-scenarios";

describe("toPatientContents", () => {
  it("пустой диалог — просим первое сообщение", () => {
    const c = toPatientContents([]);
    expect(c).toHaveLength(1);
    expect(c[0].role).toBe("user");
  });

  it("роли зеркальны: пациент — model, ИИ — user", () => {
    const c = toPatientContents([
      { from: "patient", text: "Здравствуйте" },
      { from: "ai", text: "Салом! Чем помочь?" },
    ]);
    expect(c.map((x) => x.role)).toEqual(["model", "user"]);
  });

  it("если последним писал пациент — добавляет служебный ход user", () => {
    const c = toPatientContents([{ from: "patient", text: "Здравствуйте" }]);
    expect(c.map((x) => x.role)).toEqual(["model", "user"]);
    expect(c[1].parts[0].text).toContain(END_MARKER);
  });
});

describe("parsePatientReply", () => {
  it("обычная реплика", () => {
    expect(parsePatientReply("  Сколько это стоит?  ")).toEqual({
      text: "Сколько это стоит?",
      end: false,
    });
  });
  it("маркер конца диалога", () => {
    expect(parsePatientReply("[END]")).toEqual({ text: "", end: true });
    expect(parsePatientReply("Спасибо, жду. [end]")).toEqual({ text: "Спасибо, жду.", end: true });
  });
  it("снимает кавычки и ярлык «Пациент:»", () => {
    expect(parsePatientReply('Пациент: «Добрый день»').text).toBe("Добрый день");
    expect(parsePatientReply('"Добрый день"').text).toBe("Добрый день");
  });
});

describe("buildPatientSystemPrompt", () => {
  it("содержит роль, язык и правило завершения", () => {
    const p = buildPatientSystemPrompt("Мужчина 50 лет", "tg");
    expect(p).toContain("Мужчина 50 лет");
    expect(p).toContain("Tajik");
    expect(p).toContain(END_MARKER);
  });
});

describe("transcriptToText", () => {
  it("подписывает реплики", () => {
    expect(
      transcriptToText([
        { from: "patient", text: "Привет" },
        { from: "ai", text: "Салом" },
      ])
    ).toBe("Пациент: Привет\nИИ: Салом");
  });
});

describe("SIM_PERSONAS", () => {
  it("id уникальны, а findPersona возвращает запасной вариант", () => {
    const ids = SIM_PERSONAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findPersona("нет-такого").id).toBe(SIM_PERSONAS[0].id);
  });
});

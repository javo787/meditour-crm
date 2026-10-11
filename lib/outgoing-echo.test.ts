import { ECHO_WINDOW_MS, findEchoMatch, normalizeMessageText } from "./outgoing-echo";

describe("normalizeMessageText", () => {
  it("схлопывает пробелы и переносы строк", () => {
    expect(normalizeMessageText("  Салом!\n\n Хуш  омадед ")).toBe("Салом! Хуш омадед");
  });
});

describe("findEchoMatch", () => {
  const candidates = [
    { id: "1", text: "Хорошо" },
    { id: "2", text: "Ждём документы" },
    { id: "3", text: "Хорошо" },
  ];

  it("находит сообщение с тем же текстом (самое раннее)", () => {
    expect(findEchoMatch(candidates, "Хорошо")?.id).toBe("1");
  });

  it("не чувствителен к лишним пробелам", () => {
    expect(findEchoMatch(candidates, " Ждём   документы\n")?.id).toBe("2");
  });

  it("возвращает undefined, если такого сообщения нет — значит, оно с телефона", () => {
    expect(findEchoMatch(candidates, "Привет, это Анвар")).toBeUndefined();
  });

  it("пустой текст ни с чем не совпадает", () => {
    expect(findEchoMatch([{ id: "x", text: "" }], "   ")).toBeUndefined();
  });

  it("окно ожидания эха — 10 минут", () => {
    expect(ECHO_WINDOW_MS).toBe(600_000);
  });
});

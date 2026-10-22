import {
  buildCommentPrivateReply,
  buildCommentReply,
  buildDirectInvite,
  detectLanguage,
  isPriceQuestion,
  isWorthReplying,
} from "./replies";

const N = "+992 00 550 77 77";
const D = "992005507777";
const CTX = { whatsappNumber: N, whatsappDigits: D };
const LINK = "https://wa.me/992005507777";

// Тексты из брифа, дословно. {n} в тексте заменяется номером.
const RU_GENERAL = [
  `Здравствуйте! 🌿 Спасибо за интерес к Meditur HBG. Подробно расскажем про лечение в Индии и стоимость в WhatsApp: ${N} — будем рады помочь! 💙`,
  `Добрый день! 💙 Благодарим за комментарий. Для консультации и расчёта стоимости напишите нам в WhatsApp: ${N} — личный координатор ответит на все вопросы.`,
  `Здравствуйте! ✨ Чтобы ответить подробно (диагноз, клиники, стоимость), приглашаем вас в WhatsApp: ${N}. Мы на связи!`,
];
const RU_PRICE = `Здравствуйте! 💙 Стоимость зависит от диагноза и выбранной клиники — мы рассчитаем её бесплатно после изучения ваших документов. Напишите нам в WhatsApp: ${N}.`;
const EN_GENERAL = [
  `Hello! 🌿 Thank you for your interest in Meditur HBG. We'll gladly explain the treatment options in India and the costs on WhatsApp: ${N} 💙`,
  `Hi! 💙 For a personal consultation and a cost estimate, please message us on WhatsApp: ${N} — our coordinator will help you.`,
];
const EN_PRICE = `Hello! 💙 The cost depends on the diagnosis and the hospital — we'll calculate it for free once we review your documents. Please message us on WhatsApp: ${N}.`;

const RU_PRIVATE = [
  "Здравствуйте! 👋 Спасибо за ваш комментарий. Это Meditur HBG — международное лечение без посредников.",
  "",
  "Подробно расскажем про лечение, клиники и стоимость в WhatsApp:",
  `📱 ${N}`,
  `👉 ${LINK}`,
  "",
  "Будем рады помочь! 💙",
].join("\n");
const EN_PRIVATE = [
  "Hello! 👋 Thank you for your comment. This is Meditur HBG — international treatment without intermediaries.",
  "",
  "We'll gladly tell you about treatment, hospitals and costs on WhatsApp:",
  `📱 ${N}`,
  `👉 ${LINK}`,
  "",
  "We'll be happy to help! 💙",
].join("\n");

const RU_DIRECT = [
  "Здравствуйте! 👋 Это Meditur HBG — международное лечение без посредников.",
  "",
  "Чтобы быстро и подробно ответить на ваш вопрос (диагноз, клиники в Индии, стоимость, документы), напишите нам в WhatsApp:",
  `📱 ${N}`,
  `👉 ${LINK}`,
  "",
  "Там с вами свяжется личный координатор. Будем рады помочь! 💙",
].join("\n");
const EN_DIRECT = [
  "Hello! 👋 This is Meditur HBG — international treatment without intermediaries.",
  "",
  "To answer you quickly and in detail (diagnosis, hospitals in India, costs, documents), please message us on WhatsApp:",
  `📱 ${N}`,
  `👉 ${LINK}`,
  "",
  "A personal coordinator will take it from there. We'll be happy to help! 💙",
].join("\n");

describe("detectLanguage", () => {
  it("любая кириллическая буква даёт ru", () => {
    expect(detectLanguage("Привет")).toBe("ru");
    expect(detectLanguage("Hello Привет")).toBe("ru");
  });

  it("таджикский текст на кириллице даёт ru", () => {
    expect(detectLanguage("Салом, ман ҳақиқатан мехоҳам маълумот гирам")).toBe("ru");
  });

  it("не менее трёх латинских букв без кириллицы дают en", () => {
    expect(detectLanguage("Hello")).toBe("en");
    expect(detectLanguage("Price?")).toBe("en");
    expect(detectLanguage("Hey you")).toBe("en");
  });

  it("меньше трёх латинских букв, цифры и эмодзи дают ru по умолчанию", () => {
    expect(detectLanguage("Hi")).toBe("ru");
    expect(detectLanguage("123")).toBe("ru");
    expect(detectLanguage("🔥👍")).toBe("ru");
    expect(detectLanguage("")).toBe("ru");
  });
});

describe("isPriceQuestion", () => {
  it("распознаёт русские слова о цене без учёта регистра", () => {
    expect(isPriceQuestion("Сколько стоит?")).toBe(true);
    expect(isPriceQuestion("СКОЛЬКО")).toBe(true);
    expect(isPriceQuestion("Какая стоимость лечения?")).toBe(true);
    expect(isPriceQuestion("Почём операция?")).toBe(true);
    expect(isPriceQuestion("Почем операция?")).toBe(true);
    expect(isPriceQuestion("Нархи чанд аст?")).toBe(true);
    expect(isPriceQuestion("Какие цены?")).toBe(true);
  });

  it("распознаёт английские слова о цене", () => {
    expect(isPriceQuestion("Price?")).toBe(true);
    expect(isPriceQuestion("What is the cost")).toBe(true);
    expect(isPriceQuestion("How much?")).toBe(true);
  });

  it("обычные комментарии не считаются вопросом о цене", () => {
    expect(isPriceQuestion("Спасибо, очень красиво")).toBe(false);
    expect(isPriceQuestion("Looks great, thanks")).toBe(false);
    expect(isPriceQuestion("")).toBe(false);
  });
});

describe("isWorthReplying", () => {
  it("комментарий из одних эмодзи не стоит ответа", () => {
    expect(isWorthReplying("🔥🔥🔥")).toBe(false);
    expect(isWorthReplying("❤️")).toBe(false);
    expect(isWorthReplying("")).toBe(false);
  });

  it("комментарий с тремя и более отметками @ не стоит ответа", () => {
    expect(isWorthReplying("@friend @friend2 @friend3 look")).toBe(false);
  });

  it("две отметки @ допустимы, если остаётся текст", () => {
    expect(isWorthReplying("@friend1 @friend2 hi")).toBe(true);
    expect(isWorthReplying("@friend look")).toBe(true);
  });

  it("ссылки (http, https, www) делают комментарий неподходящим", () => {
    expect(isWorthReplying("see http://example.invalid/x")).toBe(false);
    expect(isWorthReplying("HTTPS://example.invalid")).toBe(false);
    expect(isWorthReplying("check www.example.invalid")).toBe(false);
  });

  it("одни хештеги не стоят ответа, хештеги с текстом — стоят", () => {
    expect(isWorthReplying("#meditur #india")).toBe(false);
    expect(isWorthReplying("#meditur Спасибо")).toBe(true);
  });

  it("требуется хотя бы две буквы или цифры", () => {
    expect(isWorthReplying("a")).toBe(false);
    expect(isWorthReplying("ok")).toBe(true);
    expect(isWorthReplying("Сколько стоит?")).toBe(true);
  });
});

describe("buildCommentReply", () => {
  it("общий ответ на русском берётся из трёх вариантов и содержит номер", () => {
    const reply = buildCommentReply({ text: "Очень интересно, спасибо", commentId: "17900000000000100", ...CTX });
    expect(RU_GENERAL).toContain(reply);
    expect(reply).toContain(N);
  });

  it("выбор варианта: сумма кодов символов commentId по модулю числа вариантов", () => {
    // "A" = 65: 65 % 3 = 2 (третий вариант RU), 65 % 2 = 1 (второй вариант EN)
    expect(buildCommentReply({ text: "Очень интересно", commentId: "A", ...CTX })).toBe(RU_GENERAL[2]);
    expect(buildCommentReply({ text: "Nice post", commentId: "A", ...CTX })).toBe(EN_GENERAL[1]);
  });

  it("для одного commentId ответ всегда одинаковый", () => {
    const first = buildCommentReply({ text: "Интересно", commentId: "17900000000000777", ...CTX });
    for (let i = 0; i < 5; i++) {
      expect(buildCommentReply({ text: "Интересно", commentId: "17900000000000777", ...CTX })).toBe(first);
    }
  });

  it("разные commentId распределяются по всем вариантам", () => {
    const ru = new Set<string>();
    const en = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const commentId = `17900000000000${String(i).padStart(3, "0")}`;
      ru.add(buildCommentReply({ text: "Очень интересно", commentId, ...CTX }));
      en.add(buildCommentReply({ text: "Nice post", commentId, ...CTX }));
    }
    expect([...ru].sort()).toEqual([...RU_GENERAL].sort());
    expect([...en].sort()).toEqual([...EN_GENERAL].sort());
  });

  it("вопрос о цене на русском получает ответ про стоимость", () => {
    expect(buildCommentReply({ text: "Сколько стоит?", commentId: "17900000000000100", ...CTX })).toBe(RU_PRICE);
    expect(buildCommentReply({ text: "Почём лечение?", commentId: "A", ...CTX })).toBe(RU_PRICE);
  });

  it("вопрос о цене на английском получает ответ про стоимость", () => {
    expect(buildCommentReply({ text: "Price?", commentId: "17900000000000100", ...CTX })).toBe(EN_PRICE);
    expect(buildCommentReply({ text: "How much is it", commentId: "A", ...CTX })).toBe(EN_PRICE);
  });

  it("английский комментарий без вопроса о цене получает английский общий ответ", () => {
    expect(EN_GENERAL).toContain(buildCommentReply({ text: "Great clinic info", commentId: "17900000000000100", ...CTX }));
  });

  it("публичный ответ не содержит ссылок", () => {
    const texts = ["Сколько стоит?", "Price?", "Очень интересно", "Nice post"];
    for (const text of texts) {
      for (let i = 0; i < 6; i++) {
        const reply = buildCommentReply({ text, commentId: String(i * 7), ...CTX });
        expect(reply).not.toMatch(/https?:|wa\.me|www\./i);
        expect(reply).toContain(N);
      }
    }
  });

  it("подставляет переданный номер", () => {
    const reply = buildCommentReply({
      text: "Сколько стоит?",
      commentId: "1",
      whatsappNumber: "+79991234567",
      whatsappDigits: "79991234567",
    });
    expect(reply).toContain("+79991234567");
    expect(reply).not.toContain("{n}");
  });
});

describe("buildCommentPrivateReply", () => {
  it("на русском возвращает текст из брифа с номером и ссылкой", () => {
    expect(buildCommentPrivateReply({ text: "Здравствуйте, хочу узнать", ...CTX })).toBe(RU_PRIVATE);
  });

  it("на английском возвращает текст из брифа с номером и ссылкой", () => {
    expect(buildCommentPrivateReply({ text: "Hi, I want to know more", ...CTX })).toBe(EN_PRIVATE);
  });

  it("содержит номер и https://wa.me/<цифры> в любом языке", () => {
    for (const text of ["Очень интересно", "Nice post", "Price?", "Сколько стоит?"]) {
      const reply = buildCommentPrivateReply({ text, ...CTX });
      expect(reply).toContain(N);
      expect(reply).toContain(LINK);
    }
  });

  it("не путает язык: цена на английском не переключает на русский текст", () => {
    expect(buildCommentPrivateReply({ text: "Price?", ...CTX })).toBe(EN_PRIVATE);
  });
});

describe("buildDirectInvite", () => {
  it("на русском возвращает текст из брифа с номером и ссылкой", () => {
    expect(buildDirectInvite({ text: "Здравствуйте, подскажите", ...CTX })).toBe(RU_DIRECT);
  });

  it("на английском возвращает текст из брифа с номером и ссылкой", () => {
    expect(buildDirectInvite({ text: "Hello, do you treat knees?", ...CTX })).toBe(EN_DIRECT);
  });

  it("таджикский текст на кириллице получает русский текст", () => {
    expect(buildDirectInvite({ text: "Салом, нархи табобро медонам?", ...CTX })).toBe(RU_DIRECT);
  });

  it("содержит номер и ссылку, цена не меняет текст", () => {
    const reply = buildDirectInvite({ text: "Price?", ...CTX });
    expect(reply).toBe(EN_DIRECT);
    expect(reply).toContain(N);
    expect(reply).toContain(LINK);
  });
});

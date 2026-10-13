import {
  buildWarnings,
  compareNames,
  extractNumbers,
  languageName,
  looksLikeRealName,
  missingNumbers,
  parseDocDate,
  parseExtractionJson,
  resolveMimeType,
  sortDocuments,
  transliterate,
} from "@/lib/documents";

describe("extractNumbers / missingNumbers", () => {
  it("normalizes decimal commas and ignores dates and long IDs", () => {
    const nums = extractNumbers("Гемоглобин 12,5 г/дл, дата 19.04.1988, ИНН 0971245903, №698");
    expect(nums).toContain("12.5");
    expect(nums).toContain("698");
    expect(nums).not.toContain("19.04");
    expect(nums).not.toContain("0971245903");
  });

  it("does not flag dates written differently in the translation", () => {
    expect(missingNumbers("Дата: 12.03.2026, СОЭ 15", "Date: 12 Mar 2026, ESR 15")).toEqual([]);
  });

  it("finds numbers that dropped out of the translation", () => {
    expect(missingNumbers("Глюкоза 5,4 ммоль/л, холестерин 6,1", "Glucose 5.4 mmol/L")).toEqual(["6.1"]);
  });
});

describe("names", () => {
  it("transliterates Russian and Tajik Cyrillic", () => {
    expect(transliterate("Рахимов Изатулло")).toBe("Rakhimov Izatullo");
    expect(transliterate("Ҷамолов Ҳусрав")).toBe("Jamolov Husrav");
  });

  it("matches the same person across scripts and spellings", () => {
    expect(compareNames("Рахимов Изатулло Саидтиллоевич", "Rahimov Izatullo")).toBe("match");
    expect(compareNames("Jamolov S.", "Джамолов Саидмурод")).toBe("match");
  });

  it("flags a different person and handles empty input", () => {
    expect(compareNames("Каримова Мадина", "Rahimov Izatullo")).toBe("mismatch");
    expect(compareNames(undefined, "Rahimov Izatullo")).toBe("unknown");
  });

  it("does not treat nicknames or phone numbers as real names", () => {
    expect(looksLikeRealName("Anvar_92")).toBe(false);
    expect(looksLikeRealName("Контакт WhatsApp (номер скрыт)")).toBe(false);
    expect(looksLikeRealName("Рахимов Изатулло")).toBe(true);
  });
});

describe("parseExtractionJson", () => {
  it("parses a report and strips code fences", () => {
    const raw =
      '```json\n{"category":"report","title":"MRI hips","docDate":"12 Mar 2026","sourceLanguage":"ru","patientNameOnDoc":"Jamolov S.","originalText":"текст","translationEn":"text","uncertain":["??"]}\n```';
    const r = parseExtractionJson(raw);
    expect(r).toMatchObject({ category: "report", title: "MRI hips", docDate: "12 Mar 2026", translationEn: "text" });
    expect(r.uncertain).toEqual(["??"]);
  });

  it("drops text for imaging and treats unknown categories as other", () => {
    const img = parseExtractionJson('{"category":"imaging","title":"MRI","originalText":"x","translationEn":"y"}');
    expect(img.translationEn).toBe("");
    expect(parseExtractionJson('{"category":"banana"}').category).toBe("other");
  });

  it("turns the string null into no date and throws on garbage", () => {
    expect(parseExtractionJson('{"category":"report","docDate":"null"}').docDate).toBeUndefined();
    expect(() => parseExtractionJson("not json")).toThrow();
  });
});

describe("buildWarnings", () => {
  const base = {
    category: "report" as const,
    title: "t",
    originalText: "СОЭ 15, глюкоза 5,4",
    translationEn: "ESR 15, glucose 5.4",
    uncertain: [],
  };

  it("is quiet for a clean translation", () => {
    expect(buildWarnings({ extracted: base, leadName: "Рахимов Изатулло" })).toEqual([]);
  });

  it("warns about missing numbers, illegible fragments and a different person", () => {
    const warnings = buildWarnings({
      extracted: { ...base, translationEn: "ESR 15", uncertain: ["x"], patientNameOnDoc: "Каримова Мадина" },
      leadName: "Рахимов Изатулло",
    });
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("5.4");
  });

  it("warns when a report has an empty translation", () => {
    expect(buildWarnings({ extracted: { ...base, translationEn: "" } })[0]).toContain("пустой");
  });
});

describe("dates, order, language, mime", () => {
  it("parses the supported date forms", () => {
    expect(parseDocDate("12 Mar 2026")).toBe(Date.UTC(2026, 2, 12));
    expect(parseDocDate("Mar 2026")).toBe(Date.UTC(2026, 2, 1));
    expect(parseDocDate("2026-03-12")).toBe(Date.UTC(2026, 2, 12));
    expect(parseDocDate("whenever")).toBeNull();
  });

  it("sorts by date, undated last in upload order", () => {
    const docs = [
      { docDate: undefined, at: "2026-10-01T10:00:00Z", id: "c" },
      { docDate: "05 Sep 2026", at: "2026-10-01T11:00:00Z", id: "b" },
      { docDate: "01 Jan 2026", at: "2026-10-01T12:00:00Z", id: "a" },
      { docDate: undefined, at: "2026-10-01T09:00:00Z", id: "d" },
    ];
    expect(sortDocuments(docs).map((d) => d.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("names languages and resolves mime types", () => {
    expect(languageName("tg")).toBe("Tajik");
    expect(resolveMimeType("application/pdf; charset=x", "a")).toBe("application/pdf");
    expect(resolveMimeType("", "scan.HEIC")).toBe("image/heic");
    expect(resolveMimeType("application/zip", "a.zip")).toBeUndefined();
  });
});

import type { PatientDocument } from "@/lib/types";
import {
  buildWarnings,
  compareNames,
  crossDocumentWarnings,
  extractNumbers,
  findDuplicatePairs,
  groupDocuments,
  isMostlyIllegible,
  suggestProfile,
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

  it("treats the spelling variants from a real dossier as one person, but not a different surname", () => {
    for (const variant of ["Bobochonov Mirali", "BOBOKHONOV MIRALI", "Bobodjonov Mirali", "Bobochnovo Mirali"]) {
      expect(compareNames(variant, "Bobojonov Mirali")).toBe("match");
    }
    expect(compareNames("Boboeva B. P.", "Bobojonov Mirali")).toBe("mismatch");
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
    handwritten: false,
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


describe("new extraction fields and warnings", () => {
  it("parses dob, gender and handwritten", () => {
    const r = parseExtractionJson(
      '{"category":"report","title":"t","patientDob":"03 Jun 1983","patientGender":"male","handwritten":true,"translationEn":"x"}'
    );
    expect(r).toMatchObject({ patientDob: "03 Jun 1983", patientGender: "Male", handwritten: true });
    expect(parseExtractionJson('{"category":"report","patientGender":"null","patientDob":"null"}')).toMatchObject({
      patientGender: undefined,
      patientDob: undefined,
      handwritten: false,
    });
  });

  it("warns about handwriting and compares the name with the profile name first", () => {
    const base = {
      category: "report" as const,
      title: "t",
      originalText: "x",
      translationEn: "x",
      uncertain: [],
      handwritten: true,
      patientNameOnDoc: "Boboeva B. P.",
    };
    const w = buildWarnings({ extracted: base, leadName: "Anvar_92", profileName: "Bobojonov Mirali" });
    expect(w.some((x) => x.includes("Рукописный"))).toBe(true);
    expect(w.some((x) => x.includes("чужой документ"))).toBe(true);
  });

  it("detects documents where almost nothing could be read", () => {
    expect(isMostlyIllegible("16 Feb 2016 (illegible)\n(illegible)\n(illegible)\n(illegible)\nBlood pressure: 120/80")).toBe(true);
    expect(isMostlyIllegible("Hemoglobin: 158 g/L\nESR: 3 mm/h\n(illegible)")).toBe(false);
  });
});

function pd(over: Partial<PatientDocument>): PatientDocument {
  return {
    id: Math.random().toString(36).slice(2),
    leadId: "l",
    filename: "f.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1,
    source: "upload",
    at: "2026-10-01T10:00:00Z",
    status: "done",
    attempts: 1,
    category: "report",
    title: "Report",
    reviewed: false,
    include: true,
    ...over,
  };
}

describe("groupDocuments", () => {
  it("attaches pages to their main document in page order", () => {
    const main = pd({ id: "main", at: "2026-10-01T10:00:00Z" });
    const p3 = pd({ id: "p3", mergedInto: "main", pageNo: 3, at: "2026-10-01T10:01:00Z" });
    const p2 = pd({ id: "p2", mergedInto: "main", pageNo: 2, at: "2026-10-01T10:02:00Z" });
    const other = pd({ id: "other", at: "2026-10-01T10:03:00Z" });
    const groups = groupDocuments([main, p3, p2, other]);
    expect(groups.map((g) => g.primary.id)).toEqual(["main", "other"]);
    expect(groups[0].pages.map((p) => p.id)).toEqual(["main", "p2", "p3"]);
  });

  it("keeps a page standalone when its main document is gone", () => {
    const orphan = pd({ id: "orphan", mergedInto: "deleted", pageNo: 2 });
    expect(groupDocuments([orphan]).map((g) => g.primary.id)).toEqual(["orphan"]);
  });
});

describe("cross-document checks", () => {
  const ctText =
    "Frontal sinuses are pneumatized without mucosal thickening or fluid levels. The mucosa of the sphenoid sinuses is thickened on both sides. Nasal septum deviation to the right with a bony spur measuring 5 mm. No bone destructive changes were detected at the examined level.";

  it("finds two photos of the same report but not different reports", () => {
    const a = pd({ id: "a", title: "CT sinuses", translationEn: ctText, originalText: "" });
    const b = pd({ id: "b", title: "CT sinuses", translationEn: ctText.replace("pneumatized", "aerated"), originalText: "" });
    const c = pd({ id: "c", title: "Blood", translationEn: "Hemoglobin 158 g/L reference 115 to 173 platelets 366 leukocytes 11.09 neutrophils 79 percent lymphocytes 16 percent eosinophils 0 percent" });
    const pairs = findDuplicatePairs(groupDocuments([a, b, c]));
    expect(pairs).toHaveLength(1);
    expect(pairs[0].map((g) => g.primary.id).sort()).toEqual(["a", "b"]);
    expect(crossDocumentWarnings([a, b, c]).get("a")?.[0]).toContain("дубль");
  });

  it("flags a birth date that differs from the rest and a year far from the others", () => {
    const docs = [
      pd({ id: "1", patientDob: "03 Jun 1983", docDate: "14 Aug 2026" }),
      pd({ id: "2", patientDob: "03 Jun 1983", docDate: "09 Jun 2026" }),
      pd({ id: "3", patientDob: "03 Jun 1983", docDate: "11 Aug 2026" }),
      pd({ id: "4", patientDob: "1984", docDate: "14 Aug 2020" }),
    ];
    const w = crossDocumentWarnings(docs);
    expect(w.get("4")?.some((x) => x.includes("Дата рождения"))).toBe(true);
    expect(w.get("4")?.some((x) => x.includes("Год документа (2020)"))).toBe(true);
    expect(w.get("1")).toBeUndefined();
  });

  it("suggests the most common full birth date and gender", () => {
    const docs = [
      pd({ patientDob: "03 Jun 1983", patientGender: "Male" }),
      pd({ patientDob: "03 Jun 1983", patientGender: "Male" }),
      pd({ patientDob: "1984" }),
    ];
    expect(suggestProfile(docs)).toEqual({ dob: "03 Jun 1983", gender: "Male" });
    expect(suggestProfile([pd({ patientDob: "03 Jun 1983" })])).toEqual({ dob: undefined, gender: undefined });
  });
});

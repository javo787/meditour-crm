import JSZip from "jszip";
import mammoth from "mammoth";
import { makeDocx } from "./docx-test-utils";
import { docxToText, dropTourSentences, findContacts, htmlToPlainText, prepareSource, sha256Hex, stripContacts } from "./source";

describe("prepareSource", () => {
  it("drops links, e-mails, phones and tour lines but keeps money and counts", () => {
    const out = prepareSource([
      "Dear Sir, thank you for the reports.",
      "To know more, click https://example.org/hospitals/a?x=1 now.",
      "Kindly have a visual tour of the hospital via link - https://pin.it/abc123",
      "Write to doctor.name@example.org or call +91 98765 43210.",
      "Cost USD 6800 and USD 2000-2500, dialysis 10 sessions.",
    ].join("\n"));
    expect(out).not.toMatch(/https?:|pin\.it|@example|98765|visual tour/i);
    for (const kept of ["USD 6800", "USD 2000-2500", "10 sessions"]) expect(out).toContain(kept);
  });

  // Регрессия: «Click on the link» стоит в конце абзаца про госпиталь и в конце строки с врачом. Раньше такая
  // строка удалялась целиком, и вместе с ней пропадали название, описание и имя врача.
  it("removes only the link-invitation sentence and keeps hospital descriptions and doctors", () => {
    const out = prepareSource([
      "We recommend the following Hospitals and Doctors:",
      "1. Sample Hospital is a 600-bed hospital in Faridabad, Haryana. It has 40 operation theatres. Click on the link: https://example.org/a",
      "Dr. Anna Example will be the treating doctor. Kindly find her profile via link - https://example.org/dr-a",
      "2. Placeholder Centre offers surgical care in 15 specialties. To know more about the Hospital, kindly click on the link - https://example.org/b",
      "Dr. (Maj Gen) Ravi Demo will be the treating doctor. To know more click on the link- https://example.org/dr-b",
      "Kindly have a visual tour of the hospital via link - https://pin.it/abc123",
    ].join("\n"));
    expect(out).toContain("1. Sample Hospital is a 600-bed hospital in Faridabad, Haryana. It has 40 operation theatres.");
    expect(out).toContain("Dr. Anna Example will be the treating doctor.");
    expect(out).toContain("2. Placeholder Centre offers surgical care in 15 specialties.");
    expect(out).toContain("Dr. (Maj Gen) Ravi Demo will be the treating doctor.");
    expect(out).not.toMatch(/click on|via link|visual tour|profile via|To know more/i);
    expect(out.split("\n")).toHaveLength(5); // строка, целиком состоявшая из рекламы, исчезла
  });

  it("dropTourSentences leaves ordinary lines alone", () => {
    expect(dropTourSentences("Dr. Meera Sample will be the treating doctor.")).toBe("Dr. Meera Sample will be the treating doctor.");
    expect(dropTourSentences("Click on the link:")).toBe("");
  });

  it("limits the raw length and rejects an almost empty letter", () => {
    expect(() => prepareSource("x".repeat(40001))).toThrow(expect.objectContaining({ code: "too-long" }));
    expect(() => prepareSource("hi")).toThrow(expect.objectContaining({ code: "empty" }));
    expect(prepareSource("a\r\n\r\n\r\n\r\nb".padEnd(40, "."))).toMatch(/^a\n\nb/);
  });
});

// Review Focus №1: деньги не принимаются за телефон
describe("findContacts", () => {
  it.each(["USD 10000-12000", "$12,000-$15,000", "USD 2500 - 3000", "40000-50000", "7 600 – 9 000", "Total 52 years, 14 mm"])(
    "%s is not a contact", (text) => expect(findContacts(text)).toEqual([])
  );
  it.each(["+91 98765 43210", "+91-124-4141414", "(+91) 11 4545 7777", "Mobile: 98765 43210", "Tel 0124 4141414", "9876543210", "http://a.org/x", "www.example.org", "me@example.org"])(
    "%s is a contact", (text) => expect(findContacts(text).length).toBeGreaterThan(0)
  );
  it("stripContacts leaves the price range of a letter intact", () => {
    expect(stripContacts("Cost USD 10000-12000, call +91 98765 43210")).toBe("Cost USD 10000-12000, call");
  });
});

describe("htmlToPlainText", () => {
  it("turns table rows into pipes, list items into dashes and decodes entities", () => {
    expect(htmlToPlainText("<p>Cost:</p><table><tr><td><p><strong>Hospital</strong></p></td><td><p>City</p></td><td><p>USD 6800</p></td></tr></table><ul><li>One</li><li>Two &amp; three</li></ul>"))
      .toBe("Cost:\nHospital | City | USD 6800\n- One\n- Two & three");
  });
});

describe("docxToText", () => {
  it("reads paragraphs and table rows from a real .docx", async () => {
    const text = await docxToText(await makeDocx({
      paragraphs: ["Findings: test", "Estimated cost:"],
      table: [["Hospital", "City", "Cost"], ["Example Hospital A", "Faridabad", "USD 6800"]],
    }));
    expect(text).toContain("Findings: test");
    expect(text).toContain("Example Hospital A | Faridabad | USD 6800");
  });

  // Review Focus №3
  it("rejects a non-zip, an oversized file and a zip bomb without calling mammoth", async () => {
    const spy = jest.spyOn(mammoth, "convertToHtml");
    await expect(docxToText(Buffer.from("not a zip at all"))).rejects.toMatchObject({ code: "bad-docx" });
    await expect(docxToText(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: "docx-too-big" });
    const zip = new JSZip();
    zip.file("word/document.xml", Buffer.alloc(25 * 1024 * 1024));
    const bomb = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await expect(docxToText(bomb)).rejects.toMatchObject({ code: "docx-unsafe" });
    expect(spy).not.toHaveBeenCalled();
  });
});

it("sha256Hex is stable", () => {
  expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

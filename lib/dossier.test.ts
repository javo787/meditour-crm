import { buildDocumentsContext, prepareDossier } from "@/lib/dossier";
import { buildDossierPdf } from "@/lib/dossier-pdf";
import type { PatientDocument } from "@/lib/types";

function doc(over: Partial<PatientDocument>): PatientDocument {
  return {
    id: Math.random().toString(36).slice(2),
    leadId: "lead1",
    filename: "f.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1000,
    source: "upload",
    at: "2026-10-01T10:00:00Z",
    status: "done",
    attempts: 1,
    category: "report",
    title: "Report",
    translationEn: "Some translated text",
    reviewed: true,
    include: true,
    ...over,
  };
}

describe("prepareDossier", () => {
  it("orders reports by date and keeps only included, finished ones", () => {
    const data = prepareDossier([
      doc({ title: "Later", docDate: "05 Sep 2026" }),
      doc({ title: "Earlier", docDate: "01 Jan 2026" }),
      doc({ title: "Excluded", include: false }),
      doc({ title: "Selfie", category: "other", include: true }),
      doc({ title: "Failed", status: "failed" }),
      doc({ title: "MRI images", category: "imaging", translationEn: "" }),
    ]);
    expect(data.sections.map((s) => s.title)).toEqual(["Earlier", "Later"]);
    expect(data.sections.map((s) => s.number)).toEqual([1, 2]);
    expect(data.imaging.map((i) => i.title)).toEqual(["MRI images"]);
  });

  it("counts unreviewed and in-progress documents", () => {
    const data = prepareDossier([
      doc({ reviewed: false }),
      doc({ reviewed: true }),
      doc({ status: "pending", include: false }),
      doc({ status: "processing", include: false }),
    ]);
    expect(data.unreviewed).toBe(1);
    expect(data.inProgress).toBe(2);
  });
});

describe("buildDocumentsContext", () => {
  it("is empty when there is nothing translated", () => {
    expect(buildDocumentsContext([doc({ status: "pending" })])).toBe("");
  });

  it("lists translations and imaging as text", () => {
    const ctx = buildDocumentsContext([
      doc({ title: "MRI hips – report", docDate: "12 Mar 2026", translationEn: "Signs of osteonecrosis." }),
      doc({ title: "MRI – hip joints (images)", category: "imaging", translationEn: "" }),
    ]);
    expect(ctx).toContain("Document 1: MRI hips – report (12 Mar 2026)");
    expect(ctx).toContain("Signs of osteonecrosis.");
    expect(ctx).toContain("- MRI – hip joints (images)");
  });
});

describe("buildDossierPdf", () => {
  it("produces a real, small PDF with a page per document", async () => {
    const data = prepareDossier([
      doc({ title: "MRI of the hip joints – report", docDate: "12 Mar 2026", sourceLanguage: "ru", translationEn: "Findings: µ ≥ 5 mg/dL\n\nSecond paragraph.", uncertain: ["x"] }),
      doc({ title: "Blood test", docDate: "14 Mar 2026", translationEn: "ESR: 15 mm/h (2–15)" }),
      doc({ title: "MRI – hip joints (images)", category: "imaging", translationEn: "" }),
    ]);
    const pdf = await buildDossierPdf({ name: "Rakhimov Izatullo", gender: "Male", dateOfBirth: "19 Apr 1988" }, data, new Date("2026-10-13T00:00:00Z"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    expect(pdf.length).toBeLessThan(500_000);
  });
});

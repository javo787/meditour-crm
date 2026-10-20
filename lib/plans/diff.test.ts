import { countChangedFields } from "./diff";
import { fictionalContent } from "./test-fixtures";

// Глубокая копия через JSON: план состоит только из строк, чисел, массивов и объектов.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("countChangedFields", () => {
  it("returns 0 for identical content", () => {
    const aiDraft = fictionalContent();
    expect(countChangedFields(aiDraft, clone(aiDraft))).toBe(0);
  });

  it("counts one edited leaf as one change", () => {
    const aiDraft = fictionalContent();
    const content = clone(aiDraft);
    content.patient.name = "Другой Пациент";
    expect(countChangedFields(aiDraft, content)).toBe(1);
  });

  it("counts an added array element as one change", () => {
    const aiDraft = fictionalContent();
    const content = clone(aiDraft);
    content.overview.push("Новый пункт обзора");
    expect(countChangedFields(aiDraft, content)).toBe(1);
  });

  it("counts two removed array elements as two changes", () => {
    const aiDraft = fictionalContent();
    const content = clone(aiDraft);
    expect(aiDraft.overview.length).toBe(3);
    content.overview = content.overview.slice(0, 1);
    expect(countChangedFields(aiDraft, content)).toBe(2);
  });

  it("returns 0 when there is no model draft to compare with", () => {
    expect(countChangedFields(undefined, fictionalContent())).toBe(0);
  });
});

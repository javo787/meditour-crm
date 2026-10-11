import { applyTeamPatch, isUnassigned, normalizeName, UNASSIGNED } from "./team";

const empty = { members: [], defaultAssignee: null };

describe("normalizeName / isUnassigned", () => {
  it("чистит пробелы и режет длину", () => {
    expect(normalizeName("  Анвар   Рахимов ")).toBe("Анвар Рахимов");
    expect(normalizeName("а".repeat(100))).toHaveLength(60);
  });
  it("распознаёт «не назначен»", () => {
    expect(isUnassigned(UNASSIGNED)).toBe(true);
    expect(isUnassigned("не назначен")).toBe(true);
    expect(isUnassigned("")).toBe(true);
    expect(isUnassigned(undefined)).toBe(true);
    expect(isUnassigned("Анвар")).toBe(false);
  });
});

describe("applyTeamPatch", () => {
  it("добавляет участника без дублей (регистр не важен)", () => {
    let t = applyTeamPatch(empty, { addMember: "Анвар" });
    t = applyTeamPatch(t, { addMember: " анвар " });
    expect(t.members).toEqual(["Анвар"]);
  });

  it("не добавляет «Не назначен» как человека", () => {
    expect(applyTeamPatch(empty, { addMember: UNASSIGNED }).members).toEqual([]);
  });

  it("ответственный по умолчанию автоматически попадает в команду", () => {
    const t = applyTeamPatch(empty, { defaultAssignee: "Джавохир" });
    expect(t).toEqual({ members: ["Джавохир"], defaultAssignee: "Джавохир" });
  });

  it("берёт существующее написание имени", () => {
    const t = applyTeamPatch(
      { members: ["Джавохир"], defaultAssignee: null },
      { defaultAssignee: "джавохир" }
    );
    expect(t.defaultAssignee).toBe("Джавохир");
    expect(t.members).toEqual(["Джавохир"]);
  });

  it("null и «Не назначен» сбрасывают значение по умолчанию", () => {
    const base = { members: ["А"], defaultAssignee: "А" };
    expect(applyTeamPatch(base, { defaultAssignee: null }).defaultAssignee).toBeNull();
    expect(applyTeamPatch(base, { defaultAssignee: UNASSIGNED }).defaultAssignee).toBeNull();
  });

  it("удаление участника сбрасывает его же как ответственного по умолчанию", () => {
    const t = applyTeamPatch(
      { members: ["А", "Б"], defaultAssignee: "А" },
      { removeMember: "а" }
    );
    expect(t).toEqual({ members: ["Б"], defaultAssignee: null });
  });

  it("удаление другого участника не трогает значение по умолчанию", () => {
    const t = applyTeamPatch(
      { members: ["А", "Б"], defaultAssignee: "А" },
      { removeMember: "Б" }
    );
    expect(t).toEqual({ members: ["А"], defaultAssignee: "А" });
  });
});

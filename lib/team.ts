/**
 * Команда координаторов и ответственный «по умолчанию».
 * Чистая логика без БД — чтобы её можно было тестировать и использовать и на
 * сервере, и в браузере.
 */

export const UNASSIGNED = "Не назначен";
export const MAX_NAME_LENGTH = 60;

export interface TeamSettings {
  /** Люди, которых можно назначить ответственным (порядок добавления). */
  members: string[];
  /** Кто автоматически становится ответственным у новых лидов. */
  defaultAssignee: string | null;
}

export interface TeamPatch {
  addMember?: string;
  removeMember?: string;
  /** null — «по умолчанию никого». */
  defaultAssignee?: string | null;
}

/** Убирает лишние пробелы и ограничивает длину. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

export function isUnassigned(name: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return n === "" || n === UNASSIGNED.toLowerCase();
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Возвращает уже существующее написание имени (без дублей «Анвар»/«анвар»). */
function resolveMember(members: string[], name: string): string {
  return members.find((m) => sameName(m, name)) ?? name;
}

function addUnique(members: string[], raw: string): string[] {
  const name = normalizeName(raw);
  if (!name || isUnassigned(name)) return members;
  if (members.some((m) => sameName(m, name))) return members;
  return [...members, name];
}

export function applyTeamPatch(current: TeamSettings, patch: TeamPatch): TeamSettings {
  let members = [...current.members];
  let def = current.defaultAssignee;

  if (patch.addMember) members = addUnique(members, patch.addMember);

  if (patch.removeMember) {
    const target = normalizeName(patch.removeMember);
    members = members.filter((m) => !sameName(m, target));
    if (def && sameName(def, target)) def = null;
  }

  if (patch.defaultAssignee !== undefined) {
    const name = patch.defaultAssignee === null ? "" : normalizeName(patch.defaultAssignee);
    if (!name || isUnassigned(name)) {
      def = null;
    } else {
      members = addUnique(members, name);
      def = resolveMember(members, name);
    }
  }

  return { members, defaultAssignee: def };
}

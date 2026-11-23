// The user's list of weigh-in conditions: name rules, the options a form shows, and reordering. Pure code.

import { WEIGHT_CONDITIONS } from "../day/entries.ts";

export const MAX_CONDITIONS = 15;
export const MAX_CONDITION_LENGTH = 40;
/** The weigh-in select's value for "add a new condition". */
export const NEW_CONDITION_OPTION = "__new__";

export type ConditionRow = { id: string; name: string; position: number; hidden: boolean };

export const DEFAULT_CONDITIONS: readonly string[] = WEIGHT_CONDITIONS;

/** Spaces trimmed and collapsed. */
export function normalizeConditionName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Error text for a new or renamed condition, or null when it is fine. */
export function conditionNameError(raw: string, existing: ConditionRow[], renamingId: string | null = null): string | null {
  const name = normalizeConditionName(raw);
  if (name === "") return "יש לכתוב שם";
  if (name.length > MAX_CONDITION_LENGTH) return `עד ${MAX_CONDITION_LENGTH} תווים`;
  if (name === NEW_CONDITION_OPTION) return "שם לא תקין";
  const taken = existing.some((row) => row.id !== renamingId && row.name === name);
  if (taken) return "כבר יש תנאי בשם הזה";
  if (renamingId === null && existing.length >= MAX_CONDITIONS) return `אפשר עד ${MAX_CONDITIONS} תנאים. אפשר להסתיר תנאי שלא בשימוש`;
  return null;
}

/**
 * The options of the weigh-in form: the visible conditions in order, plus the weigh-in's own condition
 * when it is hidden or no longer on the list, so editing an old weigh-in never loses it.
 */
export function conditionOptions(rows: ConditionRow[], current: string): string[] {
  const visible = [...rows].sort((a, b) => a.position - b.position).filter((row) => !row.hidden).map((row) => row.name);
  if (current !== "" && !visible.includes(current)) visible.push(current);
  return visible;
}

/** New positions after moving one row up (-1) or down (+1). Only rows whose position changes are returned. */
export function moveCondition(rows: ConditionRow[], id: string, direction: -1 | 1): { id: string; position: number }[] {
  const ordered = [...rows].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((row) => row.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return [];
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered
    .map((row, position) => ({ id: row.id, position, changed: row.position !== position }))
    .filter((row) => row.changed)
    .map(({ id: rowId, position }) => ({ id: rowId, position }));
}

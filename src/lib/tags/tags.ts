// Personal day tags: name rules and what the home screen shows for a day. Pure code.

import { normalizeConditionName } from "../conditions/conditions.ts";

export const MAX_TAGS = 15;
export const MAX_TAG_LENGTH = 30;
export const MAX_NOTE_LENGTH = 100;

export const DEFAULT_TAGS: readonly string[] = ["אירוע", "ארוחה בחוץ", "חופשה", "שינה גרועה", "יום לחוץ", "חולה"];

export type TagRow = { id: string; name: string; position: number; hidden: boolean };
export type TagMark = { tagId: string; note: string | null };

export const normalizeTagName = normalizeConditionName;

export function tagNameError(raw: string, existing: TagRow[], renamingId: string | null = null): string | null {
  const name = normalizeTagName(raw);
  if (name === "") return "יש לכתוב שם";
  if (name.length > MAX_TAG_LENGTH) return `עד ${MAX_TAG_LENGTH} תווים`;
  if (existing.some((row) => row.id !== renamingId && row.name === name)) return "כבר יש תגית בשם הזה";
  if (renamingId === null && existing.length >= MAX_TAGS) return `אפשר עד ${MAX_TAGS} תגיות. אפשר להסתיר תגית שלא בשימוש`;
  return null;
}

/**
 * The chips for a day: visible tags in order, plus any hidden tag that is marked on that day,
 * so a mark can always be seen and removed.
 */
export function chipsForDay(tags: TagRow[], marks: TagMark[]): { tag: TagRow; mark: TagMark | null }[] {
  const marked = new Map(marks.map((mark) => [mark.tagId, mark]));
  return [...tags]
    .sort((a, b) => a.position - b.position)
    .filter((tag) => !tag.hidden || marked.has(tag.id))
    .map((tag) => ({ tag, mark: marked.get(tag.id) ?? null }));
}

/** A note as stored: trimmed, at most 100 characters, null when empty. */
export function cleanNote(raw: string): string | null {
  const note = raw.trim().replace(/\s+/g, " ");
  return note === "" ? null : note.slice(0, MAX_NOTE_LENGTH);
}

// Loading and changing the user's day tags and the marks on days.

import { getSupabase } from "@/lib/supabase/client";
import { localDayKey } from "@/lib/day/dates";
import { DEFAULT_TAGS, normalizeTagName, type TagMark, type TagRow } from "@/lib/tags/tags";

const COLUMNS = "id, name, position, hidden";

async function select(userId: string): Promise<TagRow[]> {
  const { data, error } = await getSupabase()
    .from("day_tags")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TagRow[];
}

/** The user's tags in order. The first time, the defaults are written so they can be edited too. */
export async function loadTags(userId: string): Promise<TagRow[]> {
  const rows = await select(userId);
  if (rows.length > 0) return rows;
  const { error } = await getSupabase()
    .from("day_tags")
    .upsert(DEFAULT_TAGS.map((name, position) => ({ user_id: userId, name, position })), {
      onConflict: "user_id,name",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(error.message);
  return select(userId);
}

export async function addTag(userId: string, rawName: string, position: number): Promise<TagRow> {
  const { data, error } = await getSupabase()
    .from("day_tags")
    .insert({ user_id: userId, name: normalizeTagName(rawName), position })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as TagRow;
}

/** Marks keep pointing at the tag, so a rename needs no change to past days. */
export async function renameTag(userId: string, row: TagRow, rawName: string): Promise<string> {
  const name = normalizeTagName(rawName);
  const { error } = await getSupabase().from("day_tags").update({ name }).eq("id", row.id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return name;
}

export async function setTagHidden(userId: string, id: string, hidden: boolean): Promise<void> {
  const { error } = await getSupabase().from("day_tags").update({ hidden }).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function saveTagOrder(userId: string, updates: { id: string; position: number }[]): Promise<void> {
  for (const update of updates) {
    const { error } = await getSupabase()
      .from("day_tags")
      .update({ position: update.position })
      .eq("id", update.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }
}

// ------------------------------------------------------------------ marks on days

export async function loadDayMarks(userId: string, day: Date): Promise<TagMark[]> {
  const { data, error } = await getSupabase()
    .from("day_tag_marks")
    .select("tag_id, note")
    .eq("user_id", userId)
    .eq("day", localDayKey(day));
  if (error) throw new Error(error.message);
  return ((data ?? []) as { tag_id: string; note: string | null }[]).map((row) => ({ tagId: row.tag_id, note: row.note }));
}

export async function setDayMark(userId: string, tagId: string, day: Date, marked: boolean): Promise<void> {
  const supabase = getSupabase();
  const key = localDayKey(day);
  const { error } = marked
    ? await supabase
        .from("day_tag_marks")
        .upsert({ user_id: userId, tag_id: tagId, day: key }, { onConflict: "user_id,tag_id,day", ignoreDuplicates: true })
    : await supabase.from("day_tag_marks").delete().eq("user_id", userId).eq("tag_id", tagId).eq("day", key);
  if (error) throw new Error(error.message);
}

export async function setDayMarkNote(userId: string, tagId: string, day: Date, note: string | null): Promise<void> {
  const { error } = await getSupabase()
    .from("day_tag_marks")
    .update({ note })
    .eq("user_id", userId)
    .eq("tag_id", tagId)
    .eq("day", localDayKey(day));
  if (error) throw new Error(error.message);
}

/** Tag names marked on each day of a range, keyed yyyy-mm-dd. */
export async function loadMarksInRange(userId: string, from: Date, to: Date): Promise<Map<string, string[]>> {
  const { data, error } = await getSupabase()
    .from("day_tag_marks")
    .select("day, day_tags(name)")
    .eq("user_id", userId)
    .gte("day", localDayKey(from))
    .lte("day", localDayKey(to))
    .limit(3000);
  if (error) throw new Error(error.message);
  const byDay = new Map<string, string[]>();
  for (const row of (data ?? []) as unknown as { day: string; day_tags: { name: string } | { name: string }[] | null }[]) {
    const tag = Array.isArray(row.day_tags) ? row.day_tags[0] : row.day_tags;
    if (!tag) continue;
    const list = byDay.get(row.day) ?? [];
    list.push(tag.name);
    byDay.set(row.day, list);
  }
  return byDay;
}

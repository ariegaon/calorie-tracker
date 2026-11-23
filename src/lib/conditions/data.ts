// Loading and changing the user's weigh-in conditions.

import { getSupabase } from "@/lib/supabase/client";
import { DEFAULT_CONDITIONS, normalizeConditionName, type ConditionRow } from "@/lib/conditions/conditions";

const COLUMNS = "id, name, position, hidden";

async function select(userId: string): Promise<ConditionRow[]> {
  const { data, error } = await getSupabase()
    .from("weigh_in_conditions")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ConditionRow[];
}

/** The user's conditions, in order. The first time, the defaults are written so they can be edited too. */
export async function loadConditions(userId: string): Promise<ConditionRow[]> {
  const rows = await select(userId);
  if (rows.length > 0) return rows;
  const { error } = await getSupabase()
    .from("weigh_in_conditions")
    .upsert(
      DEFAULT_CONDITIONS.map((name, position) => ({ user_id: userId, name, position })),
      { onConflict: "user_id,name", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
  return select(userId);
}

export async function addCondition(userId: string, rawName: string, position: number): Promise<ConditionRow> {
  const { data, error } = await getSupabase()
    .from("weigh_in_conditions")
    .insert({ user_id: userId, name: normalizeConditionName(rawName), position })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as ConditionRow;
}

/** Renames a condition, and the past weigh-ins that used it, so trends per condition stay together. */
export async function renameCondition(userId: string, row: ConditionRow, rawName: string): Promise<string> {
  const name = normalizeConditionName(rawName);
  const supabase = getSupabase();
  const { error } = await supabase.from("weigh_in_conditions").update({ name }).eq("id", row.id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  const { error: logsError } = await supabase
    .from("weight_logs")
    .update({ measurement_conditions: name })
    .eq("user_id", userId)
    .eq("measurement_conditions", row.name);
  if (logsError) throw new Error(logsError.message);
  return name;
}

export async function setConditionHidden(userId: string, id: string, hidden: boolean): Promise<void> {
  const { error } = await getSupabase().from("weigh_in_conditions").update({ hidden }).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function saveConditionOrder(userId: string, updates: { id: string; position: number }[]): Promise<void> {
  const supabase = getSupabase();
  for (const update of updates) {
    const { error } = await supabase
      .from("weigh_in_conditions")
      .update({ position: update.position })
      .eq("id", update.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }
}

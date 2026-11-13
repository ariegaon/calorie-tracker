// Runs a sync: reads workouts from Health Connect and stores the new ones in Supabase.

import { getSupabase } from "@/lib/supabase/client";
import { readWorkouts } from "@/lib/health/native";
import { planSync, type ExistingActivity } from "@/lib/health/sync";

/** Health Connect serves about the last 30 days without the separate history permission. */
const LOOKBACK_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export type SyncResult = { inserted: number; manualDuplicates: number; alreadySynced: number };

export async function runHealthSync(userId: string): Promise<SyncResult> {
  const supabase = getSupabase();
  const since = new Date(Date.now() - LOOKBACK_DAYS * MS_PER_DAY);
  const workouts = await readWorkouts(since);

  const existing = await supabase
    .from("activities")
    .select("id, started_at, duration_seconds, external_provider, external_activity_id, excluded_from_balance")
    .eq("user_id", userId)
    .gte("started_at", new Date(since.getTime() - MS_PER_DAY).toISOString())
    .limit(3000);
  if (existing.error) throw new Error(existing.error.message);

  const plan = planSync(workouts, (existing.data ?? []) as unknown as ExistingActivity[]);

  if (plan.toInsert.length > 0) {
    // "ignoreDuplicates" keeps a row that is already there untouched, including the user's edits to it.
    const inserted = await supabase
      .from("activities")
      .upsert(
        plan.toInsert.map((row) => ({ user_id: userId, ...row })),
        { onConflict: "user_id,external_provider,external_activity_id", ignoreDuplicates: true },
      );
    if (inserted.error) throw new Error(inserted.error.message);
  }

  if (plan.manualDuplicateIds.length > 0) {
    const updated = await supabase
      .from("activities")
      .update({ excluded_from_balance: true })
      .in("id", plan.manualDuplicateIds);
    if (updated.error) throw new Error(updated.error.message);
  }

  return {
    inserted: plan.toInsert.length,
    manualDuplicates: plan.manualDuplicateIds.length,
    alreadySynced: plan.alreadySynced,
  };
}

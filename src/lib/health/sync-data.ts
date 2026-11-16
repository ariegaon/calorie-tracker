// Runs a sync: reads workouts from Health Connect, stores the new ones in Supabase,
// and repairs rows that an earlier sync stored without a believable energy figure.

import { getSupabase } from "@/lib/supabase/client";
import { canReadCalories, readSessionEnergy, readWorkouts } from "@/lib/health/native";
import {
  isPlausibleEnergy,
  needsEnergy,
  planNewActivities,
  repairFor,
  workoutToActivity,
  type ExistingActivity,
  type HealthWorkout,
  type SessionEnergy,
  type StoredSyncedActivity,
} from "@/lib/health/sync";

/** Health Connect serves about the last 30 days without the separate history permission. */
const LOOKBACK_DAYS = 30;
const MS_PER_DAY = 86_400_000;
/** Most workouts whose calorie records are read in one sync, to keep a first sync quick. */
const MAX_ENERGY_READS = 60;

export type SyncResult = {
  inserted: number;
  /** New workouts that count toward the balance. The rest arrived as copies of a workout that already counts. */
  counted: number;
  /** Activities already in the diary that stopped counting because a better source of the same workout arrived. */
  replaced: number;
  /** Rows from earlier syncs whose calories, type or source were corrected. */
  repaired: number;
  alreadySynced: number;
  /** Records Health Connect returned for the period, and how many of them were usable. */
  read: number;
  usable: number;
  sampleFields: string[];
  lookbackDays: number;
  /** False when the calorie permission is missing, so workout energy could not be read properly. */
  caloriesReadable: boolean;
};

type StoredRow = ExistingActivity & StoredSyncedActivity;

export async function runHealthSync(userId: string, genericLabel: string | null): Promise<SyncResult> {
  const supabase = getSupabase();
  const since = new Date(Date.now() - LOOKBACK_DAYS * MS_PER_DAY);
  const { workouts, rawCount, sampleFields } = await readWorkouts(since);

  const existing = await supabase
    .from("activities")
    .select(
      "id, started_at, duration_seconds, distance_m, activity_type, external_provider, external_activity_id, " +
        "source_app, calories_active_kcal, calories_total_kcal, excluded_from_balance",
    )
    .eq("user_id", userId)
    .gte("started_at", new Date(since.getTime() - MS_PER_DAY).toISOString())
    .limit(3000);
  if (existing.error) throw new Error(existing.error.message);
  const rows = (existing.data ?? []) as unknown as StoredRow[];
  const storedById = new Map<string, StoredRow>();
  for (const row of rows) {
    if (row.external_provider === "health_connect" && row.external_activity_id) storedById.set(row.external_activity_id, row);
  }

  // Calorie records are read for new workouts and for stored ones that still lack a believable figure.
  const caloriesReadable = await canReadCalories().catch(() => false);
  const energyById = new Map<string, SessionEnergy>();
  const wantsEnergy = (workout: HealthWorkout): boolean => {
    const stored = storedById.get(workout.platformId);
    return stored ? needsEnergy(stored) : true;
  };
  for (const workout of workouts.filter(wantsEnergy).slice(-MAX_ENERGY_READS)) {
    energyById.set(workout.platformId, await readSessionEnergy(workout));
  }

  const fresh = workouts.map((workout) =>
    workoutToActivity(workout, { genericLabel, energy: energyById.get(workout.platformId) ?? null }),
  );
  const plan = planNewActivities(fresh, rows);

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

  if (plan.excludeIds.length > 0) {
    const updated = await supabase.from("activities").update({ excluded_from_balance: true }).in("id", plan.excludeIds);
    if (updated.error) throw new Error(updated.error.message);
  }

  let repaired = 0;
  for (const candidate of fresh) {
    const stored = storedById.get(candidate.external_activity_id);
    if (!stored) continue;
    const changes = repairFor(stored, candidate);
    if (!changes) continue;
    const updated = await supabase.from("activities").update(changes).eq("id", stored.id);
    if (updated.error) throw new Error(updated.error.message);
    // A source-only correction is bookkeeping; the user is told only about visible changes.
    if (Object.keys(changes).some((key) => key !== "source_app")) repaired += 1;
  }

  const stillMissing = fresh.some(
    (row) =>
      row.calories_active_kcal === null &&
      !isPlausibleEnergy(row.calories_total_kcal, row.duration_seconds) &&
      !storedById.has(row.external_activity_id),
  );

  return {
    inserted: plan.toInsert.length,
    counted: plan.toInsert.filter((row) => !row.excluded_from_balance).length,
    replaced: plan.excludeIds.length,
    repaired,
    alreadySynced: plan.alreadySynced,
    read: rawCount,
    usable: workouts.length,
    sampleFields,
    lookbackDays: LOOKBACK_DAYS,
    caloriesReadable: caloriesReadable || !stillMissing,
  };
}

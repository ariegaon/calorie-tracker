// Loads what the weight screen needs: every weigh-in, and a calorie balance for each recent day.

import { getSupabase } from "@/lib/supabase/client";
import type { WeightRow } from "@/lib/day/entries";
import { summarizeDay } from "@/lib/day/summary";
import { loadRangeDays } from "@/lib/reports/data";
import { dayIndex, type DayBalance } from "@/lib/weight/trend";

/** Days of entries loaded for balances: covers the 28-day window and a full month to date. */
export const BALANCE_HISTORY_DAYS = 35;

export async function loadWeights(userId: string): Promise<WeightRow[]> {
  const { data, error } = await getSupabase()
    .from("weight_logs")
    .select("id, measured_at, weight_kg, measurement_conditions, source, notes")
    .eq("user_id", userId)
    .order("measured_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as WeightRow[];
}

/**
 * A calorie balance for each of the last days, ending today.
 * One expenditure estimate (from the current weight) is used for all days: a stated simplification.
 */
export async function loadDayBalances(
  userId: string,
  today: Date,
  energy: { bmr: number; baselineKcal: number },
): Promise<DayBalance[]> {
  const todayIndex = dayIndex(today);
  const days = await loadRangeDays(userId, todayIndex - BALANCE_HISTORY_DAYS + 1, todayIndex);
  return days.map(({ day, data }) => {
    if (!data) return { day, balanceKcal: 0, documented: false };
    const summary = summarizeDay(data, energy);
    return { day, balanceKcal: summary.balance?.balanceKcal ?? 0, documented: summary.hasFood };
  });
}

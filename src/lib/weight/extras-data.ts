// Calibration history, forecast snapshots and body measurements in Supabase.

import { getSupabase } from "@/lib/supabase/client";
import type { BodyMeasurementRow, BodyMeasurementValues } from "@/lib/day/entries";
import type { Forecast } from "@/lib/weight/trend";

export const FORECAST_MODEL_VERSION = "v1-trend60-calories40";

function fail(message: string): never {
  throw new Error(message);
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// ------------------------------------------------------------------ calibration

export type CalibrationRow = {
  id: string;
  effective_at: string;
  adjustment_kcal: number;
  previous_adjustment_kcal: number;
  gap_kcal_per_day: number | null;
  explanation: string;
};

/** Calibration decisions, newest first. The first one is the adjustment in force. */
export async function loadCalibrations(userId: string): Promise<CalibrationRow[]> {
  const { data, error } = await getSupabase()
    .from("metabolic_calibration")
    .select("id, effective_at, adjustment_kcal, previous_adjustment_kcal, gap_kcal_per_day, explanation")
    .eq("user_id", userId)
    .order("effective_at", { ascending: false })
    .limit(20);
  if (error) fail(error.message);
  return (data ?? []) as unknown as CalibrationRow[];
}

/** The expenditure adjustment in force, in kcal a day. Zero when none was ever confirmed. */
export async function loadCalibrationAdjustment(userId: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from("metabolic_calibration")
    .select("adjustment_kcal")
    .eq("user_id", userId)
    .order("effective_at", { ascending: false })
    .limit(1);
  if (error) fail(error.message);
  const rows = (data ?? []) as unknown as { adjustment_kcal: number }[];
  return rows.length > 0 ? Number(rows[0].adjustment_kcal) : 0;
}

export async function saveCalibration(
  userId: string,
  input: {
    adjustmentKcal: number;
    previousAdjustmentKcal: number;
    gapKcalPerDay: number | null;
    weighDays: number | null;
    documentedDays: number | null;
    explanation: string;
  },
): Promise<void> {
  const { error } = await getSupabase().from("metabolic_calibration").insert({
    user_id: userId,
    adjustment_kcal: input.adjustmentKcal,
    previous_adjustment_kcal: input.previousAdjustmentKcal,
    gap_kcal_per_day: input.gapKcalPerDay,
    weigh_days: input.weighDays,
    documented_days: input.documentedDays,
    explanation: input.explanation,
  });
  if (error) fail(error.message);
}

// ------------------------------------------------------------------ forecast snapshots

export type PredictionRow = {
  prediction_date: string;
  target_date: string;
  theoretical_weight_kg: number | null;
  trend_weight_kg: number | null;
  combined_weight_kg: number | null;
  lower_bound_kg: number | null;
  upper_bound_kg: number | null;
};

/** Stores today's forecast for a target date (one row per day and target; later saves that day replace it). */
export async function savePredictionSnapshot(userId: string, today: Date, target: Date, forecast: Forecast): Promise<void> {
  const best = forecast.combined ?? forecast.trend ?? forecast.theoretical;
  if (!best) return;
  const { error } = await getSupabase()
    .from("weight_predictions")
    .upsert(
      {
        user_id: userId,
        prediction_date: isoDate(today),
        target_date: isoDate(target),
        theoretical_weight_kg: forecast.theoretical?.weightKg ?? null,
        trend_weight_kg: forecast.trend?.weightKg ?? null,
        combined_weight_kg: forecast.combined?.weightKg ?? null,
        lower_bound_kg: best.lowKg,
        upper_bound_kg: best.highKg,
        model_version: FORECAST_MODEL_VERSION,
      },
      { onConflict: "user_id,prediction_date,target_date" },
    );
  if (error) fail(error.message);
}

/** The earliest forecast that was made for a target date: what was expected at the start. */
export async function loadEarliestPrediction(userId: string, target: Date): Promise<PredictionRow | null> {
  const { data, error } = await getSupabase()
    .from("weight_predictions")
    .select("prediction_date, target_date, theoretical_weight_kg, trend_weight_kg, combined_weight_kg, lower_bound_kg, upper_bound_kg")
    .eq("user_id", userId)
    .eq("target_date", isoDate(target))
    .order("prediction_date", { ascending: true })
    .limit(1);
  if (error) fail(error.message);
  const rows = (data ?? []) as unknown as PredictionRow[];
  return rows[0] ?? null;
}

// ------------------------------------------------------------------ body measurements

export async function loadBodyMeasurements(userId: string): Promise<BodyMeasurementRow[]> {
  const { data, error } = await getSupabase()
    .from("body_measurements")
    .select("id, measured_at, waist_cm, chest_cm, hips_cm, thigh_cm, arm_cm, body_fat_percent, notes")
    .eq("user_id", userId)
    .order("measured_at", { ascending: true })
    .limit(1000);
  if (error) fail(error.message);
  return (data ?? []) as unknown as BodyMeasurementRow[];
}

export async function saveBodyMeasurement(
  userId: string,
  values: BodyMeasurementValues,
  existingId: string | null,
): Promise<void> {
  const supabase = getSupabase();
  const columns = {
    measured_at: values.measuredAt,
    waist_cm: values.waist,
    chest_cm: values.chest,
    hips_cm: values.hips,
    thigh_cm: values.thigh,
    arm_cm: values.arm,
    body_fat_percent: values.bodyFat,
    notes: values.notes,
  };
  const { error } = existingId
    ? await supabase.from("body_measurements").update(columns).eq("id", existingId)
    : await supabase.from("body_measurements").insert({ user_id: userId, ...columns });
  if (error) fail(error.message);
}

export async function deleteBodyMeasurement(id: string): Promise<void> {
  const { error } = await getSupabase().from("body_measurements").delete().eq("id", id);
  if (error) fail(error.message);
}

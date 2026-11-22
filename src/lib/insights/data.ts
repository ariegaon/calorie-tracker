// Loading, saving and generating insights in the app. The analyses run here on the user's own data
// (read through row level security); only the resulting findings go to the server's AI editor.

import { getSupabase } from "@/lib/supabase/client";
import { loadProfile } from "@/lib/profile";
import { profileEnergy } from "@/lib/energy-profile";
import { loadCalibrationAdjustment } from "@/lib/weight/extras-data";
import { loadRangeDays } from "@/lib/reports/data";
import { dayIndex } from "@/lib/weight/trend";
import { buildDataset } from "@/lib/insights/dataset";
import { runAnalyses, type InsightKind } from "@/lib/insights/analyses";
import { chooseCandidates, isInsightDue, type PastInsight } from "@/lib/insights/editor";
import { INSIGHT_WINDOW_DAYS, MIN_LOGGED_DAYS } from "@/lib/insights/readiness";

export type InsightRow = {
  id: string;
  created_at: string;
  kind: InsightKind;
  title: string;
  body: string;
  action: string | null;
  source: "ai" | "template";
  seen_at: string | null;
  feedback: "useful" | "not_relevant" | null;
};

const COLUMNS = "id, created_at, kind, title, body, action, source, seen_at, feedback";

export async function loadInsights(userId: string, limit = 30): Promise<InsightRow[]> {
  const { data, error } = await getSupabase()
    .from("insights")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as InsightRow[];
}

/** The newest insight the user has not opened yet, for the line on the home screen. */
export async function loadUnseenInsight(userId: string): Promise<InsightRow | null> {
  const { data, error } = await getSupabase()
    .from("insights")
    .select(COLUMNS)
    .eq("user_id", userId)
    .is("seen_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as InsightRow[])[0] ?? null;
}

export async function markInsightsSeen(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabase()
    .from("insights")
    .update({ seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw new Error(error.message);
}

export async function setInsightFeedback(id: string, feedback: "useful" | "not_relevant" | null): Promise<void> {
  const { error } = await getSupabase()
    .from("insights")
    .update({ feedback, feedback_at: feedback ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------ weekly generation

const ATTEMPT_KEY = "insights:last-attempt";
/** After an attempt that found nothing worth showing, wait this long before analysing again. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

function recentlyAttempted(userId: string): boolean {
  try {
    const raw = window.localStorage.getItem(`${ATTEMPT_KEY}:${userId}`);
    return raw !== null && Date.now() - Number(raw) < RETRY_AFTER_MS;
  } catch {
    return false;
  }
}

function markAttempt(userId: string) {
  try {
    window.localStorage.setItem(`${ATTEMPT_KEY}:${userId}`, String(Date.now()));
  } catch {
    // ignore
  }
}

export type GenerationResult = "created" | "not_due" | "not_enough_data" | "nothing_found" | "failed";

let running: Promise<GenerationResult> | null = null;

/**
 * Creates this week's insight when one is due: analyses the last 60 days, drops kinds the user did not
 * want or saw recently, and asks the server's editor to choose and word one. Safe to call often.
 */
export function maybeGenerateWeeklyInsight(userId: string, options: { force?: boolean } = {}): Promise<GenerationResult> {
  if (running) return running;
  running = generate(userId, options.force === true).finally(() => {
    running = null;
  });
  return running;
}

async function generate(userId: string, force: boolean): Promise<GenerationResult> {
  if (!force && recentlyAttempted(userId)) return "not_due";
  try {
    const history = await loadInsights(userId, 40);
    if (!isInsightDue(history[0]?.created_at ?? null, new Date())) return "not_due";

    const now = new Date();
    const [profile, adjustment] = await Promise.all([loadProfile(userId), loadCalibrationAdjustment(userId)]);
    if (!profile) return "not_enough_data";
    const today = dayIndex(now);
    const range = await loadRangeDays(userId, today - INSIGHT_WINDOW_DAYS + 1, today);

    const lastWeight = [...range]
      .reverse()
      .flatMap(({ data }) => data?.weights ?? [])
      .map((row) => Number(row.weight_kg))
      .find((kg) => Number.isFinite(kg));
    const weightKg = lastWeight ?? (profile.start_weight_kg === null ? null : Number(profile.start_weight_kg));
    const energy = profileEnergy(profile, weightKg ?? null, now, adjustment);
    if (!energy) return "not_enough_data";

    const dataset = buildDataset({
      range,
      energy: { bmr: energy.bmr, baselineKcal: energy.baseline },
      snackAllowanceKcal: profile.snack_allowance_kcal === null ? null : Number(profile.snack_allowance_kcal),
      plan: {
        targetKcal: energy.target.targetKcal,
        plannedWeeklyKg: energy.weeklyGoalKg,
        targetWeightKg: profile.target_weight_kg === null ? null : Number(profile.target_weight_kg),
        targetDate: profile.target_date,
        baselineKcal: energy.baseline,
      },
    });
    if (dataset.days.filter((day) => day.logged).length < MIN_LOGGED_DAYS) {
      markAttempt(userId);
      return "not_enough_data";
    }

    const past: PastInsight[] = history.map((row) => ({ kind: row.kind, createdAt: row.created_at, feedback: row.feedback }));
    const candidates = chooseCandidates(runAnalyses(dataset), past, now);
    markAttempt(userId);
    if (candidates.length === 0) return "nothing_found";

    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return "failed";
    const response = await fetch("/api/insights/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        candidates,
        sex: profile.sex_for_bmr,
        likedKinds: [...new Set(past.filter((item) => item.feedback === "useful").map((item) => item.kind))],
      }),
    });
    if (response.status === 409) return "not_due";
    return response.ok ? "created" : "failed";
  } catch {
    return "failed";
  }
}

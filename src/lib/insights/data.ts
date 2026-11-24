// Loading, saving and generating insights in the app. The analyses run here on the user's own data
// (read through row level security); only the resulting findings go to the server's AI editor.

import { getSupabase } from "@/lib/supabase/client";
import { loadProfile, type ProfileRow } from "@/lib/profile";
import { profileEnergy } from "@/lib/energy-profile";
import { loadBodyMeasurements, loadCalibrationAdjustment } from "@/lib/weight/extras-data";
import { loadRangeDays, type RangeDay } from "@/lib/reports/data";
import { dateOfDay, dayIndex } from "@/lib/weight/trend";
import { loadMarksInRange } from "@/lib/tags/data";
import { buildDataset, type InsightDataset } from "@/lib/insights/dataset";
import { buildQuestionContext } from "@/lib/insights/context";
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

// ------------------------------------------------------------------ the data the analyses work on

type AnalysisInputs = {
  profile: ProfileRow;
  range: RangeDay[];
  dataset: InsightDataset;
  bmr: number;
};

async function loadAnalysisInputs(userId: string, now: Date): Promise<AnalysisInputs | null> {
  const [profile, adjustment] = await Promise.all([loadProfile(userId), loadCalibrationAdjustment(userId)]);
  if (!profile) return null;
  const today = dayIndex(now);
  const firstDay = today - INSIGHT_WINDOW_DAYS + 1;
  const [range, marks, measurements] = await Promise.all([
    loadRangeDays(userId, firstDay, today),
    loadMarksInRange(userId, dateOfDay(firstDay), dateOfDay(today)).catch(() => new Map<string, string[]>()),
    loadBodyMeasurements(userId).catch(() => []),
  ]);
  // Day tags arrive keyed yyyy-mm-dd; the analyses use day numbers.
  const tagsByDay = new Map<number, string[]>();
  for (const [key, names] of marks) {
    const [year, month, date] = key.split("-").map(Number);
    tagsByDay.set(dayIndex(new Date(year, month - 1, date)), names);
  }

  const lastWeight = [...range]
    .reverse()
    .flatMap(({ data }) => [...(data?.weights ?? [])].reverse())
    .map((row) => Number(row.weight_kg))
    .find((kg) => Number.isFinite(kg));
  const weightKg = lastWeight ?? (profile.start_weight_kg === null ? null : Number(profile.start_weight_kg));
  const energy = profileEnergy(profile, weightKg ?? null, now, adjustment);
  if (!energy) return null;

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
    tagsByDay,
    measurements: measurements.map((row) => ({
      day: dayIndex(new Date(row.measured_at)),
      waistCm: row.waist_cm === null ? null : Number(row.waist_cm),
      bodyFatPercent: row.body_fat_percent === null ? null : Number(row.body_fat_percent),
    })),
  });
  return { profile, range, dataset, bmr: energy.bmr };
}

// ------------------------------------------------------------------ free questions

export type QuestionRow = { id: string; created_at: string; question: string; answer: string };

export async function loadQuestions(userId: string, limit = 30): Promise<QuestionRow[]> {
  const { data, error } = await getSupabase()
    .from("insight_questions")
    .select("id, created_at, question, answer")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as QuestionRow[]).reverse();
}

export async function clearQuestions(userId: string): Promise<void> {
  const { error } = await getSupabase().from("insight_questions").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** Sends the question with a summary of the last 60 days. Throws with a message for the user. */
export async function askQuestion(
  userId: string,
  question: string,
  history: { question: string; answer: string }[],
  insightId: string | null,
): Promise<string> {
  const inputs = await loadAnalysisInputs(userId, new Date());
  if (!inputs) throw new Error("חסרים פרטים בפרופיל (מין, תאריך לידה, גובה ומשקל) כדי לנתח את הנתונים.");
  const context = buildQuestionContext({
    range: inputs.range,
    dataset: inputs.dataset,
    findings: runAnalyses(inputs.dataset),
    bmr: inputs.bmr,
    snackAllowanceKcal: inputs.profile.snack_allowance_kcal === null ? null : Number(inputs.profile.snack_allowance_kcal),
    sex: inputs.profile.sex_for_bmr,
  });

  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("ההתחברות פגה. התחבר מחדש ונסה שוב.");
  const response = await fetch("/api/insights/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question, context, history: history.slice(-4), insightId }),
  });
  const body = (await response.json().catch(() => null)) as { answer?: unknown; error?: unknown } | null;
  if (!response.ok || typeof body?.answer !== "string") {
    throw new Error(typeof body?.error === "string" ? body.error : "לא התקבלה תשובה. נסה שוב.");
  }
  return body.answer;
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
    const inputs = await loadAnalysisInputs(userId, now);
    if (!inputs) return "not_enough_data";
    const { profile, dataset } = inputs;
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
        useAi: profile.ai_insights_consent_at !== null,
      }),
    });
    if (response.status === 409) return "not_due";
    return response.ok ? "created" : "failed";
  } catch {
    return "failed";
  }
}

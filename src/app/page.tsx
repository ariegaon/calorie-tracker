"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { loadProfile, type ProfileRow } from "@/lib/profile";
import { profileEnergy, type ProfileEnergy } from "@/lib/energy-profile";
import { macroStatus, type MacroTarget } from "@/lib/calculations/macros";
import { buildExplainInput } from "@/lib/explain-input";
import { CalculationExplainer } from "@/components/CalculationExplainer";
import { latestWaistMeasurementAt, loadCalibrationAdjustment } from "@/lib/weight/extras-data";
import { addDays, defaultEntryTime, formatDayLabel, formatTime, isSameDay, startOfDay } from "@/lib/day/dates";
import { loadDay, saveDrink, setSnackSkipped, type LoadedDay } from "@/lib/day/data";
import { remainingToday, snackAllowanceForDay } from "@/lib/calculations/goal";
import { buildTimeline, summarizeDay, type TimelineEvent, type TimelineKind } from "@/lib/day/summary";
import { activityIcon, type ActivityRow, type DrinkRow, type FoodRow, type WeightRow } from "@/lib/day/entries";
import { Card, FullPageMessage, Notice } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { FoodForm } from "@/components/forms/FoodForm";
import { DrinkForm } from "@/components/forms/DrinkForm";
import { ActivityForm } from "@/components/forms/ActivityForm";
import { WeightForm } from "@/components/forms/WeightForm";
import { MealForm } from "@/components/forms/MealForm";
import { AnalyzeMeal } from "@/components/forms/AnalyzeMeal";
import { BottomNav } from "@/components/BottomNav";
import { HealthSyncCard } from "@/components/HealthSyncCard";
import { HomeNotice, type NoticeItem } from "@/components/HomeNotice";
import { DayTagsRow } from "@/components/DayTagsRow";
import { loadUnseenInsight, maybeGenerateWeeklyInsight, type InsightRow } from "@/lib/insights/data";
import { favoriteCalories, type Favorite } from "@/lib/favorites";
import { deleteFavorite, loadFavorites, logFavorite } from "@/lib/favorites-data";
import { buildInsights } from "@/lib/reports/report";

type SheetState =
  | { kind: "ai" }
  | { kind: "meal"; existing: FoodRow }
  | { kind: "food"; existing: FoodRow | null }
  | { kind: "drink"; existing: DrinkRow | null }
  | { kind: "activity"; existing: ActivityRow | null }
  | { kind: "weight"; existing: WeightRow | null };

const KIND_ICON: Record<TimelineKind, string> = { food: "🍽", drink: "🥤", activity: "🏃", weight: "⚖" };
const KIND_LABEL: Record<TimelineKind, string> = { food: "מזון", drink: "משקה", activity: "פעילות", weight: "שקילה" };

function sheetTitle(sheet: SheetState): string {
  switch (sheet.kind) {
    case "ai":
      return "ניתוח ארוחה ב-AI";
    case "meal":
      return "עריכת ארוחה";
    case "food":
      return "הוספת מזון ידנית";
    case "drink":
      return sheet.existing ? "עריכת משקה" : "הוספת משקה";
    case "activity":
      return sheet.existing ? "עריכת פעילות" : "הוספת פעילות";
    case "weight":
      return sheet.existing ? "עריכת שקילה" : "הזנת משקל";
  }
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("he-IL");
}

function shortDate(iso: string): string {
  const [year, month, dayOfMonth] = iso.split("-");
  return `${Number(dayOfMonth)}.${Number(month)}.${year.slice(2)}`;
}

/** One line about the target date, when the pace comes from one. */
function describeGoal(
  pace: ProfileEnergy["goalPace"],
  targetWeightKg: number | null,
  targetDate: string | null,
): { text: string; warn: boolean } | null {
  if (!pace || targetWeightKg === null || !targetDate) return null;
  const kg = (value: number) => Math.abs(value).toFixed(2);
  const goal = `${Number(targetWeightKg)} ק"ג עד ${shortDate(targetDate)}`;
  if (pace.status === "reached") return { text: `הגעת למשקל היעד. היעד היומי הוא עכשיו שמירה על המשקל.`, warn: false };
  if (pace.status === "ok") {
    return { text: `בדרך ל-${goal}: ${pace.weeklyKg < 0 ? "ירידה" : "עלייה"} של ${kg(pace.weeklyKg)} ק"ג בשבוע.`, warn: false };
  }
  return {
    text:
      `היעד ${goal} דורש ${kg(pace.requestedWeeklyKg)} ק"ג בשבוע, יותר מהקצב הבטוח. ` +
      `היעד היומי מחושב לפי ${kg(pace.weeklyKg)} ק"ג בשבוע, ובקצב הזה תגיע ליעד בערך ב-${shortDate(pace.realisticDate)}.`,
    warn: true,
  };
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className={"text-sm " + (strong ? "font-semibold text-slate-900" : "text-slate-600")}>{label}</dt>
      <dd className={"tabular-nums " + (strong ? "font-bold" : "font-medium")}>{value}</dd>
    </div>
  );
}

function ProgressBar({ label, value, goal, unit }: { label: string; value: number; goal: number | null; unit: string }) {
  const percent = goal && goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-sm tabular-nums text-slate-900">
          <span className="font-bold">{formatNumber(value)}</span>
          {goal ? ` מתוך ${formatNumber(goal)}` : ""} {unit}
          {percent !== null && percent >= 100 ? " ✓" : ""}
        </span>
      </div>
      {percent !== null ? (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2.5 overflow-hidden rounded-full bg-slate-200"
        >
          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** One of three equal tiles: a daily goal shows "out of" and a bar; a recommended range shows its ends. */
function MacroTile({ label, grams, target }: { label: string; grams: number; target: MacroTarget | null }) {
  const status = target ? macroStatus(target, grams) : null;
  const top = target ? (target.kind === "goal" ? target.grams : target.max) : 0;
  const percent = target && top > 0 ? Math.min(100, Math.round((grams / top) * 100)) : null;
  const barColor = status === "above" ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div className="flex flex-col justify-between gap-1 rounded-xl bg-slate-100 px-2 py-2">
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className="whitespace-nowrap text-sm font-bold tabular-nums">
        {formatNumber(grams)} גרם{status === "within" ? " ✓" : ""}
      </dd>
      {target && percent !== null ? (
        <dd className="space-y-1">
          <span
            className={
              "block whitespace-nowrap tabular-nums " +
              (target.kind === "range" ? "text-[11px] " : "text-xs ") +
              (status === "above" ? "text-amber-700" : "text-slate-600")
            }
          >
            {target.kind === "goal" ? (
              `מתוך ${formatNumber(target.grams)}`
            ) : status === "above" ? (
              `מעל ${formatNumber(target.max)}`
            ) : (
              <>
                טווח{" "}
                <span dir="ltr">
                  {formatNumber(target.min)}–{formatNumber(target.max)}
                </span>
              </>
            )}
          </span>
          <span
            role="progressbar"
            aria-label={`${label} ביחס ליעד`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="block h-1.5 overflow-hidden rounded-full bg-slate-200"
          >
            <span className={"block h-full rounded-full " + barColor} style={{ width: `${percent}%` }} />
          </span>
        </dd>
      ) : null}
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-100 active:bg-slate-200"
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        {icon}
      </span>
      {label}
    </button>
  );
}

function TimelineItem({ event, onOpen }: { event: TimelineEvent; onOpen: () => void }) {
  let kcalText: ReactNode = null;
  if (event.kcal !== null && event.reportedKcal != null) {
    // The watch's own figure first, so it matches what the user sees there; the counted part below it.
    kcalText = (
      <span className="shrink-0 text-end">
        <span className="block text-sm font-semibold tabular-nums text-sky-700">
          נשרפו {formatNumber(event.reportedKcal)} קק"ל
        </span>
        <span className="block text-xs tabular-nums text-slate-500">(במאזן: {formatNumber(Math.abs(event.kcal))})</span>
      </span>
    );
  } else if (event.kcal !== null) {
    const burned = event.kind === "activity";
    kcalText = (
      <span className={"shrink-0 text-sm font-semibold tabular-nums " + (burned ? "text-sky-700" : "text-slate-900")}>
        {burned ? "נשרפו " : ""}
        {formatNumber(Math.abs(event.kcal))} קק"ל
      </span>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${KIND_LABEL[event.kind]}: ${event.title}, עריכה`}
        className="flex w-full items-center gap-3 py-3 text-start hover:bg-slate-50"
      >
        <span className="w-11 shrink-0 text-sm tabular-nums text-slate-500">{formatTime(event.at)}</span>
        <span aria-hidden="true" className="shrink-0 text-xl">
          {event.kind === "activity" ? activityIcon(event.title) : KIND_ICON[event.kind]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{event.title}</span>
          {event.detail ? <span className="block text-xs text-slate-500">{event.detail}</span> : null}
        </span>
        {kcalText}
      </button>
    </li>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { session, loading: authLoading, error: authError } = useAuth();
  const userId = session?.user.id ?? null;

  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [adjustment, setAdjustment] = useState(0);
  const [data, setData] = useState<LoadedDay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [snackBusy, setSnackBusy] = useState(false);
  const [newInsight, setNewInsight] = useState<InsightRow | null>(null);
  const [lastWaistAt, setLastWaistAt] = useState<string | null>(null);

  // People who already measure their waist get a weekly reminder: it is the second signal beside the scale.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    latestWaistMeasurementAt(userId)
      .then((at) => {
        if (!cancelled) setLastWaistAt(at);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // This week's insight is prepared in the background; a new one shows as the line under the headline.
  useEffect(() => {
    if (!userId) return;
    const id = userId;
    let cancelled = false;
    loadUnseenInsight(id)
      .then((row) => {
        if (!cancelled) setNewInsight(row);
        return maybeGenerateWeeklyInsight(id);
      })
      .then((result) => (result === "created" ? loadUnseenInsight(id) : undefined))
      .then((row) => {
        if (!cancelled && row) setNewInsight(row);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [addingWater, setAddingWater] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoriteBusy, setFavoriteBusy] = useState<string | null>(null);
  const [editingFavorites, setEditingFavorites] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Profile: loaded once per user.
  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    Promise.all([loadProfile(userId), loadCalibrationAdjustment(userId)])
      .then(([row, calibration]) => {
        if (cancelled) return;
        if (!row?.onboarding_completed_at) {
          router.replace("/profile");
          return;
        }
        setAdjustment(calibration);
        setProfile(row);
      })
      .catch(() => {
        if (!cancelled) setLoadError("לא הצלחנו לטעון את הפרופיל. בדוק את החיבור ונסה לרענן.");
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, router]);

  // Day entries: reloaded when the day changes or after a save.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setRefreshing(true);
    loadDay(userId, day)
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setLoadError(null);
        setRefreshing(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("לא הצלחנו לטעון את נתוני היום. בדוק את החיבור ונסה שוב.");
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, day, reloadKey]);

  // Favorites: reloaded after every save, because forms can add new ones.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadFavorites(userId)
      .then((loaded) => {
        if (!cancelled) setFavorites(loaded);
      })
      .catch(() => {
        // The diary works without favorites; the card simply stays empty.
      });
    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const onHealthSynced = useCallback(() => setReloadKey((key) => key + 1), []);
  const onSaved = useCallback(() => {
    setSheet(null);
    // Whatever was just saved or deleted makes an earlier "added" message out of date.
    setActionNotice(null);
    setReloadKey((key) => key + 1);
  }, []);

  // The "added" message is a brief confirmation: it goes away by itself, and when the day changes.
  useEffect(() => {
    if (actionNotice === null) return;
    const timer = setTimeout(() => setActionNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [actionNotice]);
  useEffect(() => {
    setActionNotice(null);
    setActionError(null);
  }, [day]);

  if (authError) return <Notice kind="error">{authError}</Notice>;
  if (authLoading || !userId) return <FullPageMessage>טוען…</FullPageMessage>;
  if (!profile || !data) {
    return loadError ? <Notice kind="error">{loadError}</Notice> : <FullPageMessage>טוען…</FullPageMessage>;
  }

  const currentUserId: string = userId;
  const currentData: LoadedDay = data;
  const today = new Date();
  const isToday = isSameDay(day, today);
  const weightKg =
    currentData.latestWeightKg ?? (profile.start_weight_kg === null ? null : Number(profile.start_weight_kg));
  const energy = profileEnergy(profile, weightKg, today, adjustment);
  const snackAllowance = profile.snack_allowance_kcal === null ? 0 : Number(profile.snack_allowance_kcal);
  const summary = summarizeDay(
    currentData,
    energy ? { bmr: energy.bmr, baselineKcal: energy.baseline } : null,
    snackAllowance,
  );
  // "Left to eat" reserves the snack allowance from the start of the day, before anything is logged.
  const snackReserve = snackAllowanceForDay(snackAllowance, currentData.snackSkipped === true);
  const eatenKcal = summary.foodKcal + summary.drinkKcal + snackReserve;
  const remaining = energy ? remainingToday(energy.target.targetKcal, eatenKcal, summary.activity.activeKcal) : null;
  const goalLine = energy ? describeGoal(energy.goalPace, profile.target_weight_kg, profile.target_date) : null;
  const timeline = buildTimeline(currentData, energy?.bmr ?? null);
  const balance = summary.balance;

  async function addWaterGlass() {
    setAddingWater(true);
    setActionError(null);
    try {
      await saveDrink(
        currentUserId,
        {
          drinkType: "מים",
          consumedAt: defaultEntryTime(day, new Date()).toISOString(),
          volumeMl: 250,
          caloriesKcal: 0,
          caffeineMg: null,
          hydrationMl: 250,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
          notes: null,
        },
        null,
      );
      setReloadKey((key) => key + 1);
    } catch {
      setActionError("הוספת המים נכשלה. בדוק את החיבור ונסה שוב.");
    } finally {
      setAddingWater(false);
    }
  }

  async function toggleSnackSkip() {
    setSnackBusy(true);
    setActionError(null);
    try {
      await setSnackSkipped(currentUserId, day, currentData.snackSkipped !== true);
      setReloadKey((key) => key + 1);
    } catch {
      setActionError("השמירה נכשלה. בדוק את החיבור ונסה שוב.");
    } finally {
      setSnackBusy(false);
    }
  }

  async function addFavoriteToDay(favorite: Favorite) {
    setFavoriteBusy(favorite.id);
    setActionError(null);
    setActionNotice(null);
    try {
      await logFavorite(currentUserId, favorite, defaultEntryTime(day, new Date()).toISOString());
      setActionNotice(`נוסף: ${favorite.name}`);
      setReloadKey((key) => key + 1);
    } catch {
      setActionError("ההוספה נכשלה. בדוק את החיבור ונסה שוב.");
    } finally {
      setFavoriteBusy(null);
    }
  }

  async function removeFavorite(favorite: Favorite) {
    setFavoriteBusy(favorite.id);
    setActionError(null);
    try {
      await deleteFavorite(favorite.id);
      setFavorites((current) => current.filter((item) => item.id !== favorite.id));
    } catch {
      setActionError("ההסרה נכשלה. נסה שוב.");
    } finally {
      setFavoriteBusy(null);
    }
  }

  const insights = isToday
    ? buildInsights({
        now: today,
        lastWeighInAt: currentData.latestWeighInAt,
        previousDayHasFood: currentData.previousDayHasFood,
        hasFoodToday: summary.hasFood,
        hydrationMl: summary.hydrationMl,
        waterGoalMl: Number(profile.daily_water_goal_ml),
        proteinG: summary.proteinG,
        proteinGoalG: energy?.macros.protein.grams ?? null,
      })
    : [];

  const NOTICE_ICONS: Record<string, string> = { weigh_in: "⚖", yesterday_food: "🍽", hydration: "💧", protein: "🥩" };
  const noticeItems: NoticeItem[] = [
    ...(newInsight
      ? [{ key: `insight:${newInsight.id}`, icon: "💡", text: `תובנה חדשה: ${newInsight.title}`, href: "/insights" }]
      : []),
    ...(lastWaistAt && Date.now() - new Date(lastWaistAt).getTime() > 7 * 86_400_000
      ? [
          {
            key: "waist",
            icon: "📏",
            text: "כדאי למדוד היקף מותניים השבוע. כך יודעים אם יורד שומן גם כשהמשקל עומד.",
            href: "/weight",
          },
        ]
      : []),
    ...insights.map((insight) => ({
      key: insight.key,
      icon: NOTICE_ICONS[insight.key] ?? "•",
      text: insight.text,
    })),
  ];

  function openEvent(event: TimelineEvent) {
    if (event.kind === "food") {
      const existing = currentData.foods.find((row) => row.id === event.id);
      if (existing) setSheet({ kind: "meal", existing });
    } else if (event.kind === "drink") {
      const existing = currentData.drinks.find((row) => row.id === event.id);
      if (existing) setSheet({ kind: "drink", existing });
    } else if (event.kind === "activity") {
      const existing = currentData.activities.find((row) => row.id === event.id);
      if (existing) setSheet({ kind: "activity", existing });
    } else {
      const existing = currentData.weights.find((row) => row.id === event.id);
      if (existing) setSheet({ kind: "weight", existing });
    }
  }

  let balanceHeadline = "";
  let balanceIcon = "";
  if (balance) {
    if (balance.status === "deficit") {
      balanceHeadline = `גירעון של ${formatNumber(Math.abs(balance.balanceKcal))} קק"ל`;
      balanceIcon = "▼";
    } else if (balance.status === "surplus") {
      balanceHeadline = `עודף של ${formatNumber(balance.balanceKcal)} קק"ל`;
      balanceIcon = "▲";
    } else {
      balanceHeadline = "איזון משוער";
      balanceIcon = "≈";
    }
  }

  return (
    <main className="space-y-4 pb-20">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">שלום{profile.display_name ? `, ${profile.display_name}` : ""}</h1>
        <Link
          href="/profile"
          className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          פרופיל ויעדים
        </Link>
      </header>

      <nav aria-label="בחירת יום" className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setDay((current) => addDays(current, -1))}
          aria-label="היום הקודם"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        >
          <span aria-hidden="true">▶</span>
        </button>
        <div className="text-center">
          <div className="font-semibold">{formatDayLabel(day, today)}</div>
          {!isToday ? (
            <button
              type="button"
              onClick={() => setDay(startOfDay(new Date()))}
              className="text-sm font-medium text-emerald-700 underline"
            >
              חזרה להיום
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setDay((current) => addDays(current, 1))}
          disabled={isToday}
          aria-label="היום הבא"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        >
          <span aria-hidden="true">◀</span>
        </button>
      </nav>

      {loadError ? <Notice kind="error">{loadError}</Notice> : null}
      {actionError ? <Notice kind="error">{actionError}</Notice> : null}
      {actionNotice ? <Notice kind="success">{actionNotice}</Notice> : null}

      <div className={"space-y-4 transition-opacity " + (refreshing ? "opacity-60" : "")} aria-busy={refreshing}>
        <Card>
          {energy && remaining ? (
            <>
              <h2 className="text-sm font-semibold text-slate-600">
                {isToday ? "נשאר לאכול היום" : "נשאר לאכול ביום הזה"} (הערכה)
              </h2>
              <p className={"mt-1 text-4xl font-bold " + (remaining.remainingKcal < 0 ? "text-red-600" : "text-emerald-700")}>
                {remaining.remainingKcal < 0
                  ? `חרגת ב-${formatNumber(-remaining.remainingKcal)}`
                  : formatNumber(remaining.remainingKcal)}{" "}
                <span className="text-lg font-semibold">קק"ל</span>
              </p>
              <div
                className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={Math.round(remaining.budgetKcal)}
                aria-valuenow={Math.round(eatenKcal)}
                aria-label="נאכל מתוך היעד"
              >
                <div
                  className={"h-full rounded-full " + (remaining.remainingKcal < 0 ? "bg-red-500" : "bg-emerald-500")}
                  style={{ width: `${Math.min(100, (eatenKcal / Math.max(1, remaining.budgetKcal)) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                נאכלו {formatNumber(eatenKcal)} מתוך {formatNumber(remaining.budgetKcal)} קק"ל
                {remaining.workoutKcal > 0
                  ? ` (יעד ${formatNumber(energy.target.targetKcal)} + ${formatNumber(remaining.workoutKcal)} מאימונים)`
                  : ""}
              </p>
              {snackAllowance > 0 ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                  <span>
                    {snackReserve > 0
                      ? `כולל ${formatNumber(snackReserve)} קק"ל לנשנושים שלא נרשמו (הערכה)`
                      : "בלי תוספת נשנושים היום"}
                  </span>
                  <button
                    type="button"
                    disabled={snackBusy}
                    onClick={() => void toggleSnackSkip()}
                    className="font-medium text-emerald-700 underline disabled:opacity-50"
                  >
                    {snackReserve > 0 ? "היום רשמתי הכול" : "החזרת התוספת"}
                  </button>
                </div>
              ) : null}
              {goalLine ? (
                <p className={"mt-2 text-sm " + (goalLine.warn ? "font-medium text-amber-700" : "text-slate-600")}>
                  {goalLine.text}
                </p>
              ) : null}
              {energy.target.limitedByMinimum ? (
                <p className="mt-2 text-sm text-slate-600">
                  היעד הועלה לרצפה הבטוחה של {formatNumber(energy.target.targetKcal)} קק"ל ביום, ולכן הירידה תהיה איטית
                  מהמתוכנן.
                </p>
              ) : null}
              {weightKg !== null ? (
                <CalculationExplainer
                  className="mt-2"
                  input={buildExplainInput(
                    profile,
                    energy,
                    weightKg,
                    currentData.latestWeightKg !== null ? "weigh_in" : "profile",
                    today,
                    {
                      isToday,
                      foodKcal: summary.foodKcal,
                      drinkKcal: summary.drinkKcal,
                      snackKcal: snackReserve,
                      workoutKcal: remaining.workoutKcal,
                    },
                  )}
                />
              ) : null}

              <details className="mt-3 border-t border-slate-100 pt-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-600">
                  פירוט המאזן: {balance ? `${balanceIcon} ${balanceHeadline}` : ""}
                </summary>
                {balance ? (
                  <>
                    {!summary.hasFood ? (
                      <div className="mt-2">
                        <Notice kind="info">עוד לא הוזן מזון ביום הזה, ולכן המאזן עדיין לא משקף את היום.</Notice>
                      </div>
                    ) : null}
                    <dl className="mt-2 divide-y divide-slate-100">
                      <Row label="נצרך ממזון" value={`${formatNumber(summary.foodKcal)} קק"ל`} />
                      <Row label="נצרך ממשקאות" value={`${formatNumber(summary.drinkKcal)} קק"ל`} />
                      {summary.snackKcal > 0 ? (
                        <Row label="נשנושים שלא נרשמו (הערכה)" value={`${formatNumber(summary.snackKcal)} קק"ל`} />
                      ) : null}
                      <Row label="סך הכול נצרך" value={`${formatNumber(balance.consumedKcal)} קק"ל`} strong />
                      <Row label="הוצאה בסיסית, בלי אימונים" value={`${formatNumber(energy.baseline)} קק"ל`} />
                      <Row label="אימונים (קלוריות פעילות)" value={`${formatNumber(summary.activity.activeKcal)} קק"ל`} />
                      <Row label="סך הכול הוצאה" value={`${formatNumber(balance.burnedKcal)} קק"ל`} strong />
                      <Row
                        label={energy.goalPace ? "יעד צריכה ביום בלי אימון (לפי תאריך היעד)" : "יעד צריכה ביום בלי אימון"}
                        value={`${formatNumber(energy.target.targetKcal)} קק"ל`}
                      />
                    </dl>
                    {summary.activity.notSeparable > 0 ? (
                      <div className="mt-2">
                        <Notice kind="info">
                          {summary.activity.notSeparable === 1
                            ? "פעילות אחת לא נספרה במאזן"
                            : `${summary.activity.notSeparable} פעילויות לא נספרו במאזן`}
                          . יש להן רק קלוריות כוללות בלי משך, ואי אפשר להפריד מהן את חלק המנוחה.
                        </Notice>
                      </div>
                    ) : null}
                    <p className="mt-3 text-xs leading-relaxed text-slate-500">
                      המאזן הוא מה שנאכל פחות מה שנשרף. היעד היומי הוא ההוצאה הבסיסית פחות הגירעון שמתאים לקצב שבחרת.
                      ההוצאה הבסיסית מחושבת בנוסחת Mifflin-St Jeor לפי משקל של {weightKg} ק"ג, כפול רמת הפעילות
                      היומיומית שבחרת
                      {energy.adjustmentKcal !== 0
                        ? `, ובתוספת הכיול האישי שאישרת (${energy.adjustmentKcal > 0 ? "+" : "−"}${Math.abs(energy.adjustmentKcal)} קק"ל ליום)`
                        : ""}
                      . קלוריות האימונים מתווספות למה שנשאר לאכול. המספרים הם הערכה ולא מדידה.
                    </p>
                  </>
                ) : null}
              </details>
            </>
          ) : (
            <Notice kind="info">כדי לחשב כמה נשאר לאכול חסרים פרטים בפרופיל: מין, תאריך לידה, גובה ומשקל.</Notice>
          )}
        </Card>

        <HomeNotice items={noticeItems} />

        <button
          type="button"
          onClick={() => setSheet({ kind: "ai" })}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-base font-bold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800"
        >
          <span aria-hidden="true" className="text-2xl leading-none">
            📷
          </span>
          צילום או תיאור ארוחה
        </button>

        <div className="grid grid-cols-4 gap-2">
          <ActionButton icon="🍽" label="מזון ידני" onClick={() => setSheet({ kind: "food", existing: null })} />
          <ActionButton icon="🥤" label="משקה" onClick={() => setSheet({ kind: "drink", existing: null })} />
          <ActionButton icon="🏃" label="פעילות" onClick={() => setSheet({ kind: "activity", existing: null })} />
          <ActionButton icon="⚖" label="משקל" onClick={() => setSheet({ kind: "weight", existing: null })} />
        </div>

        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">⭐ מועדפים</h2>
            {favorites.length > 0 ? (
              <button
                type="button"
                onClick={() => setEditingFavorites((value) => !value)}
                className="min-h-9 rounded-lg px-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                {editingFavorites ? "סיום" : "עריכה"}
              </button>
            ) : null}
          </div>
          {favorites.length === 0 ? (
            <p className="text-sm text-slate-600">
              עוד אין מועדפים. בטופס של ארוחה או משקה אפשר לסמן "לשמור גם כמועדף", ואז להוסיף אותם מכאן בלחיצה אחת.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {favorites.map((favorite) => (
                <li key={favorite.id} className="flex items-center">
                  <button
                    type="button"
                    disabled={favoriteBusy !== null || editingFavorites}
                    onClick={() => addFavoriteToDay(favorite)}
                    className={
                      "min-h-11 border border-slate-300 bg-white px-3 text-start text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-70 " +
                      (editingFavorites ? "rounded-s-full" : "rounded-full")
                    }
                  >
                    {favoriteBusy === favorite.id ? "רגע… " : ""}
                    {favorite.name}
                    <span className="text-slate-500"> · {Math.round(favoriteCalories(favorite))} קק"ל</span>
                  </button>
                  {editingFavorites ? (
                    <button
                      type="button"
                      disabled={favoriteBusy !== null}
                      onClick={() => removeFavorite(favorite)}
                      aria-label={`הסרת ${favorite.name} מהמועדפים`}
                      className="flex min-h-11 w-11 items-center justify-center rounded-e-full border border-s-0 border-red-300 bg-red-50 text-lg text-red-700 hover:bg-red-100"
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {favorites.length > 0 && !editingFavorites ? (
            <p className="text-xs text-slate-500">לחיצה מוסיפה ליום שמוצג, בשעה הנוכחית. אפשר לערוך אחר כך מציר הזמן.</p>
          ) : null}
        </Card>

        <DayTagsRow userId={currentUserId} day={day} />

        <HealthSyncCard userId={currentUserId} onSynced={onHealthSynced} />


        <Card>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <MacroTile label="חלבון" grams={summary.proteinG} target={energy?.macros.protein ?? null} />
            <MacroTile label="פחמימות" grams={summary.carbsG} target={energy?.macros.carbs ?? null} />
            <MacroTile label="שומן" grams={summary.fatG} target={energy?.macros.fat ?? null} />
          </dl>
        </Card>

        <Card className="space-y-3">
          <ProgressBar label="שתייה" value={summary.hydrationMl} goal={Number(profile.daily_water_goal_ml)} unit={'מ"ל'} />
          {summary.caffeineMg > 0 ? (
            <p className="text-xs text-slate-500">קפאין היום: כ-{formatNumber(summary.caffeineMg)} מ"ג (הערכה)</p>
          ) : null}
          <button
            type="button"
            onClick={addWaterGlass}
            disabled={addingWater}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-sky-300 bg-sky-50 px-4 font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-60"
          >
            {addingWater ? "מוסיף…" : '+ כוס מים (250 מ"ל)'}
          </button>
        </Card>

        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold">משקל אחרון</h2>
            <span className="font-bold tabular-nums">{weightKg === null ? "לא הוזן" : `${weightKg} ק"ג`}</span>
          </div>
          <Link href="/weight" className="mt-2 inline-block text-sm font-semibold text-emerald-700 underline">
            גרף, מגמה ותחזית
          </Link>
        </Card>

        <Card>
          <h2 className="font-semibold">היום שלך</h2>
          {timeline.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              עוד אין רשומות ביום הזה. אפשר להוסיף מזון, משקה, פעילות או שקילה בכפתורים שלמעלה.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {timeline.map((event) => (
                <TimelineItem key={event.key} event={event} onOpen={() => openEvent(event)} />
              ))}
            </ul>
          )}
          {timeline.some((event) => event.reportedKcal != null) ? (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              באימון מהשעון מוצג המספר כפי שהוא בשעון. בסוגריים: מה שנספר במאזן, אחרי הפחתת הקלוריות שהגוף שורף במנוחה באותו
              זמן, כי הן כבר כלולות בהוצאה הבסיסית של היום.
            </p>
          ) : null}
        </Card>
      </div>

      {sheet ? (
        <Sheet title={sheetTitle(sheet)} onClose={closeSheet}>
          {sheet.kind === "ai" ? (
            <AnalyzeMeal userId={currentUserId} day={day} onDone={onSaved} />
          ) : sheet.kind === "meal" ? (
            <MealForm userId={currentUserId} day={day} existing={sheet.existing} draft={null} onDone={onSaved} />
          ) : sheet.kind === "food" ? (
            <FoodForm userId={currentUserId} day={day} existing={sheet.existing} onDone={onSaved} />
          ) : sheet.kind === "drink" ? (
            <DrinkForm userId={currentUserId} day={day} existing={sheet.existing} onDone={onSaved} />
          ) : sheet.kind === "activity" ? (
            <ActivityForm userId={currentUserId} day={day} existing={sheet.existing} onDone={onSaved} />
          ) : (
            <WeightForm userId={currentUserId} day={day} existing={sheet.existing} onDone={onSaved} />
          )}
        </Sheet>
      ) : null}
      <BottomNav />
    </main>
  );
}

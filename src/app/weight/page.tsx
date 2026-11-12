"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { loadProfile, type ProfileRow } from "@/lib/profile";
import { profileEnergy } from "@/lib/energy-profile";
import { BODY_MEASURES, type BodyMeasureKey, type BodyMeasurementRow, type WeightRow } from "@/lib/day/entries";
import {
  loadBodyMeasurements,
  loadCalibrations,
  saveCalibration,
  savePredictionSnapshot,
  type CalibrationRow,
} from "@/lib/weight/extras-data";
import { BodyMeasurementForm } from "@/components/forms/BodyMeasurementForm";
import { loadDayBalances, loadWeights } from "@/lib/weight/data";
import {
  MIN_CALIBRATION_DOCUMENTED_DAYS,
  MIN_CALIBRATION_SPAN_DAYS,
  MIN_CALIBRATION_WEIGH_DAYS,
  MIN_DOCUMENTED_DAYS,
  MIN_TREND_SPAN_DAYS,
  MIN_TREND_WEIGH_DAYS,
  WINDOW_DAYS,
  calibrationInsight,
  calorieTrend,
  dailyWeights,
  dataQuality,
  dateOfDay,
  dayIndex,
  fitTrend,
  forecastWeight,
  goalEta,
  monthToDate,
  movingAverage,
  suggestCalibration,
  type DayBalance,
  type Estimate,
} from "@/lib/weight/trend";
import { Button, Card, Field, FullPageMessage, Notice, TextInput } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { WeightForm } from "@/components/forms/WeightForm";
import { WeightChart } from "@/components/WeightChart";
import { BottomNav } from "@/components/BottomNav";

const RANGES = [
  { key: "30", label: "30 ימים", days: 30 },
  { key: "90", label: "90 ימים", days: 90 },
  { key: "all", label: "הכול", days: null },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

const dateFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric" });
const shortDateTime = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function kg(value: number): string {
  return `${value.toFixed(1)} ק"ג`;
}

function signedKg(value: number): string {
  if (Math.abs(value) < 0.05) return "ללא שינוי";
  return `${value > 0 ? "עלייה של" : "ירידה של"} ${Math.abs(value).toFixed(1)} ק"ג`;
}

function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-600">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function EstimateRow({ label, estimate, missing }: { label: string; estimate: Estimate | null; missing: string }) {
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="font-bold tabular-nums">{estimate ? kg(estimate.weightKg) : "אין עדיין"}</span>
      </div>
      <p className="text-xs text-slate-500">
        {estimate ? `טווח סביר: ${estimate.lowKg.toFixed(1)} עד ${estimate.highKg.toFixed(1)} ק"ג` : missing}
      </p>
    </div>
  );
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const percent = Math.round(Math.min(1, value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-900">
          {value} מתוך {max}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function WeightPage() {
  const router = useRouter();
  const { session, loading: authLoading, error: authError } = useAuth();
  const userId = session?.user.id ?? null;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [weights, setWeights] = useState<WeightRow[] | null>(null);
  const [balances, setBalances] = useState<DayBalance[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [range, setRange] = useState<RangeKey>("30");
  const [sheet, setSheet] = useState<{ existing: WeightRow | null } | null>(null);
  const [calibrations, setCalibrations] = useState<CalibrationRow[]>([]);
  const [calibrationBusy, setCalibrationBusy] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<BodyMeasurementRow[]>([]);
  const [measureSheet, setMeasureSheet] = useState<{ existing: BodyMeasurementRow | null } | null>(null);
  const [measureKey, setMeasureKey] = useState<BodyMeasureKey>("waist");
  const snapshotSaved = useRef<string | null>(null);
  const [targetDate, setTargetDate] = useState<string>(() => {
    const now = new Date();
    return toDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0)); // last day of this month
  });

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [profileRow, weightRows, calibrationRows, measurementRows] = await Promise.all([
          loadProfile(userId),
          loadWeights(userId),
          loadCalibrations(userId),
          loadBodyMeasurements(userId),
        ]);
        if (cancelled) return;
        if (!profileRow?.onboarding_completed_at) {
          router.replace("/profile");
          return;
        }

        // The calorie balance needs an expenditure estimate, which needs the profile and a weight.
        const today = new Date();
        const latest = weightRows.length > 0 ? Number(weightRows[weightRows.length - 1].weight_kg) : null;
        const weightKg = latest ?? (profileRow.start_weight_kg === null ? null : Number(profileRow.start_weight_kg));
        const adjustment = calibrationRows.length > 0 ? Number(calibrationRows[0].adjustment_kcal) : 0;
        const estimate = profileEnergy(profileRow, weightKg, today, adjustment);
        let dayBalances: DayBalance[] = [];
        if (estimate) {
          dayBalances = await loadDayBalances(userId, today, { bmr: estimate.bmr, baselineKcal: estimate.baseline });
          if (cancelled) return;
        }

        setCalibrations(calibrationRows);
        setMeasurements(measurementRows);
        setProfile(profileRow);
        setWeights(weightRows);
        setBalances(dayBalances);
        setLoadError(null);
      } catch {
        if (!cancelled) setLoadError("לא הצלחנו לטעון את הנתונים. בדוק את החיבור ונסה לרענן.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, router, reloadKey]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const closeMeasureSheet = useCallback(() => setMeasureSheet(null), []);
  const onSaved = useCallback(() => {
    setSheet(null);
    setMeasureSheet(null);
    setReloadKey((key) => key + 1);
  }, []);

  const model = useMemo(() => {
    if (!weights) return null;
    const today = dayIndex(new Date());
    const weighIns = weights.map((row) => ({ at: row.measured_at, weightKg: Number(row.weight_kg) }));
    const daily = dailyWeights(weighIns);
    const average = movingAverage(daily);
    const trend = fitTrend(daily, today);
    const calories = calorieTrend(balances, today);
    const now = new Date();
    const monthStart = dayIndex(new Date(now.getFullYear(), now.getMonth(), 1));
    return {
      today,
      weighIns,
      daily,
      average,
      trend,
      calories,
      month: monthToDate(balances, monthStart, today),
      monthStart,
      quality: dataQuality({ today, weighIns, dayBalances: balances }),
      calibration: calibrationInsight(trend, calories),
    };
  }, [weights, balances]);

  // Once a day, keep the forecast for the end of this month, to compare later with what happened.
  useEffect(() => {
    if (!userId || !model) return;
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const stamp = `${userId}:${now.toDateString()}`;
    if (snapshotSaved.current === stamp) return;
    const latestAverageValue = model.average.length > 0 ? model.average[model.average.length - 1].value : null;
    const monthForecast = forecastWeight({
      today: model.today,
      targetDay: dayIndex(monthEnd),
      currentWeightKg: latestAverageValue,
      trend: model.trend,
      calories: model.calories,
    });
    snapshotSaved.current = stamp;
    savePredictionSnapshot(userId, now, monthEnd, monthForecast).catch(() => {
      snapshotSaved.current = null; // try again on the next load
    });
  }, [userId, model]);

  if (authError) return <Notice kind="error">{authError}</Notice>;
  if (authLoading || !userId) return <FullPageMessage>טוען…</FullPageMessage>;
  if (!profile || !weights || !model) {
    return loadError ? <Notice kind="error">{loadError}</Notice> : <FullPageMessage>טוען…</FullPageMessage>;
  }

  const currentUserId: string = userId;
  const { today, daily, average, trend, calories, month, quality, calibration } = model;
  const targetKg = profile.target_weight_kg === null ? null : Number(profile.target_weight_kg);
  const startKg = profile.start_weight_kg === null ? null : Number(profile.start_weight_kg);

  // Current weight: the moving average when there is one, so a single odd morning does not move it.
  const latestAverage = average.length > 0 ? average[average.length - 1].value : null;
  const currentKg = trend?.valueAtEnd ?? latestAverage ?? startKg;

  const firstOfMonthAverage = [...average].reverse().find((point) => point.day < model.monthStart) ?? average[0] ?? null;
  const changeThisMonth =
    latestAverage !== null && firstOfMonthAverage && average.length > 1 ? latestAverage - firstOfMonthAverage.value : null;
  const changeSinceStart = latestAverage !== null && daily.length > 1 ? latestAverage - daily[0].weightKg : null;

  const selectedRange = RANGES.find((item) => item.key === range) ?? RANGES[0];
  const rangeStart = selectedRange.days === null ? -Infinity : today - selectedRange.days;
  const chartDaily = daily.filter((point) => point.day > rangeStart);
  const chartAverage = average.filter((point) => point.day > rangeStart);

  const target = parseDateInput(targetDate);
  const targetDay = target ? dayIndex(target) : null;
  const forecast =
    targetDay !== null && targetDay >= today
      ? forecastWeight({ today, targetDay, currentWeightKg: currentKg, trend, calories })
      : null;

  const eta = trend && targetKg !== null ? goalEta(trend.valueAtEnd, targetKg, trend.slopeKgPerDay, trend.slopeSe) : null;
  const etaDate = (days: number) => dateFormat.format(dateOfDay(today + days));

  const trendMissing = `נדרשות לפחות ${MIN_TREND_WEIGH_DAYS} שקילות בימים שונים, על פני ${MIN_TREND_SPAN_DAYS} ימים ומעלה, ב-${WINDOW_DAYS} הימים האחרונים.`;
  const caloriesMissing = `נדרשים לפחות ${MIN_DOCUMENTED_DAYS} ימים עם רישום מזון ב-${WINDOW_DAYS} הימים האחרונים.`;
  const qualityLabel = { low: "נמוכה", medium: "בינונית", high: "גבוהה" }[quality.level];
  const listed = [...weights].reverse().slice(0, 30);

  const adjustment = calibrations.length > 0 ? Number(calibrations[0].adjustment_kcal) : 0;
  const suggested = calibration.status === "gap" ? suggestCalibration(calibration.gapKcalPerDay, adjustment) : null;
  const signedKcal = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)} קק"ל ליום`;

  async function applyCalibration(next: number, explanation: string) {
    setCalibrationBusy(true);
    setCalibrationError(null);
    try {
      await saveCalibration(currentUserId, {
        adjustmentKcal: next,
        previousAdjustmentKcal: adjustment,
        gapKcalPerDay: calibration.status === "insufficient" ? null : Math.round(calibration.gapKcalPerDay),
        weighDays: trend?.weighDays ?? null,
        documentedDays: calories?.documentedDays ?? null,
        explanation,
      });
      setReloadKey((key) => key + 1);
    } catch {
      setCalibrationError("שמירת הכיול נכשלה. נסה שוב.");
    } finally {
      setCalibrationBusy(false);
    }
  }

  const measure = BODY_MEASURES.find((item) => item.key === measureKey) ?? BODY_MEASURES[0];
  const measurePoints = measurements
    .map((row) => ({ row, value: row[measure.column] }))
    .filter((point): point is { row: BodyMeasurementRow; value: number } => point.value !== null)
    .map((point) => ({ at: point.row.measured_at, value: Number(point.value) }));
  const firstMeasure = measurePoints[0] ?? null;
  const lastMeasure = measurePoints[measurePoints.length - 1] ?? null;

  return (
    <main className="space-y-4 pb-20">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">משקל ותחזית</h1>
        <button
          type="button"
          onClick={() => setSheet({ existing: null })}
          className="flex min-h-11 items-center rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
        >
          + שקילה
        </button>
      </header>

      {loadError ? <Notice kind="error">{loadError}</Notice> : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="משקל נוכחי (מגמה)" value={currentKg === null ? "לא הוזן" : kg(currentKg)} />
        <Stat label="יעד" value={targetKg === null ? "לא הוגדר" : kg(targetKg)} />
        <Stat label="מתחילת החודש" value={changeThisMonth === null ? "אין מספיק שקילות" : signedKg(changeThisMonth)} />
        <Stat label="מתחילת המעקב" value={changeSinceStart === null ? "אין מספיק שקילות" : signedKg(changeSinceStart)} />
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">המשקל לאורך זמן</h2>
          <div className="flex gap-1" role="group" aria-label="טווח הגרף">
            {RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={range === item.key}
                onClick={() => setRange(item.key)}
                className={
                  "min-h-9 rounded-full px-3 text-xs font-semibold " +
                  (range === item.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <WeightChart daily={chartDaily} average={chartAverage} targetKg={targetKg} />
        <p className="text-xs leading-relaxed text-slate-500">
          תנודות של עד קילו בין יום ליום הן טבעיות (נוזלים, מלח, עיכול). הממוצע הנע מראה את הכיוון האמיתי טוב יותר משקילה
          בודדת.
        </p>
      </Card>

      <Card>
        <h2 className="font-semibold">תחזית משקל לתאריך</h2>
        <div className="mt-2">
          <Field label="לאיזה תאריך?" htmlFor="forecast-date">
            <TextInput
              id="forecast-date"
              type="date"
              value={targetDate}
              min={toDateInput(new Date())}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </Field>
        </div>

        {forecast === null ? (
          <div className="mt-3">
            <Notice kind="info">יש לבחור תאריך מהיום והלאה.</Notice>
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-600">
              {forecast.daysAhead === 0 ? "היום" : `בעוד ${forecast.daysAhead} ימים`}
              {target ? `, ${dateFormat.format(target)}` : ""}:
            </p>
            <div className="divide-y divide-slate-100">
              <EstimateRow
                label="תחזית משולבת"
                estimate={forecast.combined}
                missing="המערכת עדיין לומדת: נדרשות גם מגמת משקל וגם רישום קלוריות."
              />
              <EstimateRow label="לפי מגמת המשקל בפועל" estimate={forecast.trend} missing={trendMissing} />
              <EstimateRow label="תיאורטית, לפי מאזן הקלוריות" estimate={forecast.theoretical} missing={caloriesMissing} />
            </div>
          </>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          התחזית התיאורטית מניחה 7,700 קק"ל לק"ג. זה אומדן גס ולא חוק פיזיולוגי, והמשקל בפועל מושפע גם מנוזלים, גליקוגן,
          מלח, שינה ועוד. הטווחים הם הערכה של אי-הוודאות, לא הבטחה.
        </p>
      </Card>

      <Card>
        <h2 className="font-semibold">מתי אגיע ליעד?</h2>
        {targetKg === null ? (
          <p className="mt-2 text-sm text-slate-600">לא הוגדר משקל יעד בפרופיל.</p>
        ) : !trend || !eta ? (
          <p className="mt-2 text-sm text-slate-600">אין עדיין תחזית אמינה. {trendMissing}</p>
        ) : eta.status === "reached" ? (
          <p className="mt-2 text-sm font-semibold text-slate-900">✓ לפי המגמה, הגעת ליעד.</p>
        ) : eta.status === "wrong_direction" ? (
          <p className="mt-2 text-sm text-slate-700">
            המגמה הנוכחית היא {signedKg(trend.slopeKgPerDay * 7)} בשבוע, בכיוון ההפוך מהיעד, ולכן אין תאריך משוער.
          </p>
        ) : eta.status === "too_slow" ? (
          <p className="mt-2 text-sm text-slate-700">
            המגמה הנוכחית ({signedKg(trend.slopeKgPerDay * 7)} בשבוע) איטית מכדי לתת תאריך משוער אמין.
          </p>
        ) : (
          <>
            <p className="mt-2 text-xl font-bold">{etaDate(eta.days)}</p>
            <p className="text-sm text-slate-600">
              בקצב הנוכחי: {signedKg(trend.slopeKgPerDay * 7)} בשבוע. טווח אפשרי: מ-{etaDate(eta.earliestDays)}
              {eta.latestDays !== null ? ` עד ${etaDate(eta.latestDays)}` : " ואילך, בלי גבול עליון אמין"}.
            </p>
            <p className="mt-1 text-xs text-slate-500">מבוסס על מגמת השקילות בפועל, לא על חישוב הקלוריות.</p>
          </>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">החודש עד עכשיו</h2>
        {month.documentedDays === 0 ? (
          <p className="mt-2 text-sm text-slate-600">עוד אין ימים עם רישום מזון החודש.</p>
        ) : (
          <dl className="mt-1 divide-y divide-slate-100 text-sm">
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-slate-600">ימים עם רישום מזון</dt>
              <dd className="font-semibold tabular-nums">
                {month.documentedDays} מתוך {month.elapsedDays}
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-slate-600">מאזן מצטבר בימים האלה</dt>
              <dd className="font-semibold tabular-nums">
                {month.cumulativeBalanceKcal < 0 ? "גירעון של " : "עודף של "}
                {Math.round(Math.abs(month.cumulativeBalanceKcal)).toLocaleString("he-IL")} קק"ל
              </dd>
            </div>
            {month.averageBalanceKcal !== null ? (
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-slate-600">ממוצע יומי</dt>
                <dd className="font-semibold tabular-nums">
                  {month.averageBalanceKcal < 0 ? "גירעון של " : "עודף של "}
                  {Math.round(Math.abs(month.averageBalanceKcal)).toLocaleString("he-IL")} קק"ל
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-slate-600">שינוי משקל תיאורטי</dt>
              <dd className="font-semibold tabular-nums">{signedKg(month.theoreticalChangeKg)}</dd>
            </div>
          </dl>
        )}
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          ימים בלי רישום מזון לא נכללים בחישוב, ולכן המאזן המצטבר חלקי כשחסרים ימים.
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">איכות הנתונים</h2>
          <span className="font-bold tabular-nums">
            {qualityLabel} ({quality.score}/100)
          </span>
        </div>
        <Meter label="ימים עם רישום מזון" value={quality.documentedDays} max={quality.windowDays} />
        <Meter label="ימי שקילה (יעד: 3 בשבוע)" value={Math.min(quality.weighDays, 12)} max={12} />
        <p className="text-sm text-slate-700">
          עקביות שעת השקילה:{" "}
          <span className="font-semibold">
            {quality.weighDays < 3 ? "אין מספיק שקילות" : quality.weighTimeConsistency >= 0.75 ? "טובה" : quality.weighTimeConsistency >= 0.35 ? "חלקית" : "נמוכה"}
          </span>
        </p>
        <p className="text-xs leading-relaxed text-slate-500">
          מחושב על {quality.windowDays} הימים האחרונים. ככל שהציון גבוה יותר, התחזיות אמינות יותר.
        </p>
      </Card>

      <Card>
        <h2 className="font-semibold">המשקל מול חישוב הקלוריות</h2>
        {calibration.status === "insufficient" ? (
          <p className="mt-2 text-sm text-slate-600">
            המערכת עדיין לומדת. להשוואה נדרשים {MIN_CALIBRATION_SPAN_DAYS} ימים של שקילות (לפחות{" "}
            {MIN_CALIBRATION_WEIGH_DAYS} ימי שקילה) ו-{MIN_CALIBRATION_DOCUMENTED_DAYS} ימים עם רישום מזון.
          </p>
        ) : calibration.status === "consistent" ? (
          <p className="mt-2 text-sm text-slate-700">
            ✓ שינוי המשקל בפועל תואם את מה שחישוב הקלוריות צופה, בהפרש של פחות מ-150 קק"ל ליום.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-800">
              {calibration.gapKcalPerDay > 0
                ? "המשקל יורד לאט יותר (או עולה מהר יותר) ממה שחישוב הקלוריות צופה"
                : "המשקל יורד מהר יותר (או עולה לאט יותר) ממה שחישוב הקלוריות צופה"}
              , בפער של כ-{Math.round(Math.abs(calibration.gapKcalPerDay) / 10) * 10} קק"ל ליום.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              הסיבות הנפוצות, לפי הסדר: רישום מזון חלקי או הערכות כמות לא מדויקות, קלוריות אימון מוערכות ביתר או בחסר,
              ותנודות נוזלים. זה לא אומר שחילוף החומרים השתנה. האפליקציה לא משנה דבר בלי אישורך.
            </p>
            {suggested !== null ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-slate-700">
                  אפשר לכייל את הערכת ההוצאה היומית ל-{signedKcal(suggested)} לעומת הנוסחה (כרגע: {adjustment === 0 ? "בלי כיול" : signedKcal(adjustment)}).
                  מוחל רק חצי מהפער, כדי שחודש חריג אחד לא יטה את החישוב.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={calibrationBusy}
                  onClick={() =>
                    applyCalibration(
                      suggested,
                      `פער של ${Math.round(calibration.gapKcalPerDay)} קק"ל ליום בין מגמת המשקל לחישוב הקלוריות. הוחל חצי ממנו.`,
                    )
                  }
                >
                  {calibrationBusy ? "שומר…" : "אישור הכיול"}
                </Button>
              </div>
            ) : null}
          </>
        )}

        {adjustment !== 0 ? (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <p className="text-sm text-slate-700">
              כיול בתוקף: <span className="font-semibold">{signedKcal(adjustment)}</span> להוצאה היומית, מאז{" "}
              {dateFormat.format(new Date(calibrations[0].effective_at))}.
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={calibrationBusy}
              onClick={() => applyCalibration(0, "הכיול אופס לבקשת המשתמש. החישוב חזר לנוסחה בלבד.")}
            >
              איפוס הכיול
            </Button>
          </div>
        ) : null}
        {calibrationError ? (
          <div className="mt-2">
            <Notice kind="error">{calibrationError}</Notice>
          </div>
        ) : null}
        {calibrations.length > 0 ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold text-slate-700">היסטוריית כיול ({calibrations.length})</summary>
            <ul className="mt-2 space-y-2 text-xs text-slate-600">
              {calibrations.map((row) => (
                <li key={row.id}>
                  <span className="font-semibold text-slate-800">
                    {dateFormat.format(new Date(row.effective_at))}: {signedKcal(Number(row.previous_adjustment_kcal))} ←{" "}
                    {signedKcal(Number(row.adjustment_kcal))}
                  </span>
                  <br />
                  {row.explanation}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">מדידות גוף</h2>
          <button
            type="button"
            onClick={() => setMeasureSheet({ existing: null })}
            className="min-h-9 rounded-lg px-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            + מדידה
          </button>
        </div>
        {measurements.length === 0 ? (
          <p className="text-sm text-slate-600">
            עוד אין מדידות. היקפים (מותניים, חזה, ירך) משלימים את המשקל, כי לפעמים הגוף משתנה גם כשהמשקל לא זז.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1" role="group" aria-label="בחירת מדידה">
              {BODY_MEASURES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={measureKey === item.key}
                  onClick={() => setMeasureKey(item.key)}
                  className={
                    "min-h-9 rounded-full px-3 text-xs font-semibold " +
                    (measureKey === item.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
            {lastMeasure && firstMeasure ? (
              <>
                <p className="text-sm text-slate-700">
                  אחרון: <span className="font-bold tabular-nums">{lastMeasure.value} {measure.unit}</span>
                  {measurePoints.length > 1
                    ? ` · שינוי מהמדידה הראשונה: ${(lastMeasure.value - firstMeasure.value > 0 ? "+" : "") + (lastMeasure.value - firstMeasure.value).toFixed(1)} ${measure.unit}`
                    : ""}
                </p>
                <WeightChart
                  daily={dailyWeights(measurePoints.map((point) => ({ at: point.at, weightKg: point.value })))}
                  average={[]}
                  targetKg={null}
                  unit={measure.unit}
                />
              </>
            ) : (
              <p className="text-sm text-slate-600">עוד אין ערכים למדידה הזאת.</p>
            )}
            <ul className="divide-y divide-slate-100">
              {[...measurements].reverse().slice(0, 10).map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setMeasureSheet({ existing: row })}
                    aria-label="עריכת מדידה"
                    className="flex w-full flex-col gap-0.5 py-2.5 text-start hover:bg-slate-50"
                  >
                    <span className="text-sm text-slate-700">{shortDateTime.format(new Date(row.measured_at))}</span>
                    <span className="text-xs text-slate-500">
                      {BODY_MEASURES.filter((item) => row[item.column] !== null)
                        .map((item) => `${item.label} ${Number(row[item.column])} ${item.unit}`)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">שקילות אחרונות</h2>
        {listed.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">עוד אין שקילות. אפשר להוסיף בכפתור שלמעלה.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {listed.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSheet({ existing: row })}
                  aria-label={`שקילה ${kg(Number(row.weight_kg))}, עריכה`}
                  className="flex w-full items-center justify-between gap-3 py-3 text-start hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-700">{shortDateTime.format(new Date(row.measured_at))}</span>
                    {row.measurement_conditions ? (
                      <span className="block truncate text-xs text-slate-500">{row.measurement_conditions}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">{kg(Number(row.weight_kg))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sheet ? (
        <Sheet title={sheet.existing ? "עריכת שקילה" : "הזנת משקל"} onClose={closeSheet}>
          <WeightForm userId={currentUserId} day={new Date()} existing={sheet.existing} onDone={onSaved} />
        </Sheet>
      ) : null}

      {measureSheet ? (
        <Sheet title={measureSheet.existing ? "עריכת מדידה" : "מדידת גוף חדשה"} onClose={closeMeasureSheet}>
          <BodyMeasurementForm userId={currentUserId} existing={measureSheet.existing} onDone={onSaved} />
        </Sheet>
      ) : null}

      <BottomNav />
    </main>
  );
}

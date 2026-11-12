"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { loadProfile, type ProfileRow } from "@/lib/profile";
import { ageInYears } from "@/lib/validation/profile";
import { baselineExpenditure, bmrMifflinStJeor } from "@/lib/calculations/energy";
import type { WeightRow } from "@/lib/day/entries";
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
        const [profileRow, weightRows] = await Promise.all([loadProfile(userId), loadWeights(userId)]);
        if (cancelled) return;
        if (!profileRow?.onboarding_completed_at) {
          router.replace("/profile");
          return;
        }

        // The calorie balance needs an expenditure estimate, which needs the profile and a weight.
        const today = new Date();
        const latest = weightRows.length > 0 ? Number(weightRows[weightRows.length - 1].weight_kg) : null;
        const weightKg = latest ?? (profileRow.start_weight_kg === null ? null : Number(profileRow.start_weight_kg));
        const age = profileRow.birth_date ? ageInYears(profileRow.birth_date, today) : null;
        let dayBalances: DayBalance[] = [];
        if (profileRow.sex_for_bmr && age !== null && age > 0 && profileRow.height_cm !== null && weightKg !== null) {
          const bmr = bmrMifflinStJeor({
            sex: profileRow.sex_for_bmr,
            weightKg,
            heightCm: Number(profileRow.height_cm),
            ageYears: age,
          });
          const baselineKcal = baselineExpenditure(bmr, Number(profileRow.activity_factor));
          dayBalances = await loadDayBalances(userId, today, { bmr, baselineKcal });
          if (cancelled) return;
        }

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
  const onSaved = useCallback(() => {
    setSheet(null);
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
              ותנודות נוזלים. זה לא אומר שחילוף החומרים השתנה. האפליקציה לא משנה יעדים אוטומטית בגלל הפער הזה.
            </p>
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

      <BottomNav />
    </main>
  );
}

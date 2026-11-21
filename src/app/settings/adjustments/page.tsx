"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SettingsShell } from "@/components/SettingsShell";
import { SnackAllowanceCard } from "@/components/SnackAllowanceCard";
import { Button, Card, Notice } from "@/components/ui";
import { loadProfile, type ProfileRow } from "@/lib/profile";
import { loadCalibrationAdjustment, saveCalibration } from "@/lib/weight/extras-data";

export default function AdjustmentsPage() {
  return <SettingsShell title="התאמות לחישוב">{(userId) => <Adjustments userId={userId} />}</SettingsShell>;
}

function Adjustments({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [adjustment, setAdjustment] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadProfile(userId), loadCalibrationAdjustment(userId)])
      .then(([row, kcal]) => {
        if (cancelled) return;
        setProfile(row);
        setAdjustment(kcal);
      })
      .catch(() => {
        if (!cancelled) setLoadError("לא הצלחנו לטעון את ההגדרות. בדוק את החיבור ונסה לרענן.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loadError) return <Notice kind="error">{loadError}</Notice>;
  if (!profile || adjustment === null) return <p className="text-slate-600">טוען…</p>;

  return (
    <>
      <p className="text-sm text-slate-600">
        תיקונים קבועים שהאפליקציה מוסיפה לחישוב, לדברים שקשה לרשום או למדוד. כל אחד מהם מסומן כהערכה.
      </p>
      <SnackAllowanceCard
        userId={userId}
        profile={profile}
        onSaved={(updated) => setProfile((current) => (current ? { ...current, ...updated } : current))}
      />
      <CalibrationCard userId={userId} adjustment={adjustment} onChanged={setAdjustment} />
    </>
  );
}

/** The personal calibration in force, which is suggested and confirmed on the weight screen. */
function CalibrationCard({
  userId,
  adjustment,
  onChanged,
}: {
  userId: string;
  adjustment: number;
  onChanged: (kcal: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await saveCalibration(userId, {
        adjustmentKcal: 0,
        previousAdjustmentKcal: adjustment,
        gapKcalPerDay: null,
        weighDays: null,
        documentedDays: null,
        explanation: "בוטל ידנית ממסך ההגדרות",
      });
      onChanged(0);
      setConfirming(false);
      setNotice("הכיול בוטל. ההוצאה הבסיסית חזרה לחישוב לפי הנוסחה.");
    } catch {
      setError("הביטול נכשל. בדוק את החיבור ונסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  const sign = adjustment > 0 ? "+" : "−";
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">כיול אישי</h2>
      <p className="text-sm text-slate-600">
        אחרי כמה שבועות של שקילות, האפליקציה משווה את השינוי במשקל למה שהמאזן צפה, ומציעה לתקן את ההוצאה הבסיסית. ההצעה
        מופיעה בעמוד המשקל ונכנסת לתוקף רק באישור שלך.
      </p>
      {notice ? <Notice kind="success">{notice}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
      <p className="font-medium">
        {adjustment === 0 ? "אין כיול פעיל" : `פעיל: ${sign}${Math.abs(adjustment)} קק"ל ביום להוצאה הבסיסית`}
      </p>
      <Link href="/weight" className="block text-sm font-medium text-emerald-700 underline">
        לעמוד המשקל וההצעות לכיול
      </Link>
      {adjustment !== 0 && !confirming ? (
        <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
          ביטול הכיול
        </Button>
      ) : null}
      {confirming ? (
        <div className="space-y-2">
          <Notice kind="info">ההוצאה הבסיסית תחזור לחישוב לפי הנוסחה בלבד, והיעד היומי ישתנה בהתאם.</Notice>
          <Button type="button" variant="danger" disabled={busy} onClick={() => void reset()}>
            {busy ? "מבטל…" : "כן, לבטל את הכיול"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            השארת הכיול
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

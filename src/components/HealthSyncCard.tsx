"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import {
  healthPlatform,
  healthStatus,
  isNativeApp,
  openHealthSettings,
  requestHealthAccess,
  type HealthPlatform,
  type HealthStatus,
} from "@/lib/health/native";
import { runHealthSync, type SyncResult } from "@/lib/health/sync-data";

const LAST_SYNC_KEY = "health-connect:last-sync";

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

const timeFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function readLastSync(): number | null {
  try {
    const value = Number(window.localStorage.getItem(LAST_SYNC_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeLastSync(time: number) {
  try {
    window.localStorage.setItem(LAST_SYNC_KEY, String(time));
  } catch {
    // The time of the last sync is a convenience only.
  }
}

/** Names shown for the health store of each platform. */
const STORE: Record<HealthPlatform, { name: string; title: string }> = {
  android: { name: "Health Connect", title: "אימונים מ-Samsung Health" },
  ios: { name: "Apple Health", title: "אימונים מ-Apple Health" },
};

function resultText(result: SyncResult, platform: HealthPlatform): string {
  const store = STORE[platform].name;
  if (result.read === 0) {
    return platform === "ios"
      ? `Apple Health לא החזיר אף אימון מ-${result.lookbackDays} הימים האחרונים. אם יש אימונים באפליקציית הבריאות, ` +
          "בדוק שם, תחת שיתוף → אפליקציות, שלאפליקציה יש גישה לאימונים."
      : `Health Connect לא החזיר אף אימון מ-${result.lookbackDays} הימים האחרונים. ` +
          "כנראה ש-Samsung Health עוד לא העביר אליו את האימונים: פתח את Samsung Health, המתן לסיום הסנכרון עם השעון, ונסה שוב.";
  }
  if (result.usable === 0) {
    return `התקבלו ${result.read} רשומות מ-${store}, אבל אף אחת לא במבנה שהאפליקציה מכירה. שדות: ${result.sampleFields.join(", ")}`;
  }
  const repairedNote =
    result.repaired === 0
      ? ""
      : result.repaired === 1
        ? " אימון אחד שכבר היה ביומן עודכן (קלוריות או סוג)."
        : ` ${result.repaired} אימונים שכבר היו ביומן עודכנו (קלוריות או סוג).`;
  if (result.inserted === 0) {
    return `אין אימונים חדשים. ${result.alreadySynced} אימונים מ-${store} כבר נמצאים ביומן.${repairedNote}`;
  }
  const added = result.inserted === 1 ? "נוסף אימון אחד" : `נוספו ${result.inserted} אימונים`;
  const copies = result.inserted - result.counted;
  const notes: string[] = [];
  if (copies > 0) notes.push(`${copies} מהם הם עותק של אימון שכבר נספר, ולכן נשמרו בלי להיספר שוב`);
  if (result.replaced > 0) {
    notes.push(
      result.replaced === 1
        ? "רשומה אחת שכבר הייתה ביומן לאותו אימון הפסיקה להיספר, כדי שלא ייספר פעמיים"
        : `${result.replaced} רשומות שכבר היו ביומן לאותם אימונים הפסיקו להיספר, כדי שלא ייספרו פעמיים`,
    );
  }
  return `${added}.${notes.length > 0 ? ` ${notes.join(". ")}.` : ""}${repairedNote}`;
}

/** Shown only inside the Android app: connects to Health Connect and syncs workouts from it. */
export function HealthSyncCard({ userId, onSynced }: { userId: string; onSynced: () => void }) {
  const [platform, setPlatform] = useState<HealthPlatform>("android");
  const [native, setNative] = useState(false);
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [caloriesMissing, setCaloriesMissing] = useState(false);
  const autoSynced = useRef(false);
  const syncing = useRef(false);
  const ready = useRef(false);

  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await runHealthSync(userId, null);
      setCaloriesMissing(!result.caloriesReadable);
      const now = Date.now();
      writeLastSync(now);
      setLastSync(now);
      setMessage(resultText(result, healthPlatform() ?? "android"));
      if (result.inserted > 0 || result.replaced > 0 || result.repaired > 0) onSynced();
    } catch {
      setError("הסנכרון נכשל. בדוק שיש חיבור לאינטרנט ושההרשאה לקריאת אימונים עדיין בתוקף.");
    } finally {
      syncing.current = false;
      setBusy(false);
    }
  }, [userId, onSynced]);

  useEffect(() => {
    if (!isNativeApp()) return;
    setNative(true);
    setPlatform(healthPlatform() ?? "android");
    setLastSync(readLastSync());
    let cancelled = false;
    healthStatus()
      .then((result) => {
        if (cancelled) return;
        setStatus(result);
        ready.current = result.state === "ready";
        const last = readLastSync();
        const due = last === null || Date.now() - last > AUTO_SYNC_INTERVAL_MS;
        if (result.state === "ready" && due && !autoSynced.current) {
          autoSynced.current = true;
          void sync();
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "needs_permission" });
        setError("לא הצלחנו לבדוק את החיבור ל-Health Connect. אפשר לנסות להתחבר בכפתור שלמטה.");
      });
    return () => {
      cancelled = true;
    };
  }, [sync]);

  // Returning to an app that stayed open in the background does not reload the page, so the sync
  // above would not run again; a workout written to the health app meanwhile is picked up here.
  useEffect(() => {
    if (!isNativeApp()) return;
    function onVisible() {
      if (document.visibilityState !== "visible" || !ready.current) return;
      const last = readLastSync();
      if (last !== null && Date.now() - last <= AUTO_SYNC_INTERVAL_MS) return;
      void sync();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sync]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const granted = await requestHealthAccess();
      if (granted) {
        setStatus({ state: "ready" });
        ready.current = true;
        await sync();
      } else {
        setError("ההרשאה לקריאת אימונים לא ניתנה. אפשר לאשר אותה בהגדרות של אפליקציית הבריאות.");
      }
    } catch {
      setError("לא הצלחנו לפתוח את מסך ההרשאות.");
    } finally {
      setBusy(false);
    }
  }

  if (!native) return null;

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">⌚ {STORE[platform].title}</h2>

      {status === null ? (
        <p className="text-sm text-slate-600">בודק את החיבור…</p>
      ) : status.state === "unavailable" ? (
        <Notice kind="info">
          {STORE[platform].name} לא זמין במכשיר הזה{status.reason ? ` (${status.reason})` : ""}.
          {platform === "android" ? " צריך להתקין או לעדכן אותו מ-Google Play." : ""}
        </Notice>
      ) : status.state === "needs_permission" ? (
        <>
          <p className="text-sm text-slate-600">
            {platform === "ios"
              ? "האפליקציה תקרא אימונים (סוג, משך, מרחק וקלוריות) מ-Apple Health. היא רק קוראת, ולא משנה שם דבר."
              : "האפליקציה תקרא אימונים (סוג, משך, מרחק וקלוריות) מ-Health Connect, שאליו Samsung Health כותב. היא רק קוראת, ולא משנה שם דבר."}
          </p>
          <Button type="button" onClick={connect} disabled={busy}>
            {busy ? "רגע…" : `חיבור ל-${STORE[platform].name}`}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {lastSync ? `סנכרון אחרון: ${timeFormat.format(new Date(lastSync))}` : "עוד לא בוצע סנכרון."}
          </p>
          <Button type="button" variant="secondary" onClick={() => void sync()} disabled={busy}>
            {busy ? "מסנכרן…" : "סנכרון עכשיו"}
          </Button>
          {caloriesMissing ? (
            <>
              <Notice kind="info">
                חסרה הרשאה לקרוא קלוריות מ-{STORE[platform].name}, ולכן חלק מהאימונים נשמרו בלי קלוריות.
              </Notice>
              <Button type="button" variant="secondary" onClick={connect} disabled={busy}>
                אישור גישה לקלוריות
              </Button>
            </>
          ) : null}
        </>
      )}

      {message ? <Notice kind="info">{message}</Notice> : null}
      {error ? (
        <>
          <Notice kind="error">{error}</Notice>
          {platform === "android" ? (
            <Button type="button" variant="ghost" onClick={() => void openHealthSettings().catch(() => undefined)}>
              פתיחת הגדרות Health Connect
            </Button>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { healthStatus, isNativeApp, openHealthSettings, requestHealthAccess, type HealthStatus } from "@/lib/health/native";
import { runHealthSync, type SyncResult } from "@/lib/health/sync-data";

const LAST_SYNC_KEY = "health-connect:last-sync";
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;

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

function resultText(result: SyncResult): string {
  if (result.read === 0) {
    return (
      `Health Connect לא החזיר אף אימון מ-${result.lookbackDays} הימים האחרונים. ` +
      "כנראה ש-Samsung Health עוד לא העביר אליו את האימונים: פתח את Samsung Health, המתן לסיום הסנכרון עם השעון, ונסה שוב."
    );
  }
  if (result.usable === 0) {
    return `התקבלו ${result.read} רשומות מ-Health Connect, אבל אף אחת לא במבנה שהאפליקציה מכירה. שדות: ${result.sampleFields.join(", ")}`;
  }
  if (result.inserted === 0) return `אין אימונים חדשים. ${result.alreadySynced} אימונים מ-Health Connect כבר נמצאים ביומן.`;
  const added = result.inserted === 1 ? "נוסף אימון אחד" : `נוספו ${result.inserted} אימונים`;
  const duplicates =
    result.manualDuplicates === 0
      ? ""
      : result.manualDuplicates === 1
        ? " אימון אחד שהזנת ידנית זוהה ככפילות ולא נספר עוד במאזן."
        : ` ${result.manualDuplicates} אימונים שהזנת ידנית זוהו ככפילות ולא נספרים עוד במאזן.`;
  return `${added}.${duplicates}`;
}

/** Shown only inside the Android app: connects to Health Connect and syncs workouts from it. */
export function HealthSyncCard({ userId, onSynced }: { userId: string; onSynced: () => void }) {
  const [native, setNative] = useState(false);
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const autoSynced = useRef(false);

  const sync = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await runHealthSync(userId);
      const now = Date.now();
      writeLastSync(now);
      setLastSync(now);
      setMessage(resultText(result));
      if (result.inserted > 0 || result.manualDuplicates > 0) onSynced();
    } catch {
      setError("הסנכרון נכשל. בדוק שיש חיבור לאינטרנט ושההרשאה ל-Health Connect עדיין בתוקף.");
    } finally {
      setBusy(false);
    }
  }, [userId, onSynced]);

  useEffect(() => {
    if (!isNativeApp()) return;
    setNative(true);
    setLastSync(readLastSync());
    let cancelled = false;
    healthStatus()
      .then((result) => {
        if (cancelled) return;
        setStatus(result);
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

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const granted = await requestHealthAccess();
      if (granted) {
        setStatus({ state: "ready" });
        await sync();
      } else {
        setError("ההרשאה לקריאת אימונים לא ניתנה. אפשר לאשר אותה בהגדרות של Health Connect.");
      }
    } catch {
      setError("לא הצלחנו לפתוח את מסך ההרשאות של Health Connect.");
    } finally {
      setBusy(false);
    }
  }

  if (!native) return null;

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">⌚ אימונים מ-Samsung Health</h2>

      {status === null ? (
        <p className="text-sm text-slate-600">בודק את החיבור…</p>
      ) : status.state === "unavailable" ? (
        <Notice kind="info">
          Health Connect לא זמין במכשיר הזה{status.reason ? ` (${status.reason})` : ""}. צריך להתקין או לעדכן אותו מ-Google Play.
        </Notice>
      ) : status.state === "needs_permission" ? (
        <>
          <p className="text-sm text-slate-600">
            האפליקציה תקרא אימונים (סוג, משך, מרחק וקלוריות) מ-Health Connect, שאליו Samsung Health כותב. היא רק קוראת,
            ולא משנה שם דבר.
          </p>
          <Button type="button" onClick={connect} disabled={busy}>
            {busy ? "רגע…" : "חיבור ל-Health Connect"}
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
        </>
      )}

      {message ? <Notice kind="info">{message}</Notice> : null}
      {error ? (
        <>
          <Notice kind="error">{error}</Notice>
          <Button type="button" variant="ghost" onClick={() => void openHealthSettings().catch(() => undefined)}>
            פתיחת הגדרות Health Connect
          </Button>
        </>
      ) : null}
    </Card>
  );
}

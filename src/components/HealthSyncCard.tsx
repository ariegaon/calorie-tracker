"use client";

import Link from "next/link";
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

/** One short line for the compact view after a sync that went fine. */
function shortResultText(result: SyncResult): string {
  if (result.inserted === 0) return result.repaired > 0 ? "עודכנו אימונים קיימים" : "אין אימונים חדשים";
  return result.inserted === 1 ? "נוסף אימון אחד" : `נוספו ${result.inserted} אימונים`;
}

/** A sync that read nothing usable needs the full card and its explanation. */
function isProblem(result: SyncResult): boolean {
  return result.read === 0 || result.usable === 0;
}

function sinceText(time: number | null, now: number): string {
  if (time === null) return "עוד לא סונכרן";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "סונכרן עכשיו";
  if (minutes < 60) return `סונכרן לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `סונכרן לפני ${hours} שע׳`;
  return `סונכרן ב-${timeFormat.format(new Date(time))}`;
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
  // Once connected and working, the card shrinks to one line; it opens on a problem or on a tap.
  const [expanded, setExpanded] = useState(false);
  const [shortMessage, setShortMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!shortMessage) return;
    const timer = window.setTimeout(() => setShortMessage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [shortMessage]);
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
      setShortMessage(shortResultText(result));
      if (isProblem(result)) setExpanded(true);
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

  const compact = status?.state === "ready" && !expanded && !error && !caloriesMissing;
  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-start"
        >
          <span aria-hidden="true" className="text-2xl leading-none">
            ⌚
          </span>
          <span className="min-w-0">
            <span className="block whitespace-nowrap text-[15px] font-semibold text-slate-900">{STORE[platform].name}</span>
            <span className="block text-sm text-slate-600">
              {busy ? "מסנכרן…" : (shortMessage ?? sinceText(lastSync, Date.now()))}
            </span>
            <span className="sr-only">. לחיצה פותחת את פרטי הסנכרון</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void sync()}
          disabled={busy}
          className="flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-60"
        >
          {busy ? "מסנכרן…" : "סנכרון עכשיו"}
        </button>
      </div>
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">⌚ {STORE[platform].title}</h2>
        {status?.state === "ready" && !error && !caloriesMissing ? (
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setMessage(null);
            }}
            className="min-h-9 rounded-lg px-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            צמצום
          </button>
        ) : null}
      </div>

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
      {status && status.state !== "unavailable" ? (
        <Link href="/settings/sources" className="block text-sm font-medium text-emerald-700 underline">
          אימון לא הגיע? איך מחברים שעון ואפליקציות
        </Link>
      ) : null}
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

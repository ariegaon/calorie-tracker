"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SettingsShell } from "@/components/SettingsShell";
import { Button, Card, Notice } from "@/components/ui";
import { healthPlatform, healthStatus, isNativeApp, openHealthSettings, type HealthStatus } from "@/lib/health/native";

const APK_URL = "https://github.com/ariegaon/calorie-tracker/releases/download/android-latest/calorie-tracker.apk";

export default function ConnectionsPage() {
  return <SettingsShell title="חיבורים ואפליקציה">{() => <Connections />}</SettingsShell>;
}

function Connections() {
  const [native, setNative] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<"android" | "ios">("android");
  const [status, setStatus] = useState<HealthStatus | null>(null);

  useEffect(() => {
    const inApp = isNativeApp();
    setNative(inApp);
    if (!inApp) return;
    setPlatform(healthPlatform() ?? "android");
    let cancelled = false;
    healthStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: "needs_permission" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (native === null) return <p className="text-slate-600">טוען…</p>;

  const store = platform === "ios" ? "Apple Health" : "Health Connect";
  const source = platform === "ios" ? "אפליקציית הבריאות של האייפון" : "Samsung Health ואפליקציות אחרות דרך Health Connect";

  return (
    <>
      {native ? (
        <Card className="space-y-3">
          <h2 className="font-semibold">{store}</h2>
          <p className="text-sm text-slate-600">האפליקציה קוראת אימונים וקלוריות מ{source}. היא לא כותבת לשם כלום.</p>
          <p className="font-medium">
            {status === null
              ? "בודק…"
              : status.state === "ready"
                ? "מחובר"
                : status.state === "needs_permission"
                  ? "לא מחובר"
                  : `לא זמין במכשיר הזה${status.reason ? ` (${status.reason})` : ""}`}
          </p>
          {status?.state === "needs_permission" ? (
            <Notice kind="info">את החיבור עושים מהכרטיס "אימונים מ-{store}" במסך הבית.</Notice>
          ) : null}
          <p className="text-sm text-slate-600">
            הסנכרון רץ לבד כשפותחים את האפליקציה או חוזרים אליה. אפשר גם ללחוץ "סנכרון עכשיו" בכרטיס במסך הבית.
          </p>
          {platform === "ios" ? (
            <p className="text-sm text-slate-600">
              את ההרשאות מנהלים באפליקציית הבריאות: הפרופיל ← אפליקציות ← מאזן קלורי.
            </p>
          ) : (
            <Button type="button" variant="secondary" onClick={() => void openHealthSettings().catch(() => undefined)}>
              הגדרות Health Connect
            </Button>
          )}
          <Link href="/" className="block text-sm font-medium text-emerald-700 underline">
            למסך הבית
          </Link>
        </Card>
      ) : (
        <Card className="space-y-3">
          <h2 className="font-semibold">אפליקציה לטלפון</h2>
          <p className="text-sm text-slate-600">
            באתר אפשר לרשום הכול, אבל סנכרון אימונים מהשעון עובד רק באפליקציה המותקנת.
          </p>
          <p className="text-sm text-slate-600">
            <span className="font-medium">אנדרואיד:</span> מורידים את קובץ ה-APK ומתקינים. האפליקציה מסנכרנת אימונים מ-Samsung
            Health ומאפליקציות אחרות דרך Health Connect.
          </p>
          <a
            href={APK_URL}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-800 hover:bg-slate-100"
          >
            הורדת האפליקציה לאנדרואיד (APK)
          </a>
          <p className="text-sm text-slate-600">
            <span className="font-medium">אייפון:</span> האפליקציה זמינה כרגע בהזמנה דרך TestFlight. היא מסנכרנת אימונים
            מ-Apple Health.
          </p>
        </Card>
      )}
    </>
  );
}

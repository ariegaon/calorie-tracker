"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SettingsShell } from "@/components/SettingsShell";
import { Card } from "@/components/ui";
import { healthPlatform } from "@/lib/health/native";
import { GUIDE, guideText, type GuidePlatform } from "@/lib/health/sources-guide";

export default function SourcesPage() {
  return <SettingsShell title="חיבור שעון ואפליקציות אימון">{() => <SourcesGuide />}</SettingsShell>;
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "min-h-10 rounded-full border px-3.5 text-sm font-medium " +
        (active
          ? "border-emerald-600 bg-emerald-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100")
      }
    >
      {label}
    </button>
  );
}

function Steps({ items, store, ordered = true }: { items: string[]; store: string; ordered?: boolean }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={(ordered ? "list-decimal" : "list-disc") + " space-y-1.5 ps-5 text-sm text-slate-700"}>
      {items.map((item) => (
        <li key={item}>{guideText(item, store)}</li>
      ))}
    </List>
  );
}

function SourcesGuide() {
  // In the installed app the phone is known; on the website the visitor picks one.
  const [native, setNative] = useState<GuidePlatform | null>(null);
  const [platform, setPlatform] = useState<GuidePlatform>("android");
  const [sourceId, setSourceId] = useState<string | null>(null);

  useEffect(() => {
    const detected = healthPlatform();
    if (detected) {
      setNative(detected);
      setPlatform(detected);
    } else if (/iPhone|iPad/.test(navigator.userAgent)) {
      setPlatform("ios");
    }
  }, []);

  const guide = GUIDE[platform];
  const source = guide.sources.find((s) => s.id === sourceId) ?? null;

  return (
    <>
      <p className="text-sm text-slate-600">
        האפליקציה קוראת אימונים מ-{guide.store}. כדי שאימון יגיע לבד, האפליקציה שמקליטה אותו צריכה לשלוח אותו ל-
        {guide.store}.
      </p>

      {native === null ? (
        <Card className="space-y-2">
          <h2 className="font-semibold">איזה טלפון?</h2>
          <div className="flex flex-wrap gap-2">
            <Chip active={platform === "ios"} label="אייפון" onClick={() => { setPlatform("ios"); setSourceId(null); }} />
            <Chip active={platform === "android"} label="אנדרואיד" onClick={() => { setPlatform("android"); setSourceId(null); }} />
          </div>
        </Card>
      ) : null}

      <Card className="space-y-3">
        <h2 className="font-semibold">עם מה אתה מקליט אימונים?</h2>
        <div className="flex flex-wrap gap-2">
          {guide.sources.map((s) => (
            <Chip key={s.id} active={sourceId === s.id} label={s.label} onClick={() => setSourceId(s.id)} />
          ))}
        </div>
        {source ? (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <h3 className="font-semibold">
              {source.label} ← {guide.store}
            </h3>
            <Steps items={source.steps} store={guide.store} />
            {source.notes?.length ? (
              <div className="rounded-xl bg-amber-50 px-3 py-2">
                <Steps items={source.notes} store={guide.store} ordered={false} />
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="space-y-2">
        <h2 className="font-semibold">איך בודקים שזה עבד</h2>
        <Steps items={guide.verify} store={guide.store} ordered={false} />
      </Card>

      <Card className="space-y-2">
        <h2 className="font-semibold">עדיין לא מגיע?</h2>
        <Steps items={guide.fixes} store={guide.store} ordered={false} />
        <p className="text-xs text-slate-500">שמות התפריטים יכולים להשתנות מעט בין גרסאות של האפליקציות.</p>
      </Card>

      <Link href="/settings/connections" className="block text-sm font-medium text-emerald-700 underline">
        לחיבורים ואפליקציה
      </Link>
    </>
  );
}

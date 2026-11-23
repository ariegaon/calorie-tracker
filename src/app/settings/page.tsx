"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { BottomNav } from "@/components/BottomNav";
import { FullPageMessage } from "@/components/ui";

const SECTIONS = [
  { href: "/profile", icon: "🎯", title: "פרופיל ויעדים", detail: "פרטים אישיים, משקל יעד, קצב או תאריך יעד, חלבון ומים" },
  { href: "/settings/adjustments", icon: "🧮", title: "התאמות לחישוב", detail: "נשנושים שלא נרשמו וכיול אישי" },
  { href: "/settings/lists", icon: "📝", title: "רשימות שלי", detail: "תנאי שקילה: הוספה, עריכה, הסתרה וסדר" },
  { href: "/settings/connections", icon: "⌚", title: "חיבורים ואפליקציה", detail: "Apple Health, Health Connect והאפליקציה לטלפון" },
  { href: "/settings/account", icon: "👤", title: "חשבון", detail: "סיסמה, התנתקות ומחיקת חשבון" },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || !session) return <FullPageMessage>טוען…</FullPageMessage>;

  return (
    <main className="space-y-5 pb-20">
      <h1 className="text-2xl font-bold">הגדרות</h1>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link href={section.href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <span aria-hidden="true" className="text-2xl">
                {section.icon}
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{section.title}</span>
                <span className="block text-sm text-slate-600">{section.detail}</span>
              </span>
              <span aria-hidden="true" className="text-slate-400">
                ‹
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-center text-xs text-slate-500" dir="auto">
        מחובר כ-{session.user.email}
      </p>
      <BottomNav />
    </main>
  );
}

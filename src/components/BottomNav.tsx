"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { loadUnseenInsight } from "@/lib/insights/data";

const ITEMS = [
  { href: "/", label: "היום", icon: "🏠" },
  { href: "/weight", label: "משקל", icon: "📈" },
  { href: "/insights", label: "תובנות", icon: "💡" },
  { href: "/reports", label: "דוחות", icon: "📊" },
  { href: "/settings", label: "הגדרות", icon: "⚙" },
] as const;

/** Fixed bottom navigation between the main screens. Pages that use it add bottom padding. */
export function BottomNav() {
  const pathname = usePathname();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  // A dot on "Insights" while there is an insight the user has not opened.
  const [hasNewInsight, setHasNewInsight] = useState(false);
  useEffect(() => {
    if (!userId || pathname === "/insights") {
      setHasNewInsight(false);
      return;
    }
    let cancelled = false;
    loadUnseenInsight(userId)
      .then((row) => {
        if (!cancelled) setHasNewInsight(row !== null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, pathname]);
  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-40 border-t print:hidden border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md">
        {ITEMS.map((item) => {
          // Settings covers its sub-pages and the profile, which is reached from it.
          const current =
            item.href === "/settings"
              ? pathname === "/profile" || pathname === "/settings" || pathname.startsWith("/settings/")
              : item.href === "/insights"
                ? pathname === "/insights" || pathname.startsWith("/insights/")
                : pathname === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold " +
                  (current ? "border-t-2 border-emerald-600 text-emerald-700" : "border-t-2 border-transparent text-slate-600")
                }
              >
                <span aria-hidden="true" className="relative text-xl leading-none">
                  {item.icon}
                  {item.href === "/insights" && hasNewInsight ? (
                    <span className="absolute -end-1.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
                  ) : null}
                </span>
                {item.label}
                {item.href === "/insights" && hasNewInsight ? <span className="sr-only"> (חדש)</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

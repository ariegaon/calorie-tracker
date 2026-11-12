"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "היום", icon: "🏠" },
  { href: "/weight", label: "משקל ותחזית", icon: "📈" },
  { href: "/profile", label: "פרופיל", icon: "⚙" },
] as const;

/** Fixed bottom navigation between the main screens. Pages that use it add bottom padding. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md">
        {ITEMS.map((item) => {
          const current = pathname === item.href;
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
                <span aria-hidden="true" className="text-xl leading-none">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

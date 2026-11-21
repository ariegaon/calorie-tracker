"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { BottomNav } from "@/components/BottomNav";
import { FullPageMessage } from "@/components/ui";

/**
 * Frame of a settings sub-page: a way back to the settings menu, the title, and the bottom navigation.
 * Sends signed-out visitors to the login screen. Renders children only with a user id.
 */
export function SettingsShell({
  title,
  children,
}: {
  title: string;
  children: (userId: string, email: string | null) => ReactNode;
}) {
  const router = useRouter();
  const { session, loading } = useAuth();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!loading && !userId) router.replace("/login");
  }, [loading, userId, router]);

  if (loading || !userId) return <FullPageMessage>טוען…</FullPageMessage>;

  return (
    <main className="space-y-5 pb-20">
      <header className="space-y-1">
        <Link href="/settings" className="text-sm font-medium text-emerald-700">
          <span aria-hidden="true">→ </span>הגדרות
        </Link>
        <h1 className="text-2xl font-bold">{title}</h1>
      </header>
      {children(userId, session?.user.email ?? null)}
      <BottomNav />
    </main>
  );
}

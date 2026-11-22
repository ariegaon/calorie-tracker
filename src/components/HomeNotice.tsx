"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type NoticeItem = {
  /** Stable id: a dismissed item stays hidden for the rest of the day. */
  key: string;
  icon: string;
  text: string;
  /** Where a tap leads; without it the line is plain text. */
  href?: string;
};

const DISMISS_PREFIX = "home-notice:dismissed:";

function dismissKey(key: string, day: string): string {
  return `${DISMISS_PREFIX}${day}:${key}`;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/**
 * One slim line under the day's headline: the most important item only (new insight first, then
 * reminders). ✕ hides it for today and shows the next one, so the home screen never stacks cards.
 */
export function HomeNotice({ items }: { items: NoticeItem[] }) {
  const [dismissed, setDismissed] = useState<Set<string> | null>(null);

  const keys = items.map((item) => item.key).join("|");
  useEffect(() => {
    const day = today();
    const hidden = new Set<string>();
    try {
      for (const item of items) if (window.localStorage.getItem(dismissKey(item.key, day))) hidden.add(item.key);
    } catch {
      // Without storage nothing stays dismissed; that is fine.
    }
    setDismissed(hidden);
    // `keys` stands for `items`: the parent builds a new array on every render.
  }, [keys]);

  if (dismissed === null) return null;
  const visible = items.filter((item) => !dismissed.has(item.key));
  if (visible.length === 0) return null;
  const item = visible[0];

  function dismiss() {
    try {
      window.localStorage.setItem(dismissKey(item.key, today()), "1");
    } catch {
      // ignore
    }
    setDismissed((current) => new Set([...(current ?? []), item.key]));
  }

  const body = (
    <>
      <span aria-hidden="true">{item.icon} </span>
      {item.text}
      {item.href ? <span aria-hidden="true" className="text-slate-400"> ‹</span> : null}
    </>
  );

  return (
    <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-800">
      {item.href ? (
        <Link href={item.href} className="min-h-9 flex-1 py-1">
          {body}
        </Link>
      ) : (
        <p className="flex-1 py-1">{body}</p>
      )}
      {visible.length > 1 ? <span className="py-1 text-xs text-slate-500">+{visible.length - 1}</span> : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="סגירה"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-slate-500 hover:bg-amber-100"
      >
        ×
      </button>
    </div>
  );
}

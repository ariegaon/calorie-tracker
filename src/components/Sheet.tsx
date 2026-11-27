"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Notice } from "@/components/ui";

/** Bottom sheet dialog used for the add and edit forms. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" aria-label="סגירה" className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[calc(100dvh-env(safe-area-inset-top)-1.5rem)] w-full max-w-md overflow-y-auto rounded-t-3xl bg-slate-50 px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-2xl text-slate-500 hover:bg-slate-200"
            aria-label="סגירה"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Save, delete (with a second confirming tap) and error display shared by all entry forms. */
export function FormFooter({
  saving,
  error,
  isEdit,
  onDelete,
}: {
  saving: boolean;
  error: string | null;
  isEdit: boolean;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-3 pt-1">
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button type="submit" disabled={saving}>
        {saving ? "שומר…" : isEdit ? "שמור שינויים" : "שמור"}
      </Button>
      {isEdit && onDelete ? (
        confirming ? (
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="danger"
              disabled={saving}
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              כן, למחוק
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setConfirming(false)}>
              ביטול
            </Button>
          </div>
        ) : (
          <Button type="button" variant="dangerGhost" onClick={() => setConfirming(true)}>
            מחיקה
          </Button>
        )
      ) : null}
    </div>
  );
}

/** "Also save as a favorite" option shown in the meal and drink forms: a full-width switch card, so it is not missed. */
export function FavoriteOption({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-start transition-colors disabled:opacity-60 " +
        (checked ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white hover:border-amber-300")
      }
    >
      <span
        aria-hidden="true"
        className={
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none " +
          (checked ? "bg-amber-100" : "bg-slate-100 grayscale")
        }
      >
        ⭐
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-slate-900">שמירה כמועדף</span>
        <span className="block text-sm text-slate-600">בפעם הבאה: הוספה בלחיצה אחת ממסך הבית</span>
      </span>
      <span
        aria-hidden="true"
        className={
          "relative h-7 w-12 shrink-0 rounded-full transition-colors " + (checked ? "bg-amber-500" : "bg-slate-300")
        }
      >
        <span
          className={
            "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all " +
            (checked ? "start-[1.375rem]" : "start-0.5")
          }
        />
      </span>
    </button>
  );
}

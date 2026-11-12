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
        className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-slate-50 px-4 pb-8 pt-4 shadow-xl"
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

/** "Also save as a favorite" option shown in the meal and drink forms. */
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
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800">
      <input
        type="checkbox"
        className="h-5 w-5 accent-emerald-600"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      ⭐ לשמור גם כמועדף, להוספה בלחיצה אחת
    </label>
  );
}

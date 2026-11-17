"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { Button, Card, Field, Notice, TextInput } from "@/components/ui";

const CONFIRM_WORD = "מחק";

// Keys this app keeps on the device; they describe the deleted account, so they go too.
const LOCAL_KEYS = ["health-connect:last-sync", "apple-health:asked"];

/** Permanent deletion of the signed-in account and all of its data (Apple requires this in-app). */
export function DeleteAccountCard({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setError(null);
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: rpcError } = await supabase.rpc("delete_own_account");
      if (rpcError) {
        setError("המחיקה נכשלה. החשבון לא נמחק, נסה שוב.");
        setBusy(false);
        return;
      }
      try {
        for (const key of LOCAL_KEYS) window.localStorage.removeItem(key);
      } catch {
        // Storage can be unavailable; nothing to clean then.
      }
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      onDeleted();
    } catch {
      setError("אין חיבור לשרת. החשבון לא נמחק, נסה שוב.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="pb-4 text-center">
        <button type="button" className="text-sm text-slate-500 underline" onClick={() => setOpen(true)}>
          מחיקת החשבון
        </button>
      </div>
    );
  }

  return (
    <Card className="space-y-3 border-red-200">
      <h2 className="font-semibold text-red-700">מחיקת החשבון</h2>
      <p className="text-sm text-slate-700">
        החשבון וכל הנתונים שלו יימחקו לצמיתות: ארוחות, שתייה, אימונים, משקל, מדידות, מועדפים ותחזיות. אי אפשר לשחזר אותם.
        נתונים ב-Samsung Health או ב-Apple Health לא נפגעים.
      </p>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Field label={`כדי לאשר, הקלד "${CONFIRM_WORD}"`} htmlFor="delete-confirm">
        <TextInput id="delete-confirm" value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} />
      </Field>
      <Button type="button" variant="danger" disabled={busy || word.trim() !== CONFIRM_WORD} onClick={deleteAccount}>
        {busy ? "מוחק…" : "למחוק את החשבון לצמיתות"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setOpen(false);
          setWord("");
          setError(null);
        }}
      >
        ביטול
      </Button>
    </Card>
  );
}

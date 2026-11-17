"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button, Card, Field, FullPageMessage, Notice, TextInput } from "@/components/ui";

// The link in the reset email signs the user in (the session arrives in the URL) and lands here.
export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [linkError, setLinkError] = useState(false);

  useEffect(() => {
    // An expired or already used link comes back with an error in the URL instead of a session.
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
    if (params.get("error") || params.get("error_code")) setLinkError(true);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("הסיסמה צריכה להכיל לפחות 8 תווים");
      return;
    }
    if (password !== confirm) {
      setError("שתי הסיסמאות אינן זהות");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await getSupabase().auth.updateUser({ password });
      if (updateError) {
        setError(
          updateError.message.toLowerCase().includes("different")
            ? "הסיסמה החדשה זהה לישנה. בחר סיסמה אחרת"
            : "שמירת הסיסמה נכשלה. נסה שוב",
        );
      } else {
        setDone(true);
      }
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <FullPageMessage>טוען…</FullPageMessage>;

  return (
    <main className="space-y-6 pt-8">
      <header className="space-y-1 text-center">
        <h1 className="text-3xl font-bold text-emerald-700">מאזן קלורי</h1>
      </header>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">בחירת סיסמה חדשה</h2>

        {done ? (
          <>
            <Notice kind="success">הסיסמה עודכנה. מעכשיו מתחברים עם הסיסמה החדשה.</Notice>
            <Button type="button" onClick={() => router.replace("/")}>
              להמשך
            </Button>
          </>
        ) : !session ? (
          <>
            <Notice kind="error">
              {linkError
                ? "הקישור פג תוקף או שכבר נעשה בו שימוש. בקש קישור חדש ממסך ההתחברות."
                : "לא זוהה קישור תקף לאיפוס סיסמה. בקש קישור חדש ממסך ההתחברות."}
            </Notice>
            <Button type="button" variant="secondary" onClick={() => router.replace("/login")}>
              למסך ההתחברות
            </Button>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {error ? <Notice kind="error">{error}</Notice> : null}
            <p className="text-sm text-slate-600" dir="auto">
              {session.user.email}
            </p>
            <Field label="סיסמה חדשה" htmlFor="new-password" hint="לפחות 8 תווים">
              <TextInput
                id="new-password"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="שוב, לאימות" htmlFor="confirm-password">
              <TextInput
                id="confirm-password"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "שומר…" : "שמירת הסיסמה"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}

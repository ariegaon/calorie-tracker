"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SettingsShell } from "@/components/SettingsShell";
import { DeleteAccountCard } from "@/components/DeleteAccountCard";
import { Button, Card, Field, Notice, TextInput } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";

export default function AccountPage() {
  return <SettingsShell title="חשבון">{(_userId, email) => <Account email={email} />}</SettingsShell>;
}

function Account({ email }: { email: string | null }) {
  const router = useRouter();

  async function signOut() {
    try {
      await getSupabase().auth.signOut();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <>
      <Card className="space-y-1">
        <h2 className="font-semibold">מחובר כ-</h2>
        <p dir="ltr" className="text-right">
          {email}
        </p>
      </Card>
      <ChangePasswordCard email={email} />
      <Button type="button" variant="dangerGhost" onClick={() => void signOut()}>
        התנתקות
      </Button>
      <DeleteAccountCard onDeleted={() => router.replace("/login")} />
    </>
  );
}

/** Collapsed to a link until asked for. The current password is checked before the new one is saved. */
function ChangePasswordCard({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendReset() {
    setError(null);
    if (!email) {
      setError("לא הצלחנו לזהות את החשבון. התחבר מחדש ונסה שוב.");
      return;
    }
    setBusy(true);
    try {
      const { error: resetError } = await getSupabase().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        setError(
          resetError.message.toLowerCase().includes("rate limit")
            ? "יותר מדי ניסיונות. נסה שוב בעוד כמה דקות"
            : "שליחת המייל נכשלה. נסה שוב",
        );
        return;
      }
      close();
      setNotice(`שלחנו קישור לבחירת סיסמה חדשה אל ${email}. הקישור נפתח בדפדפן; אחרי השמירה חוזרים לאפליקציה.`);
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setCurrent("");
    setPassword("");
    setConfirm("");
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!email) {
      setError("לא הצלחנו לזהות את החשבון. התחבר מחדש ונסה שוב.");
      return;
    }
    if (current === "") {
      setError("יש להזין את הסיסמה הנוכחית");
      return;
    }
    if (password.length < 8) {
      setError("הסיסמה החדשה צריכה להכיל לפחות 8 תווים");
      return;
    }
    if (password !== confirm) {
      setError("שתי הסיסמאות החדשות אינן זהות");
      return;
    }
    if (password === current) {
      setError("הסיסמה החדשה זהה לנוכחית. בחר סיסמה אחרת");
      return;
    }
    setBusy(true);
    try {
      const auth = getSupabase().auth;
      // Proves the person holding the phone knows the password, not just that the app is signed in.
      const { error: checkError } = await auth.signInWithPassword({ email, password: current });
      if (checkError) {
        setError(
          checkError.message.toLowerCase().includes("rate limit")
            ? "יותר מדי ניסיונות. נסה שוב בעוד כמה דקות"
            : "הסיסמה הנוכחית שגויה",
        );
        return;
      }
      const { error: updateError } = await auth.updateUser({ password });
      if (updateError) {
        setError("שמירת הסיסמה נכשלה. נסה שוב");
        return;
      }
      close();
      setNotice("הסיסמה עודכנה.");
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        {notice ? <Notice kind="success">{notice}</Notice> : null}
        <button
          type="button"
          className="text-sm font-medium text-emerald-700 underline"
          onClick={() => {
            setNotice(null);
            setOpen(true);
          }}
        >
          החלפת סיסמה
        </button>
      </div>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <h2 className="font-semibold">החלפת סיסמה</h2>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <Field label="סיסמה נוכחית" htmlFor="current-password">
          <TextInput
            id="current-password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void sendReset()}
            className="text-sm font-medium text-emerald-700 underline disabled:opacity-50"
          >
            שכחתי את הסיסמה הנוכחית
          </button>
        </Field>
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
        <Field label="סיסמה חדשה שוב, לאימות" htmlFor="confirm-new-password">
          <TextInput
            id="confirm-new-password"
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
        <Button type="button" variant="ghost" disabled={busy} onClick={close}>
          ביטול
        </Button>
      </form>
    </Card>
  );
}

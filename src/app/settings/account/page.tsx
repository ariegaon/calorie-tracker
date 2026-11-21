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
      <ChangePasswordCard />
      <Button type="button" variant="dangerGhost" onClick={() => void signOut()}>
        התנתקות
      </Button>
      <DeleteAccountCard onDeleted={() => router.replace("/login")} />
    </>
  );
}

function ChangePasswordCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
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
        setNotice("הסיסמה עודכנה.");
        setPassword("");
        setConfirm("");
      }
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <h2 className="font-semibold">החלפת סיסמה</h2>
        {error ? <Notice kind="error">{error}</Notice> : null}
        {notice ? <Notice kind="success">{notice}</Notice> : null}
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
        <Field label="שוב, לאימות" htmlFor="confirm-new-password">
          <TextInput
            id="confirm-new-password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? "שומר…" : "שמירת הסיסמה"}
        </Button>
      </form>
    </Card>
  );
}

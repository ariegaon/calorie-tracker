"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button, Card, Field, FullPageMessage, Notice, TextInput } from "@/components/ui";

type Mode = "signin" | "signup";

function translateAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) return "האימייל או הסיסמה שגויים";
  if (text.includes("email not confirmed")) return "האימייל עדיין לא אומת. בדוק את תיבת הדואר שלך";
  if (text.includes("already registered")) return "כבר קיים חשבון עם האימייל הזה";
  if (text.includes("rate limit")) return "יותר מדי ניסיונות. נסה שוב בעוד כמה דקות";
  if (text.includes("password")) return "הסיסמה חלשה מדי. נדרשים לפחות 8 תווים";
  return "משהו השתבש. נסה שוב";
}

export default function LoginPage() {
  const router = useRouter();
  const { session, loading, error: authError } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (session) router.replace("/");
  }, [session, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    const cleanEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError("יש להזין כתובת אימייל תקינה");
      return;
    }
    if (password.length < 8) {
      setError("הסיסמה צריכה להכיל לפחות 8 תווים");
      return;
    }

    setBusy(true);
    try {
      const supabase = getSupabase();
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (signInError) setError(translateAuthError(signInError.message));
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) setError(translateAuthError(signUpError.message));
        else if (!data.session) {
          setInfo("שלחנו אליך מייל אימות. לחץ על הקישור שבו, ואז חזור לכאן והתחבר.");
          setMode("signin");
        }
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
        <p className="text-slate-600">תזונה, פעילות ומשקל במקום אחד</p>
      </header>

      <Card>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <h2 className="text-lg font-semibold">{mode === "signin" ? "התחברות" : "יצירת חשבון"}</h2>

          {authError ? <Notice kind="error">{authError}</Notice> : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          {info ? <Notice kind="success">{info}</Notice> : null}

          <Field label="אימייל" htmlFor="email">
            <TextInput
              id="email"
              type="email"
              dir="ltr"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field
            label="סיסמה"
            htmlFor="password"
            hint={mode === "signup" ? "לפחות 8 תווים" : undefined}
          >
            <TextInput
              id="password"
              type="password"
              dir="ltr"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <Button type="submit" disabled={busy}>
            {busy ? "רגע…" : mode === "signin" ? "התחבר" : "צור חשבון"}
          </Button>
        </form>
      </Card>

      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setInfo(null);
        }}
      >
        {mode === "signin" ? "אין לך חשבון? צור חשבון" : "יש לך חשבון? התחבר"}
      </Button>
    </main>
  );
}

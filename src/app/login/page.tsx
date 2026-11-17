"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button, Card, Field, FullPageMessage, Notice, TextInput } from "@/components/ui";

type Mode = "signin" | "signup" | "verify";

const RESEND_SECONDS = 60;

function translateAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) return "האימייל או הסיסמה שגויים";
  if (text.includes("email not confirmed")) return "האימייל עדיין לא אומת. בדוק את תיבת הדואר שלך";
  if (text.includes("already registered")) return "כבר קיים חשבון עם האימייל הזה";
  if (text.includes("expired") || text.includes("invalid") || text.includes("otp")) return "הקוד שגוי או שפג תוקפו. בדוק שוב או בקש קוד חדש";
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
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (session) router.replace("/");
  }, [session, router]);

  // Countdown before another code can be requested.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  function goToVerify(message: string) {
    setMode("verify");
    setCode("");
    setPassword("");
    setInfo(message);
    setResendIn(RESEND_SECONDS);
  }

  // The confirmation email carries a code (not a link), so signing up never leaves the app.
  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const token = code.replace(/\D/g, "");
    if (token.length < 6) {
      setError("הקוד מכיל 6 ספרות. העתק אותו מהמייל");
      return;
    }
    setBusy(true);
    try {
      const auth = getSupabase().auth;
      const cleanEmail = email.trim();
      let { error: verifyError } = await auth.verifyOtp({ email: cleanEmail, token, type: "signup" });
      if (verifyError) ({ error: verifyError } = await auth.verifyOtp({ email: cleanEmail, token, type: "email" }));
      if (verifyError) setError(translateAuthError(verifyError.message));
      // On success the session arrives and the effect above moves on to the home screen.
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const { error: resendError } = await getSupabase().auth.resend({ type: "signup", email: email.trim() });
      if (resendError) setError(translateAuthError(resendError.message));
      else {
        setInfo("שלחנו קוד חדש. הקוד הקודם כבר לא תקף.");
        setResendIn(RESEND_SECONDS);
      }
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב");
    } finally {
      setBusy(false);
    }
  }

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
        if (signInError?.message.toLowerCase().includes("email not confirmed")) {
          // Signed up earlier but never entered the code: send a fresh one and ask for it here.
          const { error: resendError } = await supabase.auth.resend({ type: "signup", email: cleanEmail });
          if (resendError) setError(translateAuthError(resendError.message));
          else goToVerify("החשבון עוד לא אומת. שלחנו אליך קוד חדש במייל, הזן אותו כאן.");
        } else if (signInError) setError(translateAuthError(signInError.message));
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({ email: cleanEmail, password });
        if (signUpError) setError(translateAuthError(signUpError.message));
        else if (!data.session) goToVerify("שלחנו אליך מייל עם קוד אימות. הזן אותו כאן כדי להמשיך.");
      }
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב");
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    setError(null);
    setInfo(null);
    const cleanEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError("הזן קודם את האימייל של החשבון, ואז לחץ שוב על \"שכחתי סיסמה\"");
      return;
    }
    setBusy(true);
    try {
      const { error: resetError } = await getSupabase().auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) setError(translateAuthError(resetError.message));
      else setInfo("אם קיים חשבון עם האימייל הזה, נשלח אליו קישור לבחירת סיסמה חדשה.");
    } catch {
      setError("אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <FullPageMessage>טוען…</FullPageMessage>;

  if (mode === "verify") {
    return (
      <main className="space-y-6 pt-8">
        <header className="space-y-1 text-center">
          <h1 className="text-3xl font-bold text-emerald-700">מאזן קלורי</h1>
        </header>

        <Card>
          <form onSubmit={verifyCode} noValidate className="space-y-4">
            <h2 className="text-lg font-semibold">אימות האימייל</h2>
            {error ? <Notice kind="error">{error}</Notice> : null}
            {info ? <Notice kind="success">{info}</Notice> : null}
            <p className="text-sm text-slate-600">
              הקוד נשלח אל{" "}
              <span dir="ltr" className="font-semibold">
                {email.trim()}
              </span>
              . אם לא הגיע תוך דקה, בדוק גם בתיקיית הספאם.
            </p>
            <Field label="קוד אימות" htmlFor="code">
              <TextInput
                id="code"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                className="text-center text-2xl tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "רגע…" : "אימות והמשך"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-emerald-700 underline disabled:text-slate-400 disabled:no-underline"
              disabled={busy || resendIn > 0}
              onClick={resendCode}
            >
              {resendIn > 0 ? `אפשר לבקש קוד חדש בעוד ${resendIn} שניות` : "שלח קוד חדש"}
            </button>
          </form>
        </Card>

        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setMode("signin");
            setError(null);
            setInfo(null);
          }}
        >
          חזרה להתחברות
        </Button>
      </main>
    );
  }

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

          {mode === "signin" ? (
            <button
              type="button"
              className="w-full text-center text-sm text-emerald-700 underline disabled:opacity-50"
              disabled={busy}
              onClick={sendReset}
            >
              שכחתי סיסמה
            </button>
          ) : null}
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

"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";

type AuthState = {
  session: Session | null;
  loading: boolean;
  error: string | null;
};

const AuthContext = createContext<AuthState>({ session: null, loading: true, error: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true, error: null });

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (e) {
      setState({ session: null, loading: false, error: e instanceof Error ? e.message : "שגיאה" });
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data }) => setState({ session: data.session, loading: false, error: null }))
      .catch(() => setState({ session: null, loading: false, error: "לא הצלחנו לבדוק את ההתחברות" }));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, loading: false, error: null });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

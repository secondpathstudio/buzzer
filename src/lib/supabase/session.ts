import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./client";

let pending: Promise<Session> | undefined;

// Returns the current session, signing in anonymously if there isn't one.
// Concurrent callers share a single sign-in request.
export function ensureSession(captchaToken?: string): Promise<Session> {
  pending ??= (async () => {
    const supabase = getSupabase();

    const { data } = await supabase.auth.getSession();
    if (data.session) {
      // A stored session can outlive its user (e.g. the cleanup cron job
      // deleted it). Check it's still valid before trusting it.
      const { error } = await supabase.auth.getUser();
      if (!error) return data.session;
      await supabase.auth.signOut({ scope: "local" });
    }

    const { data: signIn, error } = await supabase.auth.signInAnonymously({
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error || !signIn.session) throw error ?? new Error("sign_in_failed");
    return signIn.session;
  })().finally(() => {
    pending = undefined;
  });

  return pending;
}

// Email sign-in for hosts, with one-time codes (no magic links, so the code
// works whichever device reads the email). Linking keeps the anonymous
// user's id, so rooms, media, templates and TV pairings all carry over.
import { getSupabase } from "./client";
import { ensureSession } from "./session";

/** The signed-in host's email, or null for an anonymous (or no) session. */
export async function currentEmail(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  const user = data.session?.user;
  return user && !user.is_anonymous ? (user.email ?? null) : null;
}

/** Whether this browser's anonymous user has anything that signing in would leave behind. */
export async function hasAnonymousData(): Promise<boolean> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user?.is_anonymous) return false;
  const [rooms, media] = await Promise.all([
    supabase.from("rooms").select("id", { count: "exact", head: true }).eq("host_id", user.id),
    supabase.from("media_assets").select("id", { count: "exact", head: true }),
  ]);
  return (rooms.count ?? 0) + (media.count ?? 0) > 0;
}

/** Step 1 of adding an email to this browser's user: emails a code. */
export async function startLinkEmail(email: string) {
  await ensureSession();
  const { error } = await getSupabase().auth.updateUser({ email });
  if (error) throw error;
}

/** Step 1 of signing in to an existing account: emails a code. */
export async function startSignIn(email: string) {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

/** Step 2 of either flow. */
export async function confirmCode(mode: "link" | "signin", email: string, code: string) {
  const { error } = await getSupabase().auth.verifyOtp({
    email,
    token: code,
    type: mode === "link" ? "email_change" : "email",
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await getSupabase().auth.signOut({ scope: "local" });
  if (error) throw error;
}

export function accountErrorMessage(err: unknown): string {
  const e = err as { code?: string; status?: number; message?: string } | null;
  switch (e?.code) {
    case "email_exists":
      return "That email already has an account. Use “Sign in” instead.";
    case "otp_disabled":
    case "signup_disabled":
    case "user_not_found":
      return "No account uses that email. On the computer you usually use, choose “Add email” first.";
    case "otp_expired":
      return "That code is wrong or has expired. Check the latest email, or send a new code.";
    case "over_email_send_rate_limit":
      return "Too many emails sent recently. Wait a few minutes and try again.";
    case "email_address_invalid":
    case "validation_failed":
      return "Enter a valid email address.";
  }
  if (e?.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  // Usually a project setting (SMTP, email templates); the details are in the console.
  console.error(err);
  if (e?.status === 500 && /sending/i.test(e.message ?? "")) {
    return "The code email couldn't be sent. Check the email (SMTP) settings in Supabase.";
  }
  return "Something went wrong. Please try again.";
}

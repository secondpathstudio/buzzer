"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ensureSession } from "@/lib/supabase/session";

/** Signs in anonymously if needed. `session` is undefined until ready. */
export function useSession() {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    ensureSession().then(setSession, setError);
  }, []);

  return { session, error };
}

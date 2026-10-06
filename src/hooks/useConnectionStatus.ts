"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

export type ConnectionStatus = "online" | "offline" | "reconnecting";

// How long the realtime socket can be down before we say so. Covers the
// initial connect and brief blips (e.g. a phone waking from sleep).
const GRACE_MS = 4000;

/** For pages with realtime subscriptions: is the browser and socket connected? */
export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>("online");

  useEffect(() => {
    const realtime = getSupabase().realtime;
    let downSince: number | undefined;

    const check = () => {
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      if (realtime.isConnected()) {
        downSince = undefined;
        setStatus("online");
        return;
      }
      downSince ??= Date.now();
      if (Date.now() - downSince > GRACE_MS) setStatus("reconnecting");
    };

    const interval = setInterval(check, 1000);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);

  return status;
}

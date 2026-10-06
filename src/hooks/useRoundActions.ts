"use client";

import { useCallback, useRef, useState } from "react";
import { errorCode, errorMessage } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";

export type RoundAction = "open_round" | "lock_round" | "reset_round";

/** Host round controls, shared by the host panel and display mode. */
export function useRoundActions(roomId: string) {
  const [pending, setPending] = useState<RoundAction>();
  const [error, setError] = useState<string>();
  const busy = useRef(false);

  const run = useCallback(
    async (action: RoundAction) => {
      // Ignore presses while a request is in flight (key repeat, double clicks).
      if (busy.current) return;
      busy.current = true;
      setPending(action);
      setError(undefined);
      const { error } = await getSupabase().rpc(action, { p_room_id: roomId });
      // round_not_open / round_not_waiting just mean the state already moved
      // on (e.g. from the other screen); realtime will catch us up.
      const code = errorCode(error);
      if (error && code !== "round_not_open" && code !== "round_not_waiting") {
        setError(errorMessage(error));
      }
      busy.current = false;
      setPending(undefined);
    },
    [roomId],
  );

  return { run, pending, error };
}

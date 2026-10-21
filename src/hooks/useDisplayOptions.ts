"use client";

import { useCallback, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Host: show the scoreboard, the QR overlay or the top students in display mode. Saved on the
 * room, so every display (this browser's or a paired TV) follows along.
 */
export function useDisplayOptions(roomId: string) {
  const [error, setError] = useState<string>();

  const set = useCallback(
    async (opts: { scores?: boolean; qr?: boolean; topStudents?: boolean }) => {
      setError(undefined);
      const { error } = await getSupabase().rpc("set_display_options", {
        p_room_id: roomId,
        p_scores: opts.scores,
        p_qr: opts.qr,
        p_top_students: opts.topStudents,
      });
      if (error) setError(errorMessage(error));
    },
    [roomId],
  );

  return { set, error };
}

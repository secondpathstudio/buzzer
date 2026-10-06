"use client";

import { useCallback, useState } from "react";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";

export type AwardTarget = { participantId: string } | { groupId: string };

/** Host points actions, shared by the host panel and display mode. */
export function usePointActions(room: Tables<"rooms">) {
  const [error, setError] = useState<string>();

  const award = useCallback(
    async (delta: number, target: AwardTarget, opts: { roundId?: string; reason?: string } = {}) => {
      setError(undefined);
      const { error } = await getSupabase().rpc("award_points", {
        p_room_id: room.id,
        p_delta: delta,
        p_participant_id: "participantId" in target ? target.participantId : undefined,
        p_group_id: "groupId" in target ? target.groupId : undefined,
        p_round_id: opts.roundId,
        p_reason: opts.reason || undefined,
      });
      if (error) setError(errorMessage(error, room));
      return !error;
    },
    [room],
  );

  const undo = useCallback(async () => {
    setError(undefined);
    const { error } = await getSupabase().rpc("undo_last_points", { p_room_id: room.id });
    if (error) setError(errorMessage(error, room));
  }, [room]);

  const reset = useCallback(async () => {
    setError(undefined);
    const { error } = await getSupabase().rpc("reset_points", { p_room_id: room.id });
    if (error) setError(errorMessage(error, room));
    return !error;
  }, [room]);

  return { award, undo, reset, error };
}

/** "+10" / "−5" */
export function formatDelta(delta: number) {
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

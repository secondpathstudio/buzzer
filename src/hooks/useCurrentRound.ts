"use client";

import type { Tables } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";
import { useLiveQuery } from "./useLiveQuery";

export type RoundStatus = "waiting" | "open" | "locked";
export type Round = Tables<"rounds"> & { status: RoundStatus };

/**
 * The room's current round. Any change to a round in the room triggers a
 * refetch, and the round is read through rooms.current_round_id in the same
 * query, so a Reset is picked up even if the rounds event arrives before the
 * rooms event.
 */
export function useCurrentRound(roomId: string | null | undefined) {
  return useLiveQuery({
    key: roomId,
    table: "rounds",
    filter: `room_id=eq.${roomId}`,
    fetch: async () => {
      const { data, error } = await getSupabase()
        .from("rooms")
        .select("current_round:rounds!rooms_current_round_fk(*)")
        .eq("id", roomId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.current_round ?? null) as Round | null;
    },
  });
}

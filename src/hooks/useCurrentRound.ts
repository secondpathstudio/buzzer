"use client";

import type { Tables } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";
import { useLiveQuery } from "./useLiveQuery";

export type RoundStatus = "waiting" | "open" | "locked";
export type Round = Tables<"rounds"> & { status: RoundStatus };

/** The room's current round, kept live via changes to any round in the room. */
export function useCurrentRound(room: Tables<"rooms"> | null | undefined) {
  const roundId = room?.current_round_id;
  return useLiveQuery({
    key: room && roundId ? `${room.id}:${roundId}` : null,
    table: "rounds",
    filter: `room_id=eq.${room?.id}`,
    fetch: async () => {
      const { data, error } = await getSupabase()
        .from("rounds")
        .select("*")
        .eq("id", roundId!)
        .maybeSingle();
      if (error) throw error;
      return data as Round | null;
    },
  });
}

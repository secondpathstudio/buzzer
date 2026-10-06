"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useLiveQuery } from "./useLiveQuery";

/**
 * Participants in join order. Realtime can't filter DELETE events, so
 * removals only show up on the next refetch; call `refetch` after removing.
 */
export function useParticipants(roomId: string | null | undefined) {
  return useLiveQuery({
    key: roomId,
    table: "participants",
    filter: `room_id=eq.${roomId}`,
    fetch: async () => {
      const { data, error } = await getSupabase()
        .from("participants")
        .select("*")
        .eq("room_id", roomId!)
        .order("joined_at");
      if (error) throw error;
      return data;
    },
  });
}

"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useLiveQuery } from "./useLiveQuery";

/**
 * Buzzes for a round in position order. Resubscribes when the round changes.
 * Listens to all events: removing a participant cascade-deletes their buzzes,
 * and those deletes do match the round_id filter (it's in the primary key).
 */
export function useBuzzes(roundId: string | null | undefined) {
  return useLiveQuery({
    key: roundId,
    table: "buzzes",
    filter: `round_id=eq.${roundId}`,
    fetch: async () => {
      const { data, error } = await getSupabase()
        .from("buzzes")
        .select("*")
        .eq("round_id", roundId!)
        .order("position");
      if (error) throw error;
      return data;
    },
  });
}

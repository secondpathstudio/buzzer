"use client";

import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { Tables } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";
import { useLiveQuery } from "./useLiveQuery";

export type GroupScore = {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  total: number;
  member_count: number;
};
export type IndividualScore = {
  participant_id: string;
  display_name: string;
  group_id: string | null;
  total: number;
};
/** get_scoreboard. Students get every group but only their own individual row. */
export type Scoreboard = { groups: GroupScore[]; individuals: IndividualScore[] };

export type PointEvent = Tables<"point_events">;

/**
 * Totals from get_scoreboard, refetched on every point_events change in the
 * room. Pass enabled = false while points are off: no subscription at all.
 */
export function useScoreboard(
  roomId: string | null | undefined,
  enabled: boolean,
  onEvent?: (payload: RealtimePostgresChangesPayload<PointEvent>) => void,
) {
  return useLiveQuery({
    key: enabled ? roomId : null,
    table: "point_events",
    filter: `room_id=eq.${roomId}`,
    fetch: async () => {
      const { data, error } = await getSupabase().rpc("get_scoreboard", { p_room_id: roomId! });
      if (error) throw error;
      return data as unknown as Scoreboard;
    },
    onEvent: onEvent as
      | ((payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void)
      | undefined,
  });
}

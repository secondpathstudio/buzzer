"use client";

import type { Tables } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";
import { useLiveQuery } from "./useLiveQuery";

export type Group = Tables<"groups">;

/**
 * The room's groups in display order. Pass enabled = false while groups are
 * off, so there's no subscription at all. Realtime can't filter DELETE
 * events by room_id, so after save_groups the host refetches and tells the
 * display tab (roomEvents "groups").
 */
export function useGroups(roomId: string | null | undefined, enabled: boolean) {
  return useLiveQuery({
    key: enabled ? roomId : null,
    table: "groups",
    filter: `room_id=eq.${roomId}`,
    fetch: async () => {
      const { data, error } = await getSupabase()
        .from("groups")
        .select("*")
        .eq("room_id", roomId!)
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

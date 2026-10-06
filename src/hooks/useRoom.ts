"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useLiveQuery } from "./useLiveQuery";

/** The room with this code, or null if it doesn't exist or isn't visible to us. */
export function useRoom(code: string | null) {
  return useLiveQuery({
    key: code,
    table: "rooms",
    filter: `code=eq.${code}`,
    event: "UPDATE",
    fetch: async () => {
      const { data, error } = await getSupabase()
        .from("rooms")
        .select("*")
        .eq("code", code!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

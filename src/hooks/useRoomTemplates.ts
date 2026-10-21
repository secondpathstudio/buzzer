"use client";

import { useCallback, useEffect, useState } from "react";
import type { Tables } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";

export type RoomTemplate = Tables<"room_templates">;

/** The host's saved room templates, by name. No realtime: only this host changes them. */
export function useRoomTemplates() {
  const [templates, setTemplates] = useState<RoomTemplate[]>();

  const load = useCallback(
    () =>
      getSupabase()
        .from("room_templates")
        .select("*")
        .order("name")
        .then(({ data, error }) => {
          if (!error) setTemplates(data);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refetch = useCallback(async () => {
    await load();
  }, [load]);

  return { templates, refetch };
}

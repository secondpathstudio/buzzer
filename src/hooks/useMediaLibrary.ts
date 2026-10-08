"use client";

import { useCallback, useEffect, useState } from "react";
import type { MediaAsset } from "@/lib/media";
import { getSupabase } from "@/lib/supabase/client";

/** The host's reveal media library, newest first. No realtime: only this host changes it. */
export function useMediaLibrary() {
  const [assets, setAssets] = useState<MediaAsset[]>();

  const load = useCallback(
    () =>
      getSupabase()
        .from("media_assets")
        .select("*")
        .order("created_at", { ascending: false })
        .then(({ data, error }) => {
          if (!error) setAssets(data);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refetch = useCallback(async () => {
    await load();
  }, [load]);

  return { assets, refetch };
}

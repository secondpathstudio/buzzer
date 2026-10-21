"use client";

import { useEffect, useState } from "react";
import type { Tables } from "@/lib/database.types";
import { type Media, type MediaKind, mediaUrl } from "@/lib/media";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Display mode's background, or null for the plain dark screen. Refetched
 * when the host picks a different one (the room row updates live).
 */
export function useDisplayBackground(room: Tables<"rooms">): Media | null {
  const mediaId = room.display_background_media_id;
  const [media, setMedia] = useState<{ id: string; media: Media | null }>();

  useEffect(() => {
    if (!mediaId) return;
    let cancelled = false;
    void getSupabase()
      .rpc("get_display_background", { p_room_id: room.id })
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const file = data as { path: string; kind: MediaKind } | null;
        setMedia({ id: mediaId, media: file ? { url: mediaUrl(file.path), kind: file.kind } : null });
      });
    return () => {
      cancelled = true;
    };
  }, [room.id, mediaId]);

  // Never show a stale file after it's cleared or changed.
  return mediaId && media?.id === mediaId ? media.media : null;
}

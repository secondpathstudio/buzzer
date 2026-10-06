"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { FeatureKey } from "@/lib/features";
import { getSupabase } from "@/lib/supabase/client";

export type Entitlements = {
  plan: string;
  features: FeatureKey[];
  max_participants: number;
};

export type RoomEntitlements = {
  /** Undefined until loaded. */
  entitlements: Entitlements | undefined;
  /** False while loading, so gated UI stays hidden rather than flashing a prompt. */
  has: (feature: FeatureKey) => boolean;
  loading: boolean;
  refetch: () => Promise<void>;
};

/** Host only: which gated features this room has (plan features ∪ room grants). */
export function useRoomEntitlements(roomId: string | null | undefined): RoomEntitlements {
  const [result, setResult] = useState<{ roomId: string; entitlements: Entitlements }>();

  const load = useCallback(
    (id: string) =>
      getSupabase()
        .rpc("get_room_entitlements", { p_room_id: id })
        .then(({ data, error }) => {
          // On failure, keep what we had; gated UI just stays hidden.
          if (!error && data) setResult({ roomId: id, entitlements: data as unknown as Entitlements });
        }),
    [],
  );

  useEffect(() => {
    if (roomId) void load(roomId);
  }, [roomId, load]);

  const refetch = useCallback(async () => {
    if (roomId) await load(roomId);
  }, [roomId, load]);

  const entitlements = roomId && result?.roomId === roomId ? result.entitlements : undefined;
  const has = useCallback(
    (feature: FeatureKey) => !!entitlements?.features.includes(feature),
    [entitlements],
  );

  return { entitlements, has, loading: !!roomId && !entitlements, refetch };
}

export const EntitlementsContext = createContext<RoomEntitlements | null>(null);

export function useEntitlements(): RoomEntitlements {
  const value = useContext(EntitlementsContext);
  if (!value) throw new Error("useEntitlements needs an EntitlementsContext provider");
  return value;
}

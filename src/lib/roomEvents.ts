"use client";

import { useEffect, useRef } from "react";
import { getSupabase } from "@/lib/supabase/client";

// Some changes never reach a room_id-filtered subscription: DELETE events
// only carry the row's id. When the host removes a participant or deletes a
// group, we tell display mode directly. A display tab in the host's browser
// hears it over BroadcastChannel; a paired TV on another device hears it
// over a Realtime broadcast. The message is only a "refetch" hint, so it
// doesn't matter who else could send one.
export type RoomTopic = "participants" | "groups";

const EVENT = "changed";

function channelName(roomId: string) {
  return `buzzer:${roomId}`;
}

export function notifyRoomChanged(roomId: string, topic: RoomTopic) {
  const name = channelName(roomId);
  if (typeof BroadcastChannel !== "undefined") {
    const local = new BroadcastChannel(name);
    local.postMessage(topic);
    local.close();
  }
  const supabase = getSupabase();
  const remote = supabase.channel(name);
  remote
    .httpSend(EVENT, { topic })
    .catch(() => {})
    .finally(() => void supabase.removeChannel(remote));
}

export const notifyParticipantsChanged = (roomId: string) =>
  notifyRoomChanged(roomId, "participants");

/** Calls back with the topic whenever the host reports a change. Use once per page. */
export function useOnRoomChanged(roomId: string, callback: (topic: RoomTopic) => void) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const name = channelName(roomId);
    let local: BroadcastChannel | undefined;
    if (typeof BroadcastChannel !== "undefined") {
      local = new BroadcastChannel(name);
      local.onmessage = (e: MessageEvent<RoomTopic>) => callbackRef.current(e.data);
    }
    const supabase = getSupabase();
    const remote = supabase
      .channel(name)
      .on("broadcast", { event: EVENT }, ({ payload }) => {
        const topic = (payload as { topic?: RoomTopic } | undefined)?.topic;
        if (topic === "participants" || topic === "groups") callbackRef.current(topic);
      })
      .subscribe();
    return () => {
      local?.close();
      void supabase.removeChannel(remote);
    };
  }, [roomId]);
}

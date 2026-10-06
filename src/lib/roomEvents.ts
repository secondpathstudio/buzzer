"use client";

import { useEffect, useRef } from "react";

// A participants DELETE event only carries the row's id, so a room_id-filtered
// subscription never receives it. When the host removes someone, we tell the
// display tab directly. Both pages always run in the
// same browser (only the host's session can open them), so BroadcastChannel
// is enough.
function channelName(roomId: string) {
  return `buzzer:${roomId}:participants`;
}

export function notifyParticipantsChanged(roomId: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(channelName(roomId));
  channel.postMessage("changed");
  channel.close();
}

export function useOnParticipantsChanged(roomId: string, callback: () => void) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(channelName(roomId));
    channel.onmessage = () => callbackRef.current();
    return () => channel.close();
  }, [roomId]);
}

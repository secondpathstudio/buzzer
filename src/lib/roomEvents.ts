"use client";

import { useEffect, useRef } from "react";

// Some changes never reach a room_id-filtered subscription: DELETE events
// only carry the row's id. When the host removes a participant or deletes a
// group, we tell the display tab directly. Both pages always run in the
// same browser (only the host's session can open them), so
// BroadcastChannel is enough.
export type RoomTopic = "participants" | "groups";

function channelName(roomId: string, topic: RoomTopic) {
  return `buzzer:${roomId}:${topic}`;
}

export function notifyRoomChanged(roomId: string, topic: RoomTopic) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(channelName(roomId, topic));
  channel.postMessage("changed");
  channel.close();
}

export function useOnRoomChanged(roomId: string, topic: RoomTopic, callback: () => void) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(channelName(roomId, topic));
    channel.onmessage = () => callbackRef.current();
    return () => channel.close();
  }, [roomId, topic]);
}

export const notifyParticipantsChanged = (roomId: string) =>
  notifyRoomChanged(roomId, "participants");

export const useOnParticipantsChanged = (roomId: string, callback: () => void) =>
  useOnRoomChanged(roomId, "participants", callback);

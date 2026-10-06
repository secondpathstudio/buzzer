"use client";

import Link from "next/link";
import { useRoom } from "@/hooks/useRoom";
import { useSession } from "@/hooks/useSession";
import type { Tables } from "@/lib/database.types";
import { buttonClass, Message } from "./ui";

/**
 * Renders children only for the room's host. The database enforces this too
 * (host RPCs check auth.uid()); this just shows a friendly screen instead.
 */
export function HostGate({
  code,
  children,
}: {
  code: string;
  children: (room: Tables<"rooms">) => React.ReactNode;
}) {
  const { session, error: sessionError } = useSession();
  const { data: room, loading } = useRoom(session ? code : null);

  if (sessionError) {
    return <Message title="Couldn't connect">Check your connection and reload the page.</Message>;
  }
  if (!session || loading) return <Message title="Loading…" />;

  if (!room || room.host_id !== session.user.id) {
    return (
      <Message title="You're not the host of this room">
        {room
          ? "This room was created in a different browser."
          : "The room doesn't exist, or it was created in a different browser."}{" "}
        Only the browser that created a room can control it.
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href={`/r/${code}`} className={buttonClass("primary")}>
            Join as a student
          </Link>
          <Link href="/" className={buttonClass("secondary")}>
            Create a room
          </Link>
        </div>
      </Message>
    );
  }

  if (new Date(room.expires_at) < new Date()) {
    return (
      <Message title="This room has expired">
        Rooms last 24 hours.
        <div className="mt-6">
          <Link href="/" className={buttonClass("primary")}>
            Create a new room
          </Link>
        </div>
      </Message>
    );
  }

  return children(room);
}

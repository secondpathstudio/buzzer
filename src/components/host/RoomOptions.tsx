"use client";

import { useState } from "react";
import type { Group } from "@/hooks/useGroups";
import type { Tables } from "@/lib/database.types";
import { GroupsSettings } from "./GroupsSettings";
import { PointsSettings } from "./PointsSettings";
import { RoomTemplates } from "./RoomTemplates";

const OPEN_KEY = "buzzer:room-options-open";

/**
 * Optional features, collapsed by default. Needs an EntitlementsContext
 * provider above it.
 */
export function RoomOptions({
  room,
  groups,
  onGroupsSaved,
}: {
  room: Tables<"rooms">;
  groups: Group[] | undefined;
  onGroupsSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(readOpen);

  return (
    <details
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          localStorage.setItem(OPEN_KEY, next ? "1" : "0");
        } catch {}
      }}
      className="group/options rounded-2xl border border-neutral-200 dark:border-neutral-800"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between p-6 text-lg font-semibold [&::-webkit-details-marker]:hidden">
        Room options
        <span aria-hidden className="text-neutral-400 transition-transform group-open/options:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-6 border-t border-neutral-200 p-6 dark:border-neutral-800">
        {/* Loading a template replaces groups, like saving them does. */}
        <RoomTemplates room={room} onApplied={onGroupsSaved} />
        <GroupsSettings room={room} groups={groups} onSaved={onGroupsSaved} />
        <PointsSettings room={room} />
      </div>
    </details>
  );
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

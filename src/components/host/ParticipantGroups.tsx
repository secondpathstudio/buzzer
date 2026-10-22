"use client";

import { useState } from "react";
import { GroupChip } from "@/components/GroupChip";
import type { Group } from "@/hooks/useGroups";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";
import { RemoveButton } from "./RemoveButton";

type Participant = Tables<"participants">;

/** The host's participant list, grouped under coloured headers. */
export function ParticipantGroups({
  room,
  groups,
  participants,
  onRemove,
}: {
  room: Tables<"rooms">;
  groups: Group[];
  participants: Participant[];
  onRemove: (participantId: string) => void;
}) {
  const [error, setError] = useState<string>();
  const [shuffling, setShuffling] = useState(false);
  const plural = room.group_noun_plural.toLowerCase();

  const known = new Set(groups.map((g) => g.id));
  const sections = [
    ...groups.map((group) => ({
      key: group.id,
      group,
      members: participants.filter((p) => p.group_id === group.id),
    })),
    {
      key: "none",
      group: null,
      members: participants.filter((p) => !p.group_id || !known.has(p.group_id)),
    },
  ];

  async function move(participantId: string, groupId: string) {
    setError(undefined);
    const { error } = await getSupabase().rpc("move_participant", {
      p_participant_id: participantId,
      p_group_id: groupId === "none" ? undefined : groupId,
    });
    if (error) setError(errorMessage(error, room));
  }

  async function shuffle() {
    if (!window.confirm(`Shuffle everyone into random ${plural}? Everyone's current ${room.group_noun.toLowerCase()} changes.`)) {
      return;
    }
    setShuffling(true);
    setError(undefined);
    const { error } = await getSupabase().rpc("shuffle_groups", { p_room_id: room.id });
    setShuffling(false);
    if (error) setError(errorMessage(error, room));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={() => void shuffle()}
          disabled={shuffling || participants.length === 0}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-neutral-700"
        >
          {shuffling ? "Shuffling…" : "🔀 Shuffle"}
        </button>
      </div>
      {sections.map(
        ({ key, group, members }) =>
          (group || members.length > 0) && (
            <section key={key}>
              <h3 className="flex items-center gap-2">
                {group ? (
                  <GroupChip group={group} />
                ) : (
                  <span className="text-sm font-semibold text-neutral-500">No {room.group_noun.toLowerCase()}</span>
                )}
                <span className="text-sm text-neutral-500 tabular-nums">{members.length}</span>
              </h3>
              {members.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {members.map((p) => (
                    <li
                      key={p.id}
                      className="group flex items-center gap-1 rounded-full bg-neutral-100 py-1 pr-1 pl-3 text-sm dark:bg-neutral-900"
                    >
                      {p.display_name}
                      <select
                        value=""
                        onChange={(e) => void move(p.id, e.target.value)}
                        aria-label={`Move ${p.display_name} to another ${room.group_noun.toLowerCase()}`}
                        title="Move to…"
                        className="w-6 cursor-pointer appearance-none rounded-full bg-transparent text-center text-neutral-400 opacity-60 hover:bg-neutral-300 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-neutral-700"
                      >
                        <option value="" disabled hidden>
                          ⇄
                        </option>
                        <option value="" disabled>
                          Move to…
                        </option>
                        {groups
                          .filter((g) => g.id !== p.group_id)
                          .map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.emoji ? `${g.emoji} ` : ""}
                              {g.name}
                            </option>
                          ))}
                        {p.group_id && <option value="none">No {room.group_noun.toLowerCase()}</option>}
                      </select>
                      <RemoveButton name={p.display_name} onClick={() => onRemove(p.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ),
      )}
      {error && (
        <p role="alert" className="text-wine-400 dark:text-wine-300">
          {error}
        </p>
      )}
    </div>
  );
}

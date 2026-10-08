"use client";

import { useEffect, useRef, useState } from "react";
import { RevealPlayer } from "@/components/student/RevealPlayer";
import type { Group } from "@/hooks/useGroups";
import type { Media } from "@/lib/media";

/** Plays a group's reveal in a phone-sized frame, as a student would see it. */
export function RevealPreview({
  open,
  onClose,
  groups,
  mediaFor,
  noun,
  sortingText,
}: {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  mediaFor: (group: Group) => Media | null;
  noun: string;
  sortingText: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const [groupId, setGroupId] = useState<string>();
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);
  const group = groups.find((g) => g.id === groupId) ?? groups[0];

  function replay() {
    setDone(false);
    setRun((r) => r + 1);
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto rounded-2xl bg-white p-6 text-neutral-900 backdrop:bg-black/60 dark:bg-neutral-900 dark:text-neutral-100"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex w-full items-center justify-between gap-3">
          <select
            value={group?.id}
            onChange={(e) => {
              setGroupId(e.target.value);
              replay();
            }}
            aria-label={`Preview which ${noun.toLowerCase()}`}
            className="rounded-lg border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.emoji ? `${g.emoji} ` : ""}
                {g.name}
              </option>
            ))}
          </select>
          <button onClick={replay} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold dark:border-neutral-700">
            ↻ Replay
          </button>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none text-neutral-500">
            ×
          </button>
        </div>
        <div className="relative aspect-[9/19.5] h-[70vh] overflow-hidden rounded-[2rem] border-8 border-neutral-800 bg-white dark:bg-neutral-950">
          {open && group && !done && (
            <RevealPlayer
              key={`${run}:${group.id}`}
              group={{ ...group, media: mediaFor(group) }}
              groups={groups}
              noun={noun}
              sortingText={sortingText}
              black={groups.some((g) => mediaFor(g))}
              onDone={() => setDone(true)}
              contained
            />
          )}
          {done && (
            <div className="flex h-full items-center justify-center p-6 text-center text-neutral-500">
              The buzzer appears here.
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

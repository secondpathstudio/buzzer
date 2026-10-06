"use client";

import { GroupChip } from "@/components/GroupChip";
import type { AwardTarget } from "@/hooks/usePointActions";
import type { Scoreboard } from "@/hooks/useScoreboard";
import type { Tables } from "@/lib/database.types";
import { AwardButtons } from "./AwardButtons";

/**
 * Host scoreboard above the buzz list: group totals (with whole-group
 * awards) or, with groups off, the top students. Holds Undo last.
 */
export function PointsPanel({
  room,
  board,
  groupsOn,
  onAward,
  onUndo,
  error,
}: {
  room: Tables<"rooms">;
  board: Scoreboard | undefined;
  groupsOn: boolean;
  onAward: (delta: number, target: AwardTarget) => Promise<boolean>;
  onUndo: () => void;
  error: string | undefined;
}) {
  const groups = groupsOn ? (board?.groups ?? []) : [];
  const ranked = board?.individuals.filter((p) => p.total !== 0) ?? [];

  return (
    <div className="rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Points</h2>
        <button
          onClick={onUndo}
          className="rounded-lg border border-neutral-300 px-3 py-1 text-sm font-medium dark:border-neutral-700"
        >
          ↶ Undo last
        </button>
      </div>

      {groups.length > 0 && (
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-3">
              <GroupChip group={g} />
              <span className="min-w-12 font-mono text-xl font-bold tabular-nums">{g.total}</span>
              <span className="ml-auto">
                <AwardButtons
                  presets={room.point_presets}
                  label={g.name}
                  onAward={(delta) => onAward(delta, { groupId: g.id })}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className={groups.length > 0 ? "mt-4" : ""} open={groups.length === 0}>
        <summary className="cursor-pointer text-sm font-medium text-neutral-500">
          Students ({ranked.length} with points)
        </summary>
        {ranked.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No points yet. Use the buttons on each buzz.</p>
        ) : (
          <ol className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
            {ranked.map((p, i) => (
              <li key={p.participant_id} className="flex items-baseline gap-2">
                <span className="w-6 text-right font-mono text-neutral-500">{i + 1}</span>
                <span className="flex-1 truncate">{p.display_name}</span>
                <span className="font-mono font-semibold tabular-nums">{p.total}</span>
              </li>
            ))}
          </ol>
        )}
      </details>

      {error && (
        <p role="alert" className="mt-3 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

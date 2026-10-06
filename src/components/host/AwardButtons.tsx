"use client";

import { useState } from "react";
import { formatDelta } from "@/hooks/usePointActions";

/**
 * One tap to award or deduct: each preset as both −n and +n, smallest to
 * largest (e.g. −10 −5 −1 +1 +5 +10).
 */
export function AwardButtons({
  presets,
  onAward,
  label,
}: {
  presets: number[];
  onAward: (delta: number) => Promise<boolean>;
  /** Who gets the points, for screen readers. */
  label: string;
}) {
  const [pending, setPending] = useState(false);

  async function give(delta: number) {
    setPending(true);
    await onAward(delta);
    setPending(false);
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Points for ${label}`}>
      {deltas(presets).map((delta) => (
        <button
          key={delta}
          onClick={() => void give(delta)}
          disabled={pending}
          className={`rounded-lg px-2 py-1 text-sm font-semibold tabular-nums transition active:scale-95 disabled:opacity-40 ${
            delta < 0 ? "bg-red-600 text-white hover:bg-red-700" : "bg-green-700 text-white hover:bg-green-800"
          }`}
        >
          {formatDelta(delta)}
        </button>
      ))}
    </div>
  );
}

function deltas(presets: number[]) {
  const all = new Set(presets.flatMap((p) => [-Math.abs(p), Math.abs(p)]));
  return [...all].sort((a, b) => a - b);
}

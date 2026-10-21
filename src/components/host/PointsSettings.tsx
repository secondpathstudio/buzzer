"use client";

import { useState } from "react";
import { FeatureGate } from "@/components/FeatureGate";
import { Toggle } from "@/components/ui";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { useDisplayOptions } from "@/hooks/useDisplayOptions";
import { formatDelta } from "@/hooks/usePointActions";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { FEATURES } from "@/lib/features";
import { getSupabase } from "@/lib/supabase/client";

type Room = Tables<"rooms">;

const MAX_PRESETS = 6;
const LIMIT = 1000;

export function PointsSettings({ room }: { room: Room }) {
  const on = room.points_enabled;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setError(undefined);
    const { error } = await getSupabase().rpc("set_points_settings", {
      p_room_id: room.id,
      p_enabled: enabled,
    });
    setBusy(false);
    if (error) setError(errorMessage(error, room));
  }

  const toggle = <Toggle checked={on} onChange={setEnabled} disabled={busy} label="Points" />;

  return (
    <section className="flex flex-col gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Points</h3>
          <p className="text-sm text-neutral-500">{FEATURES.points.description}</p>
        </div>
        {/* Turning a feature off is never gated. */}
        {on ? toggle : (
          <FeatureGate feature="points" fallback={<UpgradePrompt feature="points" />}>
            {toggle}
          </FeatureGate>
        )}
      </div>
      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {on && <PointsEditor room={room} />}
    </section>
  );
}

function PointsEditor({ room }: { room: Room }) {
  // null = no unsaved edits. Inputs are strings so "-" can be typed.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const options = useDisplayOptions(room.id);

  const values = draft ?? room.point_presets.map(String);
  const parsed = values.map((v) => Number(v));
  const valid = parsed.every((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) <= LIMIT);

  async function save() {
    setSaving(true);
    setError(undefined);
    const { error } = await getSupabase().rpc("set_points_settings", {
      p_room_id: room.id,
      p_enabled: true,
      p_presets: parsed,
    });
    setSaving(false);
    if (error) setError(errorMessage(error, room));
    else setDraft(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm text-neutral-500">Quick-award amounts</p>
        <div className="flex flex-wrap items-center gap-2">
          {values.map((v, i) => (
            <span key={i} className="inline-flex items-center rounded-full bg-neutral-100 pr-1 dark:bg-neutral-900">
              <input
                value={v}
                onChange={(e) => setDraft(values.map((x, j) => (j === i ? e.target.value : x)))}
                inputMode="numeric"
                aria-label={`Quick-award amount ${i + 1}`}
                className="w-16 bg-transparent px-3 py-1.5 text-center font-semibold tabular-nums outline-none"
              />
              <button
                onClick={() => setDraft(values.filter((_, j) => j !== i))}
                disabled={values.length <= 1}
                aria-label={`Remove ${v}`}
                className="flex size-6 items-center justify-center rounded-full text-neutral-400 hover:bg-red-600 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
              >
                ×
              </button>
            </span>
          ))}
          {values.length < MAX_PRESETS && (
            <button
              onClick={() => setDraft([...values, String((parsed.at(-1) || 5) * 2)])}
              className="rounded-full border border-dashed border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
            >
              + Add
            </button>
          )}
        </div>
        {!valid && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">
            Use whole numbers between −{LIMIT} and {LIMIT}, not zero.
          </p>
        )}
        {draft && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void save()}
              disabled={!valid || saving}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              {saving ? "Saving…" : `Save (${parsed.filter(Boolean).map(formatDelta).join(" ")})`}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold dark:border-neutral-700"
            >
              Discard
            </button>
          </div>
        )}
      </div>
      {/* With groups off, the top students are the whole scoreboard. */}
      {room.groups_mode !== "off" && (
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block">Top students on the scoreboard</span>
            <span className="block text-sm text-neutral-500">
              The top 3 students under the {room.group_noun_plural.toLowerCase()} on the TV.
            </span>
          </span>
          <Toggle
            label="Top students on the scoreboard"
            checked={room.display_top_students}
            onChange={(topStudents) => void options.set({ topStudents })}
          />
        </label>
      )}
      {(error || options.error) && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {error ?? options.error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { FeatureGate } from "@/components/FeatureGate";
import { GroupChip } from "@/components/GroupChip";
import { Toggle } from "@/components/ui";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import type { Group } from "@/hooks/useGroups";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { FEATURES } from "@/lib/features";
import {
  deleteLocalPreset,
  GROUP_PALETTE,
  type GroupDraft,
  type GroupPreset,
  MAX_GROUPS,
  MIN_GROUPS,
  readLocalPresets,
  saveLocalPreset,
  SHIPPED_PRESETS,
} from "@/lib/groupPresets";
import { getSupabase } from "@/lib/supabase/client";

type Room = Tables<"rooms">;
type ActiveMode = "random" | "choose";

// The last non-off mode per room, so switching groups off and on restores it.
const modeKey = (roomId: string) => `buzzer:groups-mode:${roomId}`;
// Groups created the first time a host switches groups on.
const DEFAULT_PRESET = SHIPPED_PRESETS[1];

export function GroupsSettings({
  room,
  groups,
  onSaved,
}: {
  room: Room;
  groups: Group[] | undefined;
  onSaved: () => Promise<void>;
}) {
  const on = room.groups_mode !== "off";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function setEnabled(enable: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const supabase = getSupabase();
      if (enable) {
        // Turning off keeps the groups, so usually they're already there.
        const { count, error: countError } = await supabase
          .from("groups")
          .select("id", { count: "exact", head: true })
          .eq("room_id", room.id);
        if (countError) throw countError;
        if ((count ?? 0) < MIN_GROUPS) {
          const { error } = await supabase.rpc("save_groups", {
            p_room_id: room.id,
            p_groups: DEFAULT_PRESET.groups,
          });
          if (error) throw error;
        }
      }
      const { error } = await supabase.rpc("set_group_settings", {
        p_room_id: room.id,
        p_mode: enable ? readMode(room.id) : "off",
      });
      if (error) throw error;
      if (enable) await onSaved();
    } catch (err) {
      setError(errorMessage(err, room));
    } finally {
      setBusy(false);
    }
  }

  const toggle = <Toggle checked={on} onChange={setEnabled} disabled={busy} label="Groups" />;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Groups</h3>
          <p className="text-sm text-neutral-500">{FEATURES.groups.description}</p>
        </div>
        {/* Turning a feature off is never gated. */}
        {on ? toggle : (
          <FeatureGate feature="groups" fallback={<UpgradePrompt feature="groups" />}>
            {toggle}
          </FeatureGate>
        )}
      </div>
      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {on && <GroupsEditor room={room} groups={groups} onSaved={onSaved} />}
    </section>
  );
}

type Draft = { noun: string; plural: string; groups: GroupDraft[] };

function GroupsEditor({
  room,
  groups,
  onSaved,
}: {
  room: Room;
  groups: Group[] | undefined;
  onSaved: () => Promise<void>;
}) {
  // null = no unsaved edits; show what's in the database.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [localPresets, setLocalPresets] = useState(readLocalPresets);

  const current: Draft = draft ?? {
    noun: room.group_noun,
    plural: room.group_noun_plural,
    groups: (groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      emoji: g.emoji,
      reveal_media_id: g.reveal_media_id,
    })),
  };
  const edit = (fn: (d: Draft) => Draft) => setDraft(fn(current));
  const updateGroup = (i: number, patch: Partial<GroupDraft>) =>
    edit((d) => ({ ...d, groups: d.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));
  const noun = room.group_noun.toLowerCase();

  async function setMode(mode: ActiveMode) {
    if (mode === room.groups_mode) return;
    setModeBusy(true);
    setError(undefined);
    const { error } = await getSupabase().rpc("set_group_settings", {
      p_room_id: room.id,
      p_mode: mode,
    });
    setModeBusy(false);
    if (error) setError(errorMessage(error, room));
    else writeMode(room.id, mode);
  }

  function moveGroup(i: number, by: -1 | 1) {
    edit((d) => {
      const next = [...d.groups];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return { ...d, groups: next };
    });
  }

  function addGroup() {
    edit((d) => {
      const used = new Set(d.groups.map((g) => g.color.toUpperCase()));
      const color = GROUP_PALETTE.find((c) => !used.has(c)) ?? GROUP_PALETTE[d.groups.length % GROUP_PALETTE.length];
      return {
        ...d,
        groups: [...d.groups, { name: `${d.noun} ${d.groups.length + 1}`, color, emoji: null }],
      };
    });
  }

  async function removeGroup(i: number) {
    const group = current.groups[i];
    if (group.id) {
      const { count } = await getSupabase()
        .from("point_events")
        .select("id", { count: "exact", head: true })
        .eq("group_id", group.id)
        .is("voided_at", null);
      if (
        count &&
        !window.confirm(
          `${group.name} has points. Saving without it removes its ${noun} points (students keep their own). Continue?`,
        )
      ) {
        return;
      }
    }
    edit((d) => ({ ...d, groups: d.groups.filter((_, j) => j !== i) }));
  }

  function applyPreset(preset: GroupPreset) {
    // Reuse existing ids by position, so students stay put in renamed groups.
    edit((d) => ({
      noun: preset.noun ?? d.noun,
      plural: preset.nounPlural ?? d.plural,
      groups: preset.groups.slice(0, MAX_GROUPS).map((g, i) => ({
        ...g,
        id: d.groups[i]?.id,
        reveal_media_id: g.reveal_media_id ?? null,
      })),
    }));
  }

  function saveAsPreset() {
    const name = window.prompt("Name this preset (saved in this browser only)", current.plural)?.trim();
    if (!name) return;
    if (
      localPresets.some((p) => p.name === name) &&
      !window.confirm(`Replace your saved preset "${name}"?`)
    ) {
      return;
    }
    setLocalPresets(
      saveLocalPreset({
        name,
        noun: current.noun,
        nounPlural: current.plural,
        groups: current.groups.map((g) => ({
          name: g.name,
          color: g.color,
          emoji: g.emoji,
          reveal_media_id: g.reveal_media_id ?? null,
        })),
      }),
    );
  }

  async function save() {
    if (current.groups.some((g) => !g.name.trim())) {
      setError(`Every ${noun} needs a name.`);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc("save_groups", {
        p_room_id: room.id,
        p_groups: current.groups.map((g) => ({
          ...(g.id ? { id: g.id } : {}),
          name: g.name.trim(),
          color: g.color,
          emoji: g.emoji?.trim() || null,
          ...(g.reveal_media_id !== undefined ? { reveal_media_id: g.reveal_media_id } : {}),
        })),
      });
      if (error) throw error;
      const noun = current.noun.trim() || "Group";
      const plural = current.plural.trim() || "Groups";
      if (noun !== room.group_noun || plural !== room.group_noun_plural) {
        const { error } = await supabase.rpc("set_group_settings", {
          p_room_id: room.id,
          p_mode: room.groups_mode,
          p_noun: noun,
          p_noun_plural: plural,
        });
        if (error) throw error;
      }
      await onSaved();
      setDraft(null);
    } catch (err) {
      setError(errorMessage(err, room));
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-100";
  const smallButton =
    "rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-700";

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
        Set up {room.group_noun_plural.toLowerCase()} before showing the QR code.
      </p>

      <div role="radiogroup" aria-label="How students get a group" className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-900">
        {(
          [
            ["random", "Random & even"],
            ["choose", "Students choose"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            role="radio"
            aria-checked={room.groups_mode === mode}
            disabled={modeBusy}
            onClick={() => void setMode(mode)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              room.groups_mode === mode
                ? "bg-white shadow dark:bg-neutral-700"
                : "text-neutral-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-neutral-500">
          Called (one)
          <input
            value={current.noun}
            onChange={(e) => edit((d) => ({ ...d, noun: e.target.value }))}
            placeholder="Group"
            maxLength={20}
            className={`${inputClass} text-neutral-900 dark:text-neutral-100`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-neutral-500">
          Called (many)
          <input
            value={current.plural}
            onChange={(e) => edit((d) => ({ ...d, plural: e.target.value }))}
            placeholder="Groups"
            maxLength={20}
            className={`${inputClass} text-neutral-900 dark:text-neutral-100`}
          />
        </label>
      </div>

      <ol className="flex flex-col gap-2">
        {current.groups.map((g, i) => (
          <li key={g.id ?? `new-${i}`} className="flex items-center gap-2">
            <input
              type="color"
              value={g.color}
              onChange={(e) => updateGroup(i, { color: e.target.value })}
              aria-label={`${g.name || noun} colour`}
              className="size-10 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
            />
            <input
              value={g.emoji ?? ""}
              onChange={(e) => updateGroup(i, { emoji: e.target.value || null })}
              placeholder="☺"
              aria-label={`${g.name || noun} emoji (optional)`}
              maxLength={8}
              className={`${inputClass} w-12 text-center`}
            />
            <input
              value={g.name}
              onChange={(e) => updateGroup(i, { name: e.target.value })}
              aria-label={`${room.group_noun} ${i + 1} name`}
              maxLength={30}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button
              onClick={() => moveGroup(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${g.name} up`}
              className="px-1 text-neutral-500 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              onClick={() => moveGroup(i, 1)}
              disabled={i === current.groups.length - 1}
              aria-label={`Move ${g.name} down`}
              className="px-1 text-neutral-500 disabled:opacity-30"
            >
              ↓
            </button>
            <button
              onClick={() => void removeGroup(i)}
              disabled={current.groups.length <= MIN_GROUPS}
              aria-label={`Delete ${g.name}`}
              title={current.groups.length <= MIN_GROUPS ? `At least ${MIN_GROUPS} needed` : "Delete"}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-red-600 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <button onClick={addGroup} disabled={current.groups.length >= MAX_GROUPS} className={smallButton}>
          + Add
        </button>
        <select
          value=""
          onChange={(e) => {
            const [kind, index] = e.target.value.split(":");
            const preset = (kind === "s" ? SHIPPED_PRESETS : localPresets)[Number(index)];
            if (preset) applyPreset(preset);
          }}
          aria-label="Apply a preset"
          className={`${smallButton} bg-transparent`}
        >
          <option value="">Apply a preset…</option>
          <optgroup label="Built in">
            {SHIPPED_PRESETS.map((p, i) => (
              <option key={p.name} value={`s:${i}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {localPresets.length > 0 && (
            <optgroup label="My presets">
              {localPresets.map((p, i) => (
                <option key={p.name} value={`l:${i}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button onClick={saveAsPreset} className={smallButton}>
          Save as my preset
        </button>
      </div>

      {localPresets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
          My presets:
          {localPresets.map((p) => (
            <span key={p.name} className="inline-flex items-center gap-1">
              <GroupChip
                group={{ name: p.name, color: p.groups[0]?.color ?? "#888888", emoji: p.groups[0]?.emoji ?? null }}
                className="text-xs"
              />
              <button
                onClick={() => {
                  if (window.confirm(`Delete your saved preset "${p.name}"?`)) {
                    setLocalPresets(deleteLocalPreset(p.name));
                  }
                }}
                aria-label={`Delete preset ${p.name}`}
                className="text-neutral-400 hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {draft && (
        <div className="flex gap-3">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex-1 rounded-xl bg-neutral-900 px-4 py-3 font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {saving ? "Saving…" : `Save ${room.group_noun_plural.toLowerCase()}`}
          </button>
          <button
            onClick={() => {
              setDraft(null);
              setError(undefined);
            }}
            disabled={saving}
            className="rounded-xl border border-neutral-300 px-4 py-3 font-semibold disabled:opacity-40 dark:border-neutral-700"
          >
            Discard
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function readMode(roomId: string): ActiveMode {
  try {
    return localStorage.getItem(modeKey(roomId)) === "choose" ? "choose" : "random";
  } catch {
    return "random";
  }
}

function writeMode(roomId: string, mode: ActiveMode) {
  try {
    localStorage.setItem(modeKey(roomId), mode);
  } catch {}
}

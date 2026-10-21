"use client";

import { useState } from "react";
import { useRoomTemplates } from "@/hooks/useRoomTemplates";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";

type Room = Tables<"rooms">;

const smallButton =
  "rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-700";

/**
 * Save this room's whole setup (groups, clips, points, display options)
 * as a named template on the server, or load one into this room.
 */
export function RoomTemplates({ room, onApplied }: { room: Room; onApplied: () => Promise<void> }) {
  const { templates, refetch } = useRoomTemplates();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setSaved(undefined);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, room));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const name = window.prompt("Name this template", room.title ?? "")?.trim();
    if (!name) return;
    if (
      templates?.some((t) => t.name === name) &&
      !window.confirm(`Replace your template "${name}" with this room's setup?`)
    ) {
      return;
    }
    void run(async () => {
      const { error } = await getSupabase().rpc("save_room_template", {
        p_room_id: room.id,
        p_name: name,
      });
      if (error) throw error;
      await refetch();
      setSaved(`Saved “${name}”.`);
    });
  }

  function load(templateId: string) {
    const template = templates?.find((t) => t.id === templateId);
    if (!template) return;
    if (
      !window.confirm(
        `Load “${template.name}” into this room? This replaces the room's ${room.group_noun_plural.toLowerCase()}, points and display settings. Students who already joined may be moved to a new ${room.group_noun.toLowerCase()}.`,
      )
    ) {
      return;
    }
    void run(async () => {
      const { error } = await getSupabase().rpc("apply_room_template", {
        p_room_id: room.id,
        p_template_id: template.id,
      });
      if (error) throw error;
      await onApplied();
      setSaved(`Loaded “${template.name}”.`);
    });
  }

  function remove(templateId: string, name: string) {
    if (!window.confirm(`Delete your template "${name}"? Rooms made from it aren't affected.`)) return;
    void run(async () => {
      const { error } = await getSupabase().rpc("delete_room_template", { p_template_id: templateId });
      if (error) throw error;
      await refetch();
    });
  }

  return (
    <section className="flex flex-col gap-4 border-b border-neutral-200 pb-6 dark:border-neutral-800">
      <div>
        <h3 className="font-semibold">Templates</h3>
        <p className="text-sm text-neutral-500">
          Save this room&apos;s setup, including {room.group_noun_plural.toLowerCase()}, clips and
          points, to reuse in later rooms.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className={smallButton}>
          Save as template
        </button>
        {templates && templates.length > 0 && (
          <select
            value=""
            disabled={busy}
            onChange={(e) => load(e.target.value)}
            aria-label="Load a template"
            className={`${smallButton} bg-transparent`}
          >
            <option value="">Load a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {templates && templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500">
          My templates:
          {templates.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              {t.name}
              <button
                onClick={() => remove(t.id, t.name)}
                disabled={busy}
                aria-label={`Delete template ${t.name}`}
                className="text-neutral-400 hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {saved && <p className="text-sm text-green-700 dark:text-green-400">{saved}</p>}
      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

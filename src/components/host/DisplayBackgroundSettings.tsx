"use client";

import { useEffect, useMemo, useState } from "react";
import { FeatureGate } from "@/components/FeatureGate";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { useMediaLibrary } from "@/hooks/useMediaLibrary";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import type { MediaAsset } from "@/lib/media";
import { getSupabase } from "@/lib/supabase/client";
import { MediaPicker, MediaThumb } from "./MediaPicker";

type Room = Tables<"rooms">;

/**
 * An image or looping video from the media library behind display mode,
 * on this browser's display and paired TVs.
 */
export function DisplayBackgroundSettings({ room }: { room: Room }) {
  return (
    <section className="flex flex-col gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <div>
        <h3 className="font-semibold">TV background</h3>
        <p className="text-sm text-neutral-500">
          An image or looping video behind display mode, dimmed so text stays readable.
        </p>
      </div>
      <FeatureGate feature="custom_media" fallback={<UpgradePrompt feature="custom_media" />}>
        <BackgroundEditor room={room} />
      </FeatureGate>
    </section>
  );
}

function BackgroundEditor({ room }: { room: Room }) {
  const { assets, refetch } = useMediaLibrary();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string>();

  const assetId = room.display_background_media_id;
  const asset = assetId ? assets?.find((a) => a.id === assetId) : undefined;
  const usage = useMemo(
    () => new Map(assetId ? [[assetId, ["TV background"]]] : []),
    [assetId],
  );

  async function choose(next: MediaAsset | null) {
    setError(undefined);
    const { error } = await getSupabase().rpc("set_display_background", {
      p_room_id: room.id,
      p_media_id: next?.id,
    });
    if (error) setError(errorMessage(error, room));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {asset ? (
          <MediaThumb asset={asset} className="aspect-video h-12 shrink-0 overflow-hidden rounded" />
        ) : (
          <span className="flex aspect-video h-12 shrink-0 items-center justify-center rounded border border-dashed border-neutral-300 text-xs text-neutral-400 dark:border-neutral-700">
            –
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">
          {asset ? (asset.label ?? "Untitled") : assetId && assets ? "Missing file" : "None"}
        </span>
        <button
          onClick={() => setPicking(true)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium dark:border-neutral-700"
        >
          Choose…
        </button>
        {assetId && (
          <button onClick={() => void choose(null)} className="text-sm text-neutral-500 underline">
            Clear
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500">Landscape works best. Videos loop without sound.</p>
      {assetId && <DimSlider room={room} onError={setError} />}

      {error && (
        <p role="alert" className="text-wine-400 dark:text-wine-300">
          {error}
        </p>
      )}

      <MediaPicker
        open={picking}
        title="TV background"
        assets={assets}
        selectedId={assetId}
        usage={usage}
        onChoose={(next) => {
          void choose(next);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
        onLibraryChanged={refetch}
      />
    </div>
  );
}

const SAVE_DELAY_MS = 250;

/** Overlay darkness. Saves shortly after dragging stops, so the TV follows along. */
function DimSlider({ room, onError }: { room: Room; onError: (error: string | undefined) => void }) {
  // The dragged value and the saved value it started from. It's shown while
  // the room row still has either, so the slider doesn't jump back while a
  // save is in flight, but follows a change made elsewhere (e.g. a template).
  const [draft, setDraft] = useState<{ value: number; base: number }>();
  const saved = room.display_background_dim;
  const value = draft && (saved === draft.base || saved === draft.value) ? draft.value : saved;
  const roomId = room.id;

  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(async () => {
      onError(undefined);
      const { error } = await getSupabase().rpc("set_display_background_dim", {
        p_room_id: roomId,
        p_dim: draft.value,
      });
      if (error) {
        onError(errorMessage(error));
        setDraft(undefined);
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, roomId, onError]);

  return (
    <label className="mt-2 flex items-center gap-3 text-sm">
      <span className="shrink-0">Darkness</span>
      <input
        type="range"
        min={0}
        max={90}
        step={5}
        value={value}
        onChange={(e) => setDraft({ value: Number(e.target.value), base: saved })}
        className="min-w-0 flex-1 accent-green-600"
      />
      <span className="w-10 shrink-0 text-right tabular-nums text-neutral-500">{value}%</span>
    </label>
  );
}

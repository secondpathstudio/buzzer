"use client";

import { useMemo, useState } from "react";
import { FeatureGate } from "@/components/FeatureGate";
import { GroupChip } from "@/components/GroupChip";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import type { Group } from "@/hooks/useGroups";
import { useMediaLibrary } from "@/hooks/useMediaLibrary";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { assetMedia, type MediaAsset } from "@/lib/media";
import { getSupabase } from "@/lib/supabase/client";
import { MediaPicker, MediaThumb } from "./MediaPicker";
import { RevealPreview } from "./RevealPreview";

/**
 * "Custom reveal (optional)": one clip per group, played on the student's
 * phone as the sorting moment. From the host's media library. Collapsed by
 * default.
 */
export function RevealMediaSettings({
  room,
  groups,
  onChanged,
}: {
  room: Tables<"rooms">;
  groups: Group[];
  onChanged: () => Promise<void>;
}) {
  return (
    <details className="group/reveal rounded-xl border border-neutral-200 dark:border-neutral-800">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        Custom reveal (optional)
        <span aria-hidden className="text-neutral-400 transition-transform group-open/reveal:rotate-180">
          ▾
        </span>
      </summary>
      <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        <FeatureGate feature="custom_media" fallback={<UpgradePrompt feature="custom_media" />}>
          <RevealMediaEditor room={room} groups={groups} onChanged={onChanged} />
        </FeatureGate>
      </div>
    </details>
  );
}

function RevealMediaEditor({
  room,
  groups,
  onChanged,
}: {
  room: Tables<"rooms">;
  groups: Group[];
  onChanged: () => Promise<void>;
}) {
  const { assets, refetch } = useMediaLibrary();
  const [target, setTarget] = useState<Group>();
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string>();

  const byId = useMemo(() => new Map(assets?.map((a) => [a.id, a])), [assets]);
  const usage = useMemo(() => {
    const map = new Map<string, string[]>();
    const add = (id: string | null, where: string) => {
      if (id) map.set(id, [...(map.get(id) ?? []), where]);
    };
    for (const g of groups) add(g.reveal_media_id, g.name);
    return map;
  }, [groups]);

  async function assign(group: Group, asset: MediaAsset | null) {
    setError(undefined);
    const { error } = await getSupabase().rpc("set_group_reveal_media", {
      p_group_id: group.id,
      p_media_id: asset?.id,
    });
    if (error) setError(errorMessage(error, room));
    else await onChanged();
  }

  const media = (id: string | null) => {
    const asset = id ? byId.get(id) : undefined;
    return asset ? assetMedia(asset) : null;
  };

  function slot(group: Group) {
    const assetId = group.reveal_media_id;
    const asset = assetId ? byId.get(assetId) : undefined;
    return (
      <div className="flex items-center gap-2">
        {asset ? (
          <MediaThumb asset={asset} className="h-12 w-9 shrink-0 overflow-hidden rounded" />
        ) : (
          <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded border border-dashed border-neutral-300 text-xs text-neutral-400 dark:border-neutral-700">
            –
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">
          {asset ? (asset.label ?? "Untitled") : assetId && assets ? "Missing file" : "Built-in"}
        </span>
        <button
          onClick={() => setTarget(group)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium dark:border-neutral-700"
        >
          Choose…
        </button>
        {assetId && (
          <button onClick={() => void assign(group, null)} className="text-sm text-neutral-500 underline">
            Clear
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-500">
        When a student is sorted, their phone plays their {room.group_noun.toLowerCase()}&apos;s
        clip. Leave a slot empty for the built-in reveal.
      </p>

      <ul className="flex flex-col gap-3">
        {groups.map((g) => (
          <li key={g.id} className="flex flex-col gap-1">
            <GroupChip group={g} className="self-start text-xs" />
            {slot(g)}
          </li>
        ))}
      </ul>

      <button
        onClick={() => setPreviewing(true)}
        disabled={groups.length === 0}
        className="self-start rounded-lg bg-wine-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-wine-400 dark:text-white"
      >
        ▶ Preview reveal
      </button>

      {error && (
        <p role="alert" className="text-wine-400 dark:text-wine-300">
          {error}
        </p>
      )}

      <MediaPicker
        open={!!target}
        title={`Clip for ${target?.name ?? ""}`}
        assets={assets}
        selectedId={target?.reveal_media_id ?? null}
        usage={usage}
        onChoose={(asset) => {
          if (target) void assign(target, asset);
          setTarget(undefined);
        }}
        onClose={() => setTarget(undefined)}
        onLibraryChanged={async () => {
          await refetch();
          await onChanged();
        }}
      />

      {previewing && (
        <RevealPreview
          open
          onClose={() => setPreviewing(false)}
          groups={groups}
          mediaFor={(g) => media(g.reveal_media_id)}
          noun={room.group_noun}
          sortingText={room.sorting_text}
        />
      )}
    </div>
  );
}

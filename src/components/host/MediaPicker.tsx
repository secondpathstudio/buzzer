"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import {
  assetMedia,
  checkFile,
  deleteMedia,
  MEDIA_ACCEPT,
  MEDIA_MAX_MB,
  MediaError,
  type MediaAsset,
  uploadMedia,
} from "@/lib/media";

/**
 * The host's media library as a grid (modal). Pick a file, upload a new one
 * (with a label and progress), or delete one.
 */
export function MediaPicker({
  open,
  title,
  assets,
  selectedId,
  usage,
  onChoose,
  onClose,
  onLibraryChanged,
}: {
  open: boolean;
  title: string;
  assets: MediaAsset[] | undefined;
  selectedId: string | null;
  /** asset id → where it's used in this room, e.g. ["Intro", "Red"] */
  usage: Map<string, string[]>;
  onChoose: (asset: MediaAsset) => void;
  onClose: () => void;
  onLibraryChanged: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const [file, setFile] = useState<File>();
  const [label, setLabel] = useState("");
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined) {
    setError(undefined);
    if (!f) return;
    const problem = checkFile(f);
    if (problem) {
      setError(problem);
      return;
    }
    setFile(f);
    setLabel(f.name.replace(/\.[^.]+$/, "").slice(0, 60));
  }

  async function upload() {
    if (!file) return;
    setError(undefined);
    setProgress(0);
    try {
      const asset = await uploadMedia(file, label, setProgress);
      await onLibraryChanged();
      setFile(undefined);
      onChoose(asset);
    } catch (err) {
      setError(err instanceof MediaError ? err.message : errorMessage(err));
    } finally {
      setProgress(undefined);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(asset: MediaAsset) {
    const usedBy = usage.get(asset.id);
    const name = asset.label ?? "this file";
    const message = usedBy?.length
      ? `Delete ${name}? Used by: ${usedBy.join(", ")}. Those will go back to the default.`
      : `Delete ${name} from your library?`;
    if (!window.confirm(message)) return;
    setError(undefined);
    try {
      await deleteMedia(asset.id);
      await onLibraryChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const uploading = progress !== undefined;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto w-[min(56rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-neutral-900 backdrop:bg-black/60 dark:bg-neutral-900 dark:text-neutral-100"
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none text-neutral-500">
            ×
          </button>
        </header>

        <div className="flex flex-col gap-3 border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          {file ? (
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                aria-label="Label"
                placeholder="Label, e.g. Red reveal"
                disabled={uploading}
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
              />
              <span className="text-sm text-neutral-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <button
                onClick={() => void upload()}
                disabled={uploading}
                className="rounded-lg bg-wine-500 px-4 py-2 font-semibold text-white disabled:opacity-40 dark:bg-wine-400 dark:text-white"
              >
                {uploading ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : "Upload"}
              </button>
              {!uploading && (
                <button onClick={() => setFile(undefined)} className="text-sm text-neutral-500 underline">
                  Cancel
                </button>
              )}
              {uploading && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <div
                    className="h-full bg-green-600 transition-[width]"
                    style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => fileInput.current?.click()}
                className="rounded-lg bg-wine-500 px-4 py-2 font-semibold text-white dark:bg-wine-400 dark:text-white"
              >
                Upload…
              </button>
              <span className="text-sm text-neutral-500">
                MP4, WebM, PNG, JPG, WebP or GIF, up to {MEDIA_MAX_MB} MB. A 5-second 720p MP4 is usually 1–2 MB.
              </span>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={MEDIA_ACCEPT}
            onChange={(e) => pick(e.target.files?.[0])}
            className="hidden"
          />
          {error && (
            <p role="alert" className="text-wine-400 dark:text-wine-300">
              {error}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {!assets ? (
            <p className="text-neutral-500">Loading…</p>
          ) : assets.length === 0 ? (
            <p className="text-neutral-500">Your library is empty. Upload a clip or image to get started.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {assets.map((asset) => {
                const usedBy = usage.get(asset.id);
                return (
                  <li key={asset.id} className="group relative">
                    <button
                      onClick={() => onChoose(asset)}
                      className={`block w-full overflow-hidden rounded-xl border-2 text-left ${
                        asset.id === selectedId
                          ? "border-green-600"
                          : "border-transparent hover:border-neutral-400"
                      }`}
                    >
                      <MediaThumb asset={asset} className="aspect-[3/4] w-full" />
                      <span className="block truncate px-2 py-1.5 text-sm font-medium">
                        {asset.label ?? "Untitled"}
                      </span>
                      {usedBy?.length ? (
                        <span className="block truncate px-2 pb-1.5 text-xs text-neutral-500">
                          {usedBy.join(", ")}
                        </span>
                      ) : null}
                    </button>
                    <button
                      onClick={() => void remove(asset)}
                      aria-label={`Delete ${asset.label ?? "file"}`}
                      className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 hover:bg-wine-400 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** The image itself, or a video's first frame. */
export function MediaThumb({
  asset,
  className = "",
}: {
  asset: Pick<MediaAsset, "storage_path" | "kind">;
  className?: string;
}) {
  const { url, kind } = assetMedia(asset);
  return (
    <span className={`relative block bg-neutral-900 ${className}`}>
      {kind === "video" ? (
        <>
          {/* #t=0.1 makes Safari paint the first frame */}
          <video src={`${url}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-contain" />
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-xs text-white">▶</span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- user media from storage
        <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" />
      )}
    </span>
  );
}

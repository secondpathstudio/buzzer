// Reveal media: limits, upload + register, public URLs (PLAN-groups-points.md §6).
import type { Tables } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";

export const MEDIA_BUCKET = "buzzer-bucket";
/** Must match the bucket's file_size_limit (the bucket is authoritative). */
export const MEDIA_MAX_MB = Number(process.env.NEXT_PUBLIC_MEDIA_MAX_MB) || 8;
export const MEDIA_MAX_BYTES = MEDIA_MAX_MB * 1024 * 1024;

export const MEDIA_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES).join(",");

export type MediaAsset = Tables<"media_assets">;
export type MediaKind = "image" | "video";
/** A resolved file to play. */
export type Media = { url: string; kind: MediaKind };

export function mediaUrl(path: string, bucket = MEDIA_BUCKET): string {
  return getSupabase().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export function assetMedia(asset: Pick<MediaAsset, "storage_path" | "kind">): Media {
  return { url: mediaUrl(asset.storage_path), kind: asset.kind as MediaKind };
}

export class MediaError extends Error {}

/** Friendly message for a file the bucket would reject, or undefined if it's fine. */
export function checkFile(file: File): string | undefined {
  if (!MEDIA_TYPES[file.type]) return "Use MP4, WebM, PNG, JPG, WebP or GIF.";
  if (file.size > MEDIA_MAX_BYTES) {
    return `Max ${MEDIA_MAX_MB} MB. Try a 5-second, 720p MP4 (usually 1–2 MB).`;
  }
}

/**
 * Upload to {uid}/{asset_id}.{ext} (never overwriting), then record it in
 * the host's library. If registering fails, the uploaded file is removed.
 * Uses XHR rather than supabase-js so we can report progress.
 */
export async function uploadMedia(
  file: File,
  label: string,
  onProgress: (fraction: number) => void,
): Promise<MediaAsset> {
  const problem = checkFile(file);
  if (problem) throw new MediaError(problem);

  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) throw new MediaError("Your session expired. Reload the page.");

  const assetId = crypto.randomUUID();
  const path = `${session.user.id}/${assetId}.${MEDIA_TYPES[file.type]}`;
  const durationMs = await measureDuration(file);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`,
    );
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("content-type", file.type);
    // Paths are unique per upload, so files never change: cache for a year.
    xhr.setRequestHeader("cache-control", "max-age=31536000");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(uploadError(xhr));
    xhr.onerror = () => reject(new MediaError("Upload failed. Check your connection and try again."));
    xhr.send(file);
  });

  const { data: asset, error } = await supabase.rpc("register_media_asset", {
    p_asset_id: assetId,
    p_storage_path: path,
    p_kind: file.type.split("/")[0],
    p_mime_type: file.type,
    p_bytes: file.size,
    p_label: label.trim() || undefined,
    p_duration_ms: durationMs,
  });
  if (error) {
    await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    throw error;
  }
  return asset;
}

/** Removes the library entry (references become null), then the file. */
export async function deleteMedia(assetId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: path, error } = await supabase.rpc("delete_media_asset", { p_asset_id: assetId });
  if (error) throw error;
  // An orphaned file is harmless (it's unreachable without its row).
  await supabase.storage.from(MEDIA_BUCKET).remove([path]);
}

function uploadError(xhr: XMLHttpRequest): Error {
  let body: { statusCode?: string; error?: string; message?: string } = {};
  try {
    body = JSON.parse(xhr.responseText);
  } catch {}
  const code = String(body.statusCode ?? xhr.status);
  const text = `${body.error ?? ""} ${body.message ?? ""}`;
  if (code === "413" || /too large|exceeded the maximum/i.test(text)) {
    return new MediaError(`File is larger than ${MEDIA_MAX_MB} MB.`);
  }
  if (code === "415" || /mime/i.test(text)) {
    return new MediaError("Use MP4, WebM, PNG, JPG, WebP or GIF.");
  }
  if (code === "403" || /row-level security/i.test(text)) {
    return new MediaError("Custom reveal media isn't enabled on this server.");
  }
  return new MediaError(`Upload failed (${body.message ?? xhr.status}).`);
}

/** Video length in ms, measured locally. Informational only. */
function measureDuration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith("video/")) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (ms?: number) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined);
    video.onerror = () => done(undefined);
    setTimeout(() => done(undefined), 3000);
    video.src = url;
  });
}

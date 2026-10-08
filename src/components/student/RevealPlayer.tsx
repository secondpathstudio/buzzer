"use client";

import { useEffect, useRef, useState } from "react";
import type { Media } from "@/lib/media";
import {
  GroupReveal,
  overlayClass,
  prefersReducedMotion,
  type RevealGroup,
  SuspenseScreen,
} from "./GroupReveal";

/** Without a clip, the suspense screen holds this long before the text reveal. */
const MIN_SUSPENSE_MS = 2000;
/** How long an image reveal stays up. */
const IMAGE_REVEAL_MS = 3000;
/** Clip not ready this long after we know the group → text reveal. */
const MEDIA_TIMEOUT_MS = 6000;
const SOUND_KEY = "buzzer:sound";

export type PlayerGroup = RevealGroup & { media: Media | null };

/**
 * Reveal sequence: the built-in suspense screen while we wait for the group
 * (join_room) and its clip to load, then the group's clip, which is the
 * sorting moment itself. Falls back to the built-in text reveal if there's
 * no clip, it fails, or it's too slow. Only the student's own clip is
 * downloaded. A join must never get stuck here: every path ends in onDone.
 *
 * group undefined = still joining (join_room hasn't returned).
 */
export function RevealPlayer({
  group,
  groups,
  noun,
  onDone,
  contained,
  suspense = true,
  sortingText,
  black,
}: {
  group: PlayerGroup | undefined;
  groups: RevealGroup[];
  noun: string;
  onDone: () => void;
  contained?: boolean;
  /**
   * Show "Assigning your…" while waiting. False for choose mode, where the
   * clip is just a confirmation of the student's own pick.
   */
  suspense?: boolean;
  /** The host's sorting message; null/undefined = the default. */
  sortingText?: string | null;
  /**
   * The room uses clips: keep the sorting screen and the area around the
   * clip black, so clips with black backgrounds blend in.
   */
  black?: boolean;
}) {
  // Reduced motion or Save-Data: skip media entirely.
  const [useMedia] = useState(() => !prefersReducedMotion() && !saveData());
  const clipMedia = useMedia ? (group?.media ?? null) : null;

  const [phase, setPhase] = useState<"pre" | "clip" | "text">("pre");
  const [clip, setClip] = useState<"loading" | "ready" | "failed">("loading");
  const [sound, setSound] = useState(readSound);

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const startedAt = useRef(0);
  const groupKnownAt = useRef(0);
  useEffect(() => {
    startedAt.current = performance.now();
  }, []);
  const groupId = group?.id;
  useEffect(() => {
    if (groupId) groupKnownAt.current = performance.now();
  }, [groupId]);

  // Decide when to leave the suspense screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (phase !== "pre" || !groupId) return;
    const now = performance.now();

    let next: "clip" | "text" | undefined;
    let wait = 0;
    if (!clipMedia || clip === "failed") {
      next = "text";
      wait = (suspense ? MIN_SUSPENSE_MS : 0) - (now - startedAt.current);
    } else if (clip === "ready") {
      next = "clip"; // the clip is the sorting moment: play it straight away
    } else {
      // Still loading: re-check when the timeout would expire.
      const timeoutLeft = MEDIA_TIMEOUT_MS - (now - groupKnownAt.current);
      if (timeoutLeft <= 0) next = "text";
      else wait = timeoutLeft;
    }

    const timer = setTimeout(() => {
      if (next) setPhase(next);
      else setTick((t) => t + 1);
    }, Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [phase, groupId, clipMedia, clip, suspense]);

  // Image reveals end on a timer; videos end on "ended".
  useEffect(() => {
    if (phase !== "clip" || clipMedia?.kind !== "image") return;
    const timer = setTimeout(() => onDoneRef.current(), IMAGE_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [phase, clipMedia]);

  const clipVideo = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = clipVideo.current;
    if (phase !== "clip" || !video) return;
    // Always from the first frame, even if the browser advanced the hidden preload.
    video.currentTime = 0;
    void video.play().catch(() => {});
  }, [phase]);

  if (phase === "text" && group) {
    return (
      <GroupReveal
        group={group}
        groups={groups}
        noun={noun}
        onDone={() => onDoneRef.current()}
        skipSuspense // the suspense screen (or colour, in choose mode) already showed
        contained={contained}
      />
    );
  }

  return (
    <div className={`${overlayClass(contained)} overflow-hidden bg-black`}>
      {phase === "pre" &&
        (suspense ? (
          <SuspenseScreen groups={groups} noun={noun} text={sortingText} black={black} contained />
        ) : (
          <div className="h-full w-full" style={{ backgroundColor: black ? "#000000" : group?.color }} />
        ))}

      {/* Preloads underneath as soon as we know the group; fades in when ready. */}
      {group && clipMedia && clip !== "failed" && (
        <div
          className={`absolute inset-0 transition-opacity duration-300 ${phase === "clip" ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <MediaView
            key={group.id}
            media={clipMedia}
            muted={!sound}
            onVideo={(el) => {
              clipVideo.current = el;
            }}
            background={black ? "#000000" : group.color}
            onReady={() => setClip((c) => (c === "loading" ? "ready" : c))}
            onError={() => {
              setClip("failed");
              if (phase === "clip") setPhase("text");
            }}
            onEnded={() => onDoneRef.current()}
          />
        </div>
      )}

      <div className="absolute top-4 right-4 z-10 flex gap-2">
        {phase === "clip" && clipMedia?.kind === "video" && !sound && (
          <button
            onClick={() => {
              setSound(true);
              writeSound();
            }}
            aria-label="Turn sound on"
            className="rounded-full bg-black/50 px-3 py-2 text-lg text-white backdrop-blur"
          >
            🔊
          </button>
        )}
        <button
          onClick={() => onDoneRef.current()}
          className="rounded-full bg-black/50 px-4 py-2 text-sm font-semibold text-white backdrop-blur"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function MediaView({
  media,
  muted,
  background,
  onVideo,
  onReady,
  onError,
  onEnded,
}: {
  media: Media;
  muted: boolean;
  background: string;
  onVideo?: (el: HTMLVideoElement | null) => void;
  onReady?: () => void;
  onError?: () => void;
  onEnded?: () => void;
}) {
  const className = "h-full w-full object-contain";
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: background }}>
      {media.kind === "video" ? (
        <video
          ref={(el) => {
            // iOS only plays inline without a tap if `muted` is set on the element itself.
            if (el) el.muted = el.defaultMuted = muted;
            onVideo?.(el);
          }}
          src={media.url}
          muted={muted}
          playsInline
          preload="auto"
          disablePictureInPicture
          onCanPlayThrough={onReady}
          onError={onError}
          onEnded={onEnded}
          className={className}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- user media from storage, shown as-is
        <img src={media.url} alt="" onLoad={onReady} onError={onError} className={className} />
      )}
    </div>
  );
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !!connection?.saveData;
}

function readSound(): boolean {
  try {
    return sessionStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSound() {
  try {
    sessionStorage.setItem(SOUND_KEY, "1");
  } catch {}
}

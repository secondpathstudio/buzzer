"use client";

import { useEffect, useRef, useState } from "react";
import { readableText } from "@/lib/color";

export type RevealGroup = { id: string; name: string; color: string; emoji: string | null };

const SUSPENSE_MS = 2000;
const REVEAL_MS = 4000;
const CYCLE_MS = 180;

/** Fixed full-screen overlay, or (contained) filling a positioned parent, e.g. a preview frame. */
export function overlayClass(contained: boolean | undefined) {
  return `${contained ? "absolute" : "fixed"} inset-0 z-40`;
}

/**
 * Built-in reveal: a short suspense screen cycling through the group
 * colours, then the student's group full-screen. Tap to skip ahead. With
 * reduced motion (or skipSuspense, when the player already showed it), goes straight
 * to the reveal.
 */
export function GroupReveal({
  group,
  groups,
  noun,
  onDone,
  skipSuspense,
  contained,
  sortingText,
}: {
  group: RevealGroup;
  groups: RevealGroup[];
  noun: string;
  onDone: () => void;
  skipSuspense?: boolean;
  contained?: boolean;
  sortingText?: string | null;
}) {
  const [reducedMotion] = useState(prefersReducedMotion);
  const [phase, setPhase] = useState<"suspense" | "reveal">(
    reducedMotion || skipSuspense ? "reveal" : "suspense",
  );

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const timer =
      phase === "suspense"
        ? setTimeout(() => setPhase("reveal"), SUSPENSE_MS)
        : setTimeout(() => onDoneRef.current(), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === "suspense") {
    return (
      <SuspenseScreen
        groups={groups}
        noun={noun}
        text={sortingText}
        contained={contained}
        onTap={() => setPhase("reveal")}
      />
    );
  }

  const text = readableText(group.color);
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={`You're in ${group.name}`}
      onClick={() => onDoneRef.current()}
      className={`${overlayClass(contained)} flex cursor-pointer select-none flex-col items-center justify-center gap-6 px-6 text-center`}
      style={{ backgroundColor: group.color, color: text }}
    >
      <p className="text-xl font-semibold opacity-80">You&apos;re in</p>
      <div className="flex flex-col items-center gap-4 motion-safe:animate-reveal-pop">
        {group.emoji && (
          <span className="text-8xl leading-none" aria-hidden>
            {group.emoji}
          </span>
        )}
        <p className="max-w-full break-words text-6xl font-black leading-tight">{group.name}</p>
      </div>
      <p className="absolute bottom-10 text-sm opacity-70">Tap to continue</p>
    </div>
  );
}

/** The host's default sorting message. */
export function defaultSortingText(noun: string) {
  return `Assigning your ${noun.toLowerCase()}…`;
}

/**
 * The host's sorting message (default "Assigning your House…") over the
 * group colours in turn (still with reduced motion), or on plain black when
 * the room uses clips, so black-background clips blend in.
 */
export function SuspenseScreen({
  groups,
  noun,
  text,
  black,
  contained,
  onTap,
}: {
  groups: RevealGroup[];
  noun: string;
  /** null/undefined = the default message. */
  text?: string | null;
  black?: boolean;
  contained?: boolean;
  onTap?: () => void;
}) {
  const message = text || defaultSortingText(noun);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reducedMotion || black) return;
    const interval = setInterval(() => setTick((t) => t + 1), CYCLE_MS);
    return () => clearInterval(interval);
  }, [reducedMotion, black]);

  const background = black ? "#000000" : groups.length ? groups[tick % groups.length].color : "#171717";
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={message}
      onClick={onTap}
      className={`${overlayClass(contained)} flex cursor-pointer select-none items-center justify-center px-6 text-center motion-safe:transition-colors motion-safe:duration-150`}
      style={{ backgroundColor: background, color: readableText(background) }}
    >
      <p className="max-w-full break-words text-3xl font-bold">{message}</p>
    </div>
  );
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

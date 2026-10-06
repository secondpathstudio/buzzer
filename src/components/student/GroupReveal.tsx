"use client";

import { useEffect, useRef, useState } from "react";
import { readableText } from "@/lib/color";

type RevealGroup = { id: string; name: string; color: string; emoji: string | null };

const SUSPENSE_MS = 2000;
const REVEAL_MS = 4000;
const CYCLE_MS = 180;

/**
 * Built-in reveal for random mode: a short suspense screen cycling through
 * the group colours, then the student's group full-screen. Tap to skip
 * ahead. With reduced motion, goes straight to a static reveal.
 */
export function GroupReveal({
  group,
  groups,
  noun,
  onDone,
}: {
  group: RevealGroup;
  groups: RevealGroup[];
  noun: string;
  onDone: () => void;
}) {
  const [reducedMotion] = useState(prefersReducedMotion);
  const [phase, setPhase] = useState<"suspense" | "reveal">(reducedMotion ? "reveal" : "suspense");
  const [tick, setTick] = useState(0);

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

  useEffect(() => {
    if (phase !== "suspense") return;
    const interval = setInterval(() => setTick((t) => t + 1), CYCLE_MS);
    return () => clearInterval(interval);
  }, [phase]);

  const background = phase === "suspense" ? groups[tick % groups.length]?.color ?? group.color : group.color;
  const text = readableText(background);

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={phase === "reveal" ? `You're in ${group.name}` : `Assigning your ${noun}`}
      onClick={() => (phase === "suspense" ? setPhase("reveal") : onDoneRef.current())}
      className="fixed inset-0 z-40 flex cursor-pointer select-none flex-col items-center justify-center gap-6 px-6 text-center motion-safe:transition-colors motion-safe:duration-150"
      style={{ backgroundColor: background, color: text }}
    >
      {phase === "suspense" ? (
        <p className="text-3xl font-bold">Assigning your {noun.toLowerCase()}…</p>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

"use client";

import { useState } from "react";
import { formatDelta } from "@/hooks/usePointActions";

/**
 * Quick-award buttons (one per preset, negated while `deduct` is on) plus
 * "…" for a custom amount and reason.
 */
export function AwardButtons({
  presets,
  deduct,
  onAward,
  label,
}: {
  presets: number[];
  deduct: boolean;
  onAward: (delta: number, reason?: string) => Promise<boolean>;
  /** Who gets the points, for screen readers. */
  label: string;
}) {
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function give(delta: number, why?: string) {
    setPending(true);
    const ok = await onAward(delta, why);
    setPending(false);
    return ok;
  }

  const button = (deduct: boolean) =>
    `rounded-lg px-2 py-1 text-sm font-semibold tabular-nums transition active:scale-95 disabled:opacity-40 ${
      deduct
        ? "bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-200"
        : "bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-500/20 dark:text-green-200"
    }`;

  if (custom) {
    const n = Number(amount);
    const valid = Number.isInteger(n) && n !== 0 && Math.abs(n) <= 1000;
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (valid && (await give(n, reason.trim()))) {
            setCustom(false);
            setAmount("");
            setReason("");
          }
        }}
        className="flex items-center gap-1"
      >
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          placeholder={deduct ? "-5" : "5"}
          aria-label={`Points for ${label} (negative to deduct)`}
          autoFocus
          className="w-14 rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm tabular-nums dark:border-neutral-700"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          maxLength={80}
          aria-label="Reason (optional)"
          className="w-24 rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
        />
        <button type="submit" disabled={!valid || pending} className={button(n < 0)} aria-label="Award">
          ✓
        </button>
        <button
          type="button"
          onClick={() => setCustom(false)}
          aria-label="Cancel"
          className="px-1 text-neutral-500"
        >
          ×
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Points for ${label}`}>
      {presets.map((p, i) => {
        const delta = deduct ? -p : p;
        return (
          <button key={i} onClick={() => void give(delta)} disabled={pending} className={button(delta < 0)}>
            {formatDelta(delta)}
          </button>
        );
      })}
      <button
        onClick={() => setCustom(true)}
        aria-label={`Custom points for ${label}`}
        title="Custom amount"
        className="rounded-lg px-2 py-1 text-sm font-semibold text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
      >
        …
      </button>
    </div>
  );
}

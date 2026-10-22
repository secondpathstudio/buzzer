"use client";

import { useState } from "react";
import { useDisplayOptions } from "@/hooks/useDisplayOptions";
import { useLiveQuery } from "@/hooks/useLiveQuery";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";
import { buttonClass, Toggle } from "@/components/ui";

/**
 * Pair a TV screen (any device showing /tv) and control what it shows.
 * The scoreboard and QR switches apply to display mode in this browser too.
 */
export function TvScreens({ room }: { room: Tables<"rooms"> }) {
  const { data: screens, refetch } = useLiveQuery({
    key: room.host_id,
    table: "screens",
    filter: `host_id=eq.${room.host_id}`,
    fetch: async () => {
      const { data, error } = await getSupabase()
        .from("screens")
        .select("*")
        .eq("host_id", room.host_id)
        .order("paired_at");
      if (error) throw error;
      return data;
    },
  });
  const options = useDisplayOptions(room.id);
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [showPair, setShowPair] = useState(false);
  const [error, setError] = useState<string>();

  const paired = screens ?? [];
  const site = typeof window === "undefined" ? "" : window.location.host;

  async function pair(e: React.FormEvent) {
    e.preventDefault();
    setPairing(true);
    setError(undefined);
    const { error } = await getSupabase().rpc("pair_screen", { p_code: code });
    setPairing(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    setCode("");
    setShowPair(false);
    void refetch();
  }

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setError(undefined);
    const { error } = await fn();
    if (error) setError(errorMessage(error));
    return !error;
  }

  async function disconnect(userId: string) {
    if (!window.confirm("Disconnect this TV? It will show a new pairing code.")) return;
    if (await run(() => getSupabase().rpc("unpair_screen", { p_user_id: userId }))) void refetch();
  }

  return (
    <div className="rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">TV screen</h2>
        {paired.length > 0 && (
          <span className="text-sm text-neutral-500">
            {paired.length === 1 ? "1 TV connected" : `${paired.length} TVs connected`}
          </span>
        )}
      </div>

      {paired.length > 0 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-500">
            This room appears on the TV automatically, and so will the next one you start.
          </p>
          <label className="flex items-center justify-between gap-4">
            <span>QR code on screen</span>
            <Toggle
              label="QR code on screen"
              checked={room.display_qr}
              onChange={(qr) => void options.set({ qr })}
            />
          </label>
          {room.points_enabled && (
            <label className="flex items-center justify-between gap-4">
              <span>Scoreboard on screen</span>
              <Toggle
                label="Scoreboard on screen"
                checked={room.display_scores}
                onChange={(scores) => void options.set({ scores })}
              />
            </label>
          )}
          <ul className="flex flex-col gap-1 text-sm text-neutral-500">
            {paired.map((s, i) => (
              <li key={s.user_id} className="flex items-center justify-between">
                <span>
                  {paired.length > 1 ? `TV ${i + 1}` : "TV"}
                  {s.paired_at ? ` · paired ${new Date(s.paired_at).toLocaleDateString()}` : ""}
                </span>
                <button onClick={() => void disconnect(s.user_id)} className="underline">
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {paired.length === 0 || showPair ? (
        <form onSubmit={pair} className={`flex flex-col gap-3 ${paired.length > 0 ? "mt-4" : ""}`}>
          <p className="text-sm text-neutral-500">
            On the TV&apos;s computer, open <span className="font-medium">{site}/tv</span> and enter the
            code it shows. You only need to pair once.
          </p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="ABC123"
              aria-label="Pairing code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-transparent px-4 py-3 font-mono text-lg tracking-widest uppercase outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-100"
            />
            <button type="submit" disabled={pairing || code.trim().length < 6} className={buttonClass("primary")}>
              {pairing ? "Pairing…" : "Pair"}
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowPair(true)} className="mt-3 text-sm text-neutral-500 underline">
          Pair another TV
        </button>
      )}

      {(error ?? options.error) && (
        <p role="alert" className="mt-3 text-red-600 dark:text-red-400">
          {error ?? options.error}
        </p>
      )}
    </div>
  );
}

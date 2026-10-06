"use client";

import type { REALTIME_POSTGRES_CHANGES_LISTEN_EVENT } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Database } from "@/lib/database.types";
import { getSupabase } from "@/lib/supabase/client";

type TableName = keyof Database["public"]["Tables"];

type Options<T> = {
  /** Skip fetching and subscribing until this is set (e.g. no room id yet). */
  key: string | null | undefined;
  table: TableName;
  /** Postgres Changes filter, e.g. `room_id=eq.${id}`. Only one is allowed. */
  filter: string;
  event?: `${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT}`;
  fetch: () => PromiseLike<T>;
};

type Result<T> = { key: string; data?: T; error?: unknown };

/**
 * Fetches data and refetches whenever Postgres Changes reports a change,
 * the channel (re)subscribes, the tab becomes visible, or the browser comes
 * back online. Realtime events are only hints; the fetch is the source of
 * truth (PLAN.md §6). Bursts of events (e.g. 100 buzzes) collapse into at
 * most one fetch in flight plus one queued.
 */
export function useLiveQuery<T>({ key, table, filter, event = "*", fetch }: Options<T>) {
  const [result, setResult] = useState<Result<T>>();

  const fetchRef = useRef(fetch);
  const keyRef = useRef(key);
  useEffect(() => {
    fetchRef.current = fetch;
    keyRef.current = key;
  });

  const inFlight = useRef(false);
  const queued = useRef(false);

  const refetch = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        queued.current = false;
        const forKey = keyRef.current;
        if (!forKey) break;
        try {
          const data = await fetchRef.current();
          setResult({ key: forKey, data });
        } catch (error) {
          // Keep the last good data; the next event or refetch retries.
          setResult((prev) => ({
            key: forKey,
            data: prev?.key === forKey ? prev.data : undefined,
            error,
          }));
        }
        // The key changed mid-fetch: go again for the new one.
        if (keyRef.current !== forKey) queued.current = true;
      } while (queued.current);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!key) return;

    const supabase = getSupabase();
    const channel = supabase
      .channel(`${table}:${key}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event, schema: "public", table, filter },
        () => void refetch(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refetch();
      });

    void refetch();

    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    const onOnline = () => void refetch();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      void supabase.removeChannel(channel);
    };
  }, [key, table, filter, event, refetch]);

  // Only return results fetched for the current key.
  const current = key && result?.key === key ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !!key && !current,
    refetch,
  };
}

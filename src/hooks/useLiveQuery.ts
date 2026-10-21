"use client";

import type {
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
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
  /** Called with each realtime event before the refetch (e.g. for a toast). */
  onEvent?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
};

type Result<T> = { key: string; data?: T; error?: unknown };

// A fetch that hangs (e.g. on flaky wifi) would otherwise block every later
// refetch; after this long, count it as failed and let the next one run.
const FETCH_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fetch_timeout")), FETCH_TIMEOUT_MS);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Fetches data and refetches whenever Postgres Changes reports a change,
 * the channel (re)subscribes, the tab becomes visible, or the browser comes
 * back online. Realtime events are only hints; the fetch is the source of
 * truth (PLAN.md §6). Bursts of events (e.g. 100 buzzes) collapse into at
 * most one fetch in flight plus one queued.
 */
export function useLiveQuery<T>({ key, table, filter, event = "*", fetch, onEvent }: Options<T>) {
  const [result, setResult] = useState<Result<T>>();

  const fetchRef = useRef(fetch);
  const keyRef = useRef(key);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    fetchRef.current = fetch;
    keyRef.current = key;
    onEventRef.current = onEvent;
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
          const data = await withTimeout(fetchRef.current());
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
        (payload) => {
          onEventRef.current?.(payload);
          void refetch();
        },
      )
      // Changes only flow once Realtime confirms the Postgres side, a beat
      // after SUBSCRIBED, so refetch again then to cover the gap.
      .on("system", {}, (payload) => {
        if (payload.extension === "postgres_changes" && payload.status === "ok") void refetch();
      })
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

"use client";

import { useEffect } from "react";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { Display } from "@/components/display/Display";
import { LoadError, Message } from "@/components/ui";
import { useLiveQuery } from "@/hooks/useLiveQuery";
import { useRoom } from "@/hooks/useRoom";
import { useSession } from "@/hooks/useSession";
import { errorMessage, isRateLimited } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase/client";

/** get_screen_state */
type ScreenState = {
  paired: boolean;
  pair_code: string | null;
  pair_code_expires_at: string | null;
  host_id: string | null;
  room_code: string | null;
};

// Catches room expiry and pair-code renewal, which send no events.
const POLL_MS = 60_000;

/**
 * A TV screen (e.g. a Raspberry Pi). Bookmark this page on it. Unpaired, it
 * shows a code to type into the host panel; paired, it shows the host's
 * current room in read-only display mode and follows them to new rooms.
 */
export default function TvPage() {
  const { session, error: sessionError } = useSession();
  const uid = session?.user.id;

  const { data: state, error, refetch } = useLiveQuery({
    key: uid,
    table: "screens",
    filter: `user_id=eq.${uid}`,
    fetch: async () => {
      const { data, error } = await getSupabase().rpc("get_screen_state");
      if (error) throw error;
      return data as unknown as ScreenState;
    },
  });

  // A new room from the host takes over the screen.
  const hostId = state?.host_id;
  useEffect(() => {
    if (!hostId) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`tv-rooms:${hostId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "rooms", filter: `host_id=eq.${hostId}` },
        () => void refetch(),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [hostId, refetch]);

  useEffect(() => {
    if (!uid) return;
    const timer = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(timer);
  }, [uid, refetch]);

  if (sessionError) {
    return (
      <Message title="Couldn't connect">
        {isRateLimited(sessionError) ? errorMessage(sessionError) : "Check the connection and reload the page."}
      </Message>
    );
  }
  if (!state) {
    if (error) return <LoadError onRetry={() => void refetch()} />;
    return <Message title="Loading…" />;
  }
  if (!state.paired) return <Pairing code={state.pair_code} />;
  if (!state.room_code) return <Idle />;
  return <TvRoom code={state.room_code} />;
}

function TvRoom({ code }: { code: string }) {
  const { data: room } = useRoom(code);
  if (!room) return <Idle />;
  return <Display room={room} controls={false} />;
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex select-none flex-col items-center justify-center gap-[4vh] bg-neutral-950 px-[6vw] text-center text-white">
      <ConnectionBanner />
      {children}
    </div>
  );
}

function Pairing({ code }: { code: string | null }) {
  const site = typeof window === "undefined" ? "" : window.location.host;
  return (
    <Screen>
      <p className="text-[4vh] text-white/60">Pair this screen</p>
      <p className="font-mono text-[min(16vw,26vh)] font-black leading-none tracking-[0.15em]">
        {code ?? "······"}
      </p>
      <p className="max-w-[70vw] text-[3vh] leading-snug text-white/60">
        On your laptop, open your room&apos;s host panel on {site} and enter this code under{" "}
        <span className="font-semibold text-white">TV screen</span>. You only need to do this once.
      </p>
      <p className="text-[2vh] text-white/40">Press F11 for full screen. The code changes every 15 minutes.</p>
    </Screen>
  );
}

function Idle() {
  return (
    <Screen>
      <p className="text-[6vh] font-bold">Ready</p>
      <p className="max-w-[60vw] text-[3vh] text-white/60">
        Create a room on your laptop and it will appear here.
      </p>
    </Screen>
  );
}

"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { buttonClass, Message } from "@/components/ui";
import { useCurrentRound, type Round } from "@/hooks/useCurrentRound";
import { useRoom } from "@/hooks/useRoom";
import { useSession } from "@/hooks/useSession";
import type { Tables } from "@/lib/database.types";
import { errorCode, errorMessage, isRateLimited } from "@/lib/errors";
import { isProfane } from "@/lib/profanity";
import { getSupabase } from "@/lib/supabase/client";

type Participant = Tables<"participants">;

const NAME_KEY = "buzzer:name";

export default function StudentPage({ params }: { params: Promise<{ code: string }> }) {
  const code = use(params).code.toUpperCase();
  const { session, error: sessionError } = useSession();
  // RLS only shows the room once we've joined (or if we're the host).
  const { data: room, loading, refetch: refetchRoom } = useRoom(session ? code : null);

  const [me, setMe] = useState<{ roomId: string; participant: Participant | null }>();
  const [editingName, setEditingName] = useState(false);

  const userId = session?.user.id;
  const roomId = room?.id;
  useEffect(() => {
    if (!roomId || !userId) return;
    let cancelled = false;
    getSupabase()
      .from("participants")
      .select("*")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setMe({ roomId, participant: data });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, userId]);

  const onJoined = useCallback(
    (participant: Participant) => {
      setMe({ roomId: participant.room_id, participant });
      setEditingName(false);
      void refetchRoom();
    },
    [refetchRoom],
  );

  if (sessionError) {
    return (
      <Message title="Couldn't connect">
        {isRateLimited(sessionError)
          ? errorMessage(sessionError)
          : "Check your connection and reload the page."}
      </Message>
    );
  }
  if (!session || loading) return <Message title="Connecting…" />;

  const participant = room && me?.roomId === room.id ? me.participant : undefined;
  if (room && participant === undefined) return <Message title="Connecting…" />;

  if (room && new Date(room.expires_at) < new Date()) {
    return <Message title="This room has expired">Ask your host for a new code.</Message>;
  }

  if (!room || !participant || editingName) {
    return (
      <JoinForm
        code={code}
        title={room?.title}
        currentName={participant?.display_name}
        onJoined={onJoined}
        onCancel={participant ? () => setEditingName(false) : undefined}
      />
    );
  }

  return (
    <Buzzer
      room={room}
      participant={participant}
      onRemoved={() => setMe({ roomId: room.id, participant: null })}
      onEditName={() => setEditingName(true)}
    />
  );
}

function JoinForm({
  code,
  title,
  currentName,
  onJoined,
  onCancel,
}: {
  code: string;
  title: string | null | undefined;
  currentName?: string;
  onJoined: (p: Participant) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(() => currentName ?? readSavedName());
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>();

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (isProfane(name)) {
      setError("That name isn't allowed. Please choose a different one.");
      return;
    }
    setJoining(true);
    setError(undefined);
    const { data, error } = await getSupabase().rpc("join_room", {
      p_code: code,
      p_display_name: name,
    });
    if (error) {
      setError(errorMessage(error));
      setJoining(false);
      return;
    }
    try {
      localStorage.setItem(NAME_KEY, data.display_name);
    } catch {}
    onJoined(data);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-12">
      <header className="text-center">
        <p className="font-mono text-sm tracking-[0.3em] text-neutral-500">{code}</p>
        <h1 className="mt-2 text-3xl font-bold">{title ?? "Join the room"}</h1>
      </header>
      <form onSubmit={join} className="flex flex-col gap-3">
        <label htmlFor="name" className="text-sm font-medium text-neutral-500">
          Your name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="nickname"
          autoFocus
          required
          className="rounded-xl border border-neutral-300 bg-transparent px-4 py-4 text-xl outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-100"
        />
        <button type="submit" disabled={joining || !name.trim()} className={`mt-2 ${buttonClass("primary")}`}>
          {joining ? "Joining…" : currentName ? "Save" : "Join"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonClass("secondary")}>
            Cancel
          </button>
        )}
        {error && (
          <p role="alert" className="text-center text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
      <p className="text-center text-sm text-neutral-500">
        <Link href="/" className="underline">
          Hosting a class instead?
        </Link>
      </p>
    </main>
  );
}

type MyBuzz = { roundId: string; position: number };

function Buzzer({
  room,
  participant,
  onRemoved,
  onEditName,
}: {
  room: Tables<"rooms">;
  participant: Participant;
  onRemoved: () => void;
  onEditName: () => void;
}) {
  const { data: round, refetch: refetchRound } = useCurrentRound(room.id);
  const [myBuzz, setMyBuzz] = useState<MyBuzz>();
  const [pending, setPending] = useState<string>(); // round id being buzzed
  const [error, setError] = useState<string>();

  // Once removed, RLS hides the room's rounds from us, so no more updates
  // arrive. Watch for our own participant row being deleted (a DELETE event
  // carries the primary key, so an id filter works), and treat losing sight
  // of the round on a refetch the same way.
  const onRemovedRef = useRef(onRemoved);
  useEffect(() => {
    onRemovedRef.current = onRemoved;
  });
  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`me:${participant.id}`)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "participants", filter: `id=eq.${participant.id}` },
        () => onRemovedRef.current(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [participant.id]);
  useEffect(() => {
    if (round === null) onRemovedRef.current();
  }, [round]);

  // Restore our position after a refresh. Students don't subscribe to buzzes
  // (every buzz would fan out to every phone); one fetch per round is enough.
  const roundId = round?.id;
  useEffect(() => {
    if (!roundId) return;
    const load = () =>
      getSupabase()
        .from("buzzes")
        .select("position")
        .eq("round_id", roundId)
        .eq("participant_id", participant.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setMyBuzz({ roundId, position: data.position });
        });
    void load();
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [roundId, participant.id]);

  async function buzz() {
    if (!round || round.status !== "open" || pending === round.id) return;
    if (myBuzz?.roundId === round.id) return;
    setPending(round.id);
    setError(undefined);
    navigator.vibrate?.(50);

    const { data, error } = await getSupabase().rpc("buzz", { p_round_id: round.id });
    setPending(undefined);
    if (!error) {
      setMyBuzz({ roundId: round.id, position: data });
      return;
    }
    switch (errorCode(error)) {
      case "not_a_participant":
        onRemoved();
        break;
      case "round_not_open":
        void refetchRound();
        break;
      default:
        setError(errorMessage(error));
    }
  }

  const position = myBuzz && round && myBuzz.roundId === round.id ? myBuzz.position : undefined;
  const state = buttonState(round, position, pending === round?.id);

  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-6 pb-10">
      <header className="flex w-full max-w-md items-center justify-between gap-3 text-sm text-neutral-500">
        <span className="truncate">{room.title ?? room.code}</span>
        <button onClick={onEditName} className="shrink-0 truncate underline">
          {participant.display_name}
        </button>
      </header>

      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6">
        <button
          onPointerDown={(e) => {
            // Fire on touch-down, not release: saves ~100ms on phones.
            if (e.pointerType !== "mouse" || e.button === 0) void buzz();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void buzz();
            }
          }}
          disabled={state.kind !== "open"}
          aria-label={state.label}
          className={`flex aspect-square w-[min(80vw,60vh,28rem)] touch-manipulation select-none items-center justify-center rounded-full text-center font-black shadow-xl transition-transform active:scale-95 disabled:active:scale-100 ${state.className}`}
        >
          <span className="px-6">
            <span className="block text-5xl sm:text-6xl">{state.label}</span>
            {state.sub && <span className="mt-2 block text-lg font-semibold opacity-80">{state.sub}</span>}
          </span>
        </button>
        {round && <p className="text-neutral-500">Round {round.number}</p>}
        {error && (
          <p role="alert" className="text-center text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

function buttonState(round: Round | null | undefined, position: number | undefined, pending: boolean) {
  if (position) {
    return {
      kind: "buzzed",
      label: position === 1 ? "First!" : `#${position}`,
      sub: position === 1 ? "You buzzed first" : `You were #${position}`,
      className: position === 1 ? "bg-amber-400 text-amber-950" : "bg-sky-600 text-white",
    } as const;
  }
  if (pending) {
    return { kind: "pending", label: "BUZZ", sub: undefined, className: "bg-red-700 text-white scale-95" } as const;
  }
  switch (round?.status) {
    case "open":
      return {
        kind: "open",
        label: "BUZZ",
        sub: undefined,
        className: "bg-red-600 text-white animate-buzz-pulse",
      } as const;
    case "locked":
      return {
        kind: "locked",
        label: "Round closed",
        sub: "Wait for the next round",
        className: "bg-neutral-300 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
      } as const;
    default:
      return {
        kind: "waiting",
        label: "Get ready…",
        sub: undefined,
        className: "bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
      } as const;
  }
}

function readSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

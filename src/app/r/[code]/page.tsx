"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { buttonClass, LoadError, Message } from "@/components/ui";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { GroupChip } from "@/components/GroupChip";
import { GroupPicker, type PickerGroup } from "@/components/student/GroupPicker";
import { RevealPlayer } from "@/components/student/RevealPlayer";
import { useCurrentRound, type Round } from "@/hooks/useCurrentRound";
import { type Group, useGroups } from "@/hooks/useGroups";
import { useRoom } from "@/hooks/useRoom";
import { useScoreboard } from "@/hooks/useScoreboard";
import { useSession } from "@/hooks/useSession";
import type { Tables } from "@/lib/database.types";
import { errorCode, errorMessage, type GroupLabels, isRateLimited } from "@/lib/errors";
import { type Media, type MediaKind, mediaUrl } from "@/lib/media";
import { isProfane } from "@/lib/profanity";
import { getSupabase } from "@/lib/supabase/client";

type Participant = Tables<"participants">;
type StoredMedia = { path: string; kind: MediaKind };

/** get_join_info: what the join screen needs before RLS shows us the room. */
type JoinInfo = GroupLabels & {
  room_id: string;
  title: string | null;
  groups_mode: "off" | "random" | "choose";
  sorting_text: string | null;
  groups: (PickerGroup & { reveal_media: StoredMedia | null })[];
  media_bucket: string;
  is_full: boolean;
};

/** A reveal in progress. Random mode shows the "sorting" suspense; choose mode only the clip. */
type Reveal = { info: JoinInfo; sorting: boolean };

function toMedia(media: StoredMedia | null, info: JoinInfo): Media | null {
  return media && { url: mediaUrl(media.path, info.media_bucket), kind: media.kind };
}

const NAME_KEY = "buzzer:name";
// A join on flaky classroom wifi can hang with no error; give up and retry.
const JOIN_TIMEOUT_MS = 8000;
const JOIN_ATTEMPTS = 3;
// Joined, but the room fetch after it failed: retry this often.
const ROOM_RETRY_MS = 2000;
// Which group's reveal this tab has shown, per room, so a refresh doesn't replay it.
const revealKey = (roomId: string) => `buzzer:revealSeen:${roomId}`;

export default function StudentPage({ params }: { params: Promise<{ code: string }> }) {
  const code = use(params).code.toUpperCase();
  const { session, error: sessionError } = useSession();
  // RLS only shows the room once we've joined (or if we're the host).
  const { data: room, loading, error: roomError, refetch: refetchRoom } = useRoom(
    session ? code : null,
  );

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

  // Just joined, but the room fetch after it failed or hung: keep trying,
  // rather than drop the student back on the join form.
  const awaitingRoom = !!me?.participant && !room;
  useEffect(() => {
    if (!awaitingRoom) return;
    const interval = setInterval(() => void refetchRoom(), ROOM_RETRY_MS);
    return () => clearInterval(interval);
  }, [awaitingRoom, refetchRoom]);

  const onJoined = useCallback(
    (participant: Participant) => {
      setMe({ roomId: participant.room_id, participant });
      setEditingName(false);
      void refetchRoom();
    },
    [refetchRoom],
  );

  // The reveal lives here, above the join form and the buzzer, so the sorting
  // can start the moment Join is tapped and keep playing through the switch.
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const participant = room && me?.roomId === room.id ? me.participant : undefined;
  const groupId = participant?.group_id ?? undefined;

  // The reveal goes by the join result rather than the room, so it doesn't
  // wait on the room fetch that follows a join.
  const revealMe = reveal && me?.roomId === reveal.info.room_id ? me.participant : undefined;
  const revealGroupId = revealMe?.group_id ?? undefined;
  const revealGroup = reveal && revealGroupId ? reveal.info.groups.find((g) => g.id === revealGroupId) : undefined;

  // Joined, but not into a group this reveal knows about (e.g. the host
  // edited groups meanwhile): drop it rather than get stuck. A stale one is
  // replaced below with fresh join info.
  const activeReveal = reveal && (!revealMe || revealGroup) ? reveal : null;

  function finishReveal() {
    if (activeReveal && revealGroupId) {
      writeRevealSeen(activeReveal.info.room_id, revealGroupId);
      setSeen((s) => ({ ...s, [activeReveal.info.room_id]: revealGroupId }));
    }
    setReveal(null);
  }

  // Assigned (or moved, or shuffled) while already in the room.
  const needsReveal =
    !activeReveal &&
    !editingName &&
    room?.groups_mode === "random" &&
    !!groupId &&
    (seen[room.id] ?? readRevealSeen(room.id)) !== groupId;
  useEffect(() => {
    if (!needsReveal) return;
    let cancelled = false;
    void getSupabase()
      .rpc("get_join_info", { p_code: code })
      .then(({ data }) => {
        if (!cancelled && data) setReveal({ info: data as unknown as JoinInfo, sorting: true });
      });
    return () => {
      cancelled = true;
    };
  }, [needsReveal, code]);

  const overlay = activeReveal && (
    <RevealPlayer
      group={revealGroup && { ...revealGroup, media: toMedia(revealGroup.reveal_media, activeReveal.info) }}
      groups={activeReveal.info.groups}
      noun={activeReveal.info.group_noun}
      onDone={finishReveal}
      suspense={activeReveal.sorting}
      sortingText={activeReveal.info.sorting_text}
      black={activeReveal.info.groups.some((g) => g.reveal_media)}
    />
  );

  return (
    <>
      {studentContent()}
      {overlay}
    </>
  );

  function studentContent() {
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
    if (roomError && room === undefined) return <LoadError onRetry={() => void refetchRoom()} />;

    if ((room && participant === undefined) || awaitingRoom) return <Message title="Connecting…" />;

    if (room && new Date(room.expires_at) < new Date()) {
      return <Message title="This room has ended">Ask your host for the new code.</Message>;
    }

    if (!room || !participant || editingName) {
      return (
        <JoinForm
          code={code}
          title={room?.title}
          currentName={participant?.display_name}
          onJoined={onJoined}
          onRevealStart={setReveal}
          onCancel={participant ? () => setEditingName(false) : undefined}
        />
      );
    }

    return (
      <JoinedRoom
        room={room}
        participant={participant}
        onChange={(p) => setMe({ roomId: room.id, participant: p })}
        onEditName={() => setEditingName(true)}
      />
    );
  }
}

function JoinForm({
  code,
  title,
  currentName,
  onJoined,
  onRevealStart,
  onCancel,
}: {
  code: string;
  title: string | null | undefined;
  currentName?: string;
  onJoined: (p: Participant) => void;
  /** null cancels (the join failed). */
  onRevealStart: (reveal: Reveal | null) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(() => currentName ?? readSavedName());
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<JoinInfo>();
  const [groupId, setGroupId] = useState<string>();

  const loadInfo = useCallback(
    () =>
      getSupabase()
        .rpc("get_join_info", { p_code: code })
        .then(({ data }) => {
          // On failure, join_room reports the problem when they tap Join.
          if (data) setInfo(data as unknown as JoinInfo);
        }),
    [code],
  );
  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  // Renaming keeps your group, so only first joins pick one.
  const mustChoose = !currentName && info?.groups_mode === "choose" && info.groups.length > 0;
  const chosen = mustChoose ? info.groups.find((g) => g.id === groupId) : undefined;

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (isProfane(name)) {
      setError("That name isn't allowed. Please choose a different one.");
      return;
    }
    if (mustChoose && !chosen) {
      setError(errorMessage({ message: "group_required" }, info));
      return;
    }
    setJoining(true);
    setError(undefined);
    if (info && !currentName) {
      if (info.groups_mode === "random" && info.groups.length > 0) {
        onRevealStart({ info, sorting: true });
      } else if (chosen?.reveal_media) {
        onRevealStart({ info, sorting: false });
      }
    }
    const { data, error } = await joinRoom(code, name, chosen?.id);
    if (error) {
      onRevealStart(null);
      setError(errorMessage(error, info));
      setJoining(false);
      if (errorCode(error) === "invalid_group" || errorCode(error) === "group_required") {
        setGroupId(undefined);
        void loadInfo();
      }
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
        <h1 className="mt-2 text-3xl font-bold">{info?.title ?? title ?? "Join the room"}</h1>
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
        {mustChoose && (
          <div className="mt-3">
            <GroupPicker
              groups={info.groups}
              selected={groupId}
              onSelect={setGroupId}
              disabled={joining}
              label={`Pick your ${info.group_noun.toLowerCase()}`}
            />
          </div>
        )}
        <button
          type="submit"
          disabled={joining || !name.trim() || (mustChoose && !chosen)}
          className={`mt-2 ${buttonClass("primary")}`}
        >
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

/**
 * Everything after joining. Watches our own participant row: the host can
 * move us to another group or remove us.
 */
function JoinedRoom({
  room,
  participant,
  onChange,
  onEditName,
}: {
  room: Tables<"rooms">;
  participant: Participant;
  onChange: (participant: Participant | null) => void;
  onEditName: () => void;
}) {
  const groupsOn = room.groups_mode !== "off";
  const { data: groups, refetch: refetchGroups } = useGroups(room.id, groupsOn);
  const group = groupsOn ? groups?.find((g) => g.id === participant.group_id) : undefined;

  // Once removed, RLS hides the room from us, so no more updates arrive.
  // A DELETE event carries the primary key, so an id filter works for both
  // events. Refetch on wake too, in case we slept through one.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`me:${participant.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants", filter: `id=eq.${participant.id}` },
        (payload) =>
          onChangeRef.current(payload.eventType === "DELETE" ? null : (payload.new as Participant)),
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void supabase
        .from("participants")
        .select("*")
        .eq("id", participant.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error) onChangeRef.current(data);
        });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [participant.id]);

  // Avoid flashing the buzzer before the picker.
  if (groupsOn && !groups) return <Message title="Connecting…" />;

  if (room.groups_mode === "choose" && !group) {
    return (
      <ChooseGroup
        room={room}
        groups={groups ?? []}
        onChosen={onChange}
        onStale={() => void refetchGroups()}
      />
    );
  }

  return (
    <Buzzer
      room={room}
      participant={participant}
      group={group}
      onRemoved={() => onChange(null)}
      onEditName={onEditName}
    />
  );
}

/** Choose mode, joined but not in a group yet (e.g. the host just switched modes). */
function ChooseGroup({
  room,
  groups,
  onChosen,
  onStale,
}: {
  room: Tables<"rooms">;
  groups: Group[];
  onChosen: (participant: Participant) => void;
  onStale: () => void;
}) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  async function choose(groupId: string) {
    setPending(groupId);
    setError(undefined);
    const { data, error } = await getSupabase().rpc("choose_group", { p_group_id: groupId });
    setPending(undefined);
    if (error) {
      setError(errorMessage(error, room));
      onStale();
      return;
    }
    onChosen(data);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
      <ConnectionBanner />
      <h1 className="text-center text-3xl font-bold">Pick your {room.group_noun.toLowerCase()}</h1>
      <GroupPicker
        groups={groups}
        selected={pending}
        onSelect={(id) => void choose(id)}
        disabled={!!pending}
        label={`Tap a ${room.group_noun.toLowerCase()} to join it`}
      />
      {error && (
        <p role="alert" className="text-center text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </main>
  );
}

type MyBuzz = { roundId: string; position: number };

function Buzzer({
  room,
  participant,
  group,
  onRemoved,
  onEditName,
}: {
  room: Tables<"rooms">;
  participant: Participant;
  group: Group | undefined;
  onRemoved: () => void;
  onEditName: () => void;
}) {
  const { data: round, refetch: refetchRound } = useCurrentRound(room.id);
  const [myBuzz, setMyBuzz] = useState<MyBuzz>();
  const [pending, setPending] = useState<string>(); // round id being buzzed
  // Tagged with the round state it happened in, so it clears when the round moves on.
  const [error, setError] = useState<{ message: string; roundKey: string }>();

  // JoinedRoom watches our participant row; losing sight of the round on a
  // refetch also means we were removed.
  const onRemovedRef = useRef(onRemoved);
  useEffect(() => {
    onRemovedRef.current = onRemoved;
  });
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
      case "round_not_found":
        void refetchRound();
        break;
      default:
        setError({ message: errorMessage(error), roundKey: `${round.id}:${round.status}` });
    }
  }

  // RLS only sends us point events for ourselves and our group.
  const { data: board, refetch: refetchBoard } = useScoreboard(room.id, room.points_enabled);
  const groupId = participant.group_id;
  useEffect(() => {
    if (room.points_enabled) void refetchBoard();
  }, [room.points_enabled, groupId, refetchBoard]);
  const myTotal = board?.individuals[0]?.total;
  const groupTotal = group ? board?.groups.find((g) => g.id === group.id)?.total : undefined;

  const position = myBuzz && round && myBuzz.roundId === round.id ? myBuzz.position : undefined;
  const state = buttonState(round, position, pending === round?.id);
  const shownError = error?.roundKey === `${round?.id}:${round?.status}` ? error.message : undefined;

  return (
    <main
      className="flex flex-1 flex-col items-center px-4 pt-6 pb-10"
      style={group ? { backgroundColor: `color-mix(in srgb, ${group.color} 14%, transparent)` } : undefined}
    >
      <ConnectionBanner />
      <header className="flex w-full max-w-md items-center justify-between gap-3 text-sm text-neutral-500">
        <span className="truncate">{room.title ?? room.code}</span>
        <button onClick={onEditName} className="shrink-0 truncate underline">
          {participant.display_name}
        </button>
      </header>
      {group && <GroupChip group={group} className="mt-4 text-lg" />}

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
        {shownError && (
          <p role="alert" className="text-center text-red-600 dark:text-red-400">
            {shownError}
          </p>
        )}
      </div>
      {room.points_enabled && myTotal !== undefined && (
        <footer className="mt-6 rounded-full bg-neutral-100 px-5 py-2 text-lg font-semibold tabular-nums dark:bg-neutral-900">
          You: {myTotal}
          {group && groupTotal !== undefined && (
            <>
              {" "}· {group.name}: {groupTotal}
            </>
          )}
        </footer>
      )}
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

/**
 * join_room, retried when the request hangs or never reaches the server.
 * Safe to repeat: joining again keeps the group from the first join.
 */
async function joinRoom(code: string, name: string, groupId: string | undefined) {
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JOIN_TIMEOUT_MS);
    const result = await getSupabase()
      .rpc("join_room", { p_code: code, p_display_name: name, p_group_id: groupId })
      .abortSignal(controller.signal);
    clearTimeout(timer);
    // status 0: no response (network error or our timeout); 5xx: server hiccup.
    const retryable = result.error && (result.status === 0 || result.status >= 500);
    if (!retryable || attempt === JOIN_ATTEMPTS) return result;
  }
}

function readRevealSeen(roomId: string): string | null {
  try {
    return sessionStorage.getItem(revealKey(roomId));
  } catch {
    return null;
  }
}

function writeRevealSeen(roomId: string, groupId: string) {
  try {
    sessionStorage.setItem(revealKey(roomId), groupId);
  } catch {}
}

function readSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

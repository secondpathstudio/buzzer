"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { use, useEffect, useMemo, useState } from "react";
import { useBuzzes } from "@/hooks/useBuzzes";
import { useCurrentRound, type Round } from "@/hooks/useCurrentRound";
import { type Group, useGroups } from "@/hooks/useGroups";
import { useParticipants } from "@/hooks/useParticipants";
import { usePointActions } from "@/hooks/usePointActions";
import { useScoreboard } from "@/hooks/useScoreboard";
import { EntitlementsContext, useRoomEntitlements } from "@/hooks/useRoomEntitlements";
import { useRoundActions } from "@/hooks/useRoundActions";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { formatGap, joinUrl } from "@/lib/format";
import { notifyParticipantsChanged, notifyRoomChanged } from "@/lib/roomEvents";
import { getSupabase } from "@/lib/supabase/client";
import { HostGate } from "@/components/HostGate";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { GroupChip } from "@/components/GroupChip";
import { AwardButtons } from "@/components/host/AwardButtons";
import { ParticipantGroups } from "@/components/host/ParticipantGroups";
import { PointsPanel } from "@/components/host/PointsPanel";
import { RemoveButton } from "@/components/host/RemoveButton";
import { RoomOptions } from "@/components/host/RoomOptions";
import { TvScreens } from "@/components/host/TvScreens";
import { buttonClass } from "@/components/ui";

export default function HostPage({ params }: { params: Promise<{ code: string }> }) {
  const code = use(params).code.toUpperCase();
  return <HostGate code={code}>{(room) => <HostPanel room={room} />}</HostGate>;
}

function HostPanel({ room }: { room: Tables<"rooms"> }) {
  const { data: round } = useCurrentRound(room.id);
  const { data: buzzes, refetch: refetchBuzzes } = useBuzzes(round?.id);
  const { data: participants, refetch: refetchParticipants } = useParticipants(room.id);
  const [removeError, setRemoveError] = useState<string>();
  const entitlements = useRoomEntitlements(room.id);
  const groupsOn = room.groups_mode !== "off";
  const { data: groups, refetch: refetchGroups } = useGroups(room.id, groupsOn);

  const groupOf = useMemo(() => {
    const byId = new Map(groups?.map((g) => [g.id, g]));
    return new Map(
      participants?.flatMap((p) => {
        const g = p.group_id ? byId.get(p.group_id) : undefined;
        return g ? [[p.id, g] as const] : [];
      }),
    );
  }, [groups, participants]);

  const pointsOn = room.points_enabled;
  const { data: board, refetch: refetchBoard } = useScoreboard(room.id, pointsOn);
  const points = usePointActions(room);
  // Names, members and groups feed the scoreboard too.
  useEffect(() => {
    if (pointsOn) void refetchBoard();
  }, [pointsOn, participants, groups, refetchBoard]);

  async function onGroupsSaved() {
    // Deleted groups never reach a room_id-filtered subscription.
    await refetchGroups();
    notifyRoomChanged(room.id, "groups");
  }

  const names = useMemo(
    () => new Map(participants?.map((p) => [p.id, p.display_name])),
    [participants],
  );
  const url = joinUrl(room.code);

  async function remove(participantId: string) {
    const name = names.get(participantId) ?? "this participant";
    if (!window.confirm(`Remove ${name} from the room? Their buzzes are deleted too.`)) return;
    setRemoveError(undefined);
    const { error } = await getSupabase().rpc("remove_participant", {
      p_participant_id: participantId,
    });
    if (error) {
      setRemoveError(errorMessage(error));
      return;
    }
    // Realtime doesn't deliver these deletes, so refresh here and in the display tab.
    void refetchParticipants();
    void refetchBuzzes();
    notifyParticipantsChanged(room.id);
  }

  return (
    <EntitlementsContext.Provider value={entitlements}>
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:py-10">
        <ConnectionBanner />
        <section className="flex flex-col gap-6">
          <div className="rounded-2xl border border-neutral-200 p-6 text-center dark:border-neutral-800">
            {room.title && <h1 className="mb-4 text-xl font-semibold">{room.title}</h1>}
            <div className="mx-auto w-full max-w-64 rounded-xl bg-white p-3">
              <QRCodeSVG value={url} size={512} className="h-auto w-full" marginSize={0} />
            </div>
            <p className="mt-4 text-sm text-neutral-500">Scan or go to</p>
            <p className="break-all font-medium">{url.replace(/^https?:\/\//, "")}</p>
            <p className="mt-3 font-mono text-5xl font-bold tracking-[0.2em]">{room.code}</p>
            <Link
              href={`/display/${room.code}`}
              target="_blank"
              className={`mt-6 w-full ${buttonClass("secondary")}`}
            >
              Open display mode ↗
            </Link>
          </div>

          <TvScreens room={room} />

          <ParticipantList
            room={room}
            groups={groupsOn ? groups : undefined}
            participants={participants ?? []}
            max={room.max_participants}
            onRemove={remove}
            error={removeError}
          />

          <RoomOptions room={room} groups={groups} onGroupsSaved={onGroupsSaved} />
        </section>

        <section className="flex flex-col gap-6">
          <RoundControls roomId={room.id} round={round ?? null} />
          {pointsOn && (
            <PointsPanel
              room={room}
              board={board}
              groupsOn={groupsOn}
              onAward={(delta, target) => points.award(delta, target)}
              onUndo={() => void points.undo()}
              error={points.error}
            />
          )}
          <BuzzList
            buzzes={buzzes ?? []}
            names={names}
            joined={participants?.length ?? 0}
            status={round?.status}
            groupOf={groupOf}
            onRemove={remove}
            award={
              pointsOn && round
                ? {
                    presets: room.point_presets,
                    give: (participantId, delta) =>
                      points.award(delta, { participantId }, { roundId: round.id }),
                  }
                : undefined
            }
          />
        </section>
      </main>
    </EntitlementsContext.Provider>
  );
}

function RoundControls({ roomId, round }: { roomId: string; round: Round | null }) {
  const { run, pending, error } = useRoundActions(roomId);
  const status = round?.status;

  return (
    <div className="rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Round {round?.number ?? "–"}</h2>
        {status && <StatusBadge status={status} />}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => run("open_round")}
          disabled={status !== "waiting" || !!pending}
          className={buttonClass(status === "waiting" ? "go" : "secondary")}
        >
          Open
        </button>
        <button
          onClick={() => run("lock_round")}
          disabled={status !== "open" || !!pending}
          className={buttonClass(status === "open" ? "primary" : "secondary")}
        >
          Lock
        </button>
        <button
          onClick={() => run("reset_round")}
          disabled={!round || !!pending}
          className={buttonClass(status === "locked" ? "primary" : "secondary")}
          title="Start a new round with buzzers open"
        >
          Reset
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function BuzzList({
  buzzes,
  names,
  joined,
  status,
  groupOf,
  onRemove,
  award,
}: {
  buzzes: Tables<"buzzes">[];
  names: Map<string, string>;
  joined: number;
  status: Round["status"] | undefined;
  groupOf: Map<string, Group>;
  onRemove: (participantId: string) => void;
  /** Set while points are on. */
  award?: {
    presets: number[];
    give: (participantId: string, delta: number) => Promise<boolean>;
  };
}) {
  const first = buzzes[0];

  return (
    <div className="flex-1 rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Buzzes</h2>
        <span className="text-sm text-neutral-500">
          {buzzes.length} of {joined}
        </span>
      </div>

      {buzzes.length === 0 ? (
        <p className="py-10 text-center text-neutral-500">
          {status === "open"
            ? "Waiting for the first buzz…"
            : status === "waiting"
              ? "Press Open to start the round."
              : "No buzzes this round."}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {buzzes.map((b, i) => {
            // Rank among remaining buzzes: positions have gaps after a removal.
            const rank = i + 1;
            return (
              <li
                key={b.participant_id}
                className={`group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3 ${
                  rank === 1
                    ? "bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-100"
                    : "bg-neutral-100 dark:bg-neutral-900"
                }`}
              >
                <span
                  className={`w-10 text-right font-mono font-bold ${rank === 1 ? "text-3xl" : "text-xl"}`}
                >
                  {rank}
                </span>
                <span
                  className={`flex-1 truncate font-semibold ${rank === 1 ? "text-2xl" : "text-lg"}`}
                >
                  {names.get(b.participant_id) ?? "(removed)"}
                </span>
                {groupOf.has(b.participant_id) && (
                  <GroupChip group={groupOf.get(b.participant_id)!} className="text-xs" />
                )}
                {rank > 1 && first && (
                  <span className="font-mono text-sm text-neutral-500">
                    {formatGap(first.buzzed_at, b.buzzed_at)}
                  </span>
                )}
                {award && names.has(b.participant_id) && (
                  <AwardButtons
                    presets={award.presets}
                    label={names.get(b.participant_id)!}
                    onAward={(delta) => award.give(b.participant_id, delta)}
                  />
                )}
                <RemoveButton
                  name={names.get(b.participant_id)}
                  onClick={() => onRemove(b.participant_id)}
                />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ParticipantList({
  room,
  groups,
  participants,
  max,
  onRemove,
  error,
}: {
  room: Tables<"rooms">;
  /** Set only while groups are on. */
  groups: Group[] | undefined;
  participants: Tables<"participants">[];
  max: number;
  onRemove: (participantId: string) => void;
  error: string | undefined;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 p-6 dark:border-neutral-800">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Joined</h2>
        <span className="text-sm text-neutral-500">
          {participants.length} / {max}
        </span>
      </div>
      {groups ? (
        <ParticipantGroups room={room} groups={groups} participants={participants} onRemove={onRemove} />
      ) : participants.length === 0 ? (
        <p className="text-neutral-500">No one yet. Students scan the QR code to join.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {participants.map((p) => (
            <li
              key={p.id}
              className="group flex items-center gap-1 rounded-full bg-neutral-100 py-1 pr-1 pl-3 text-sm dark:bg-neutral-900"
            >
              {p.display_name}
              <RemoveButton name={p.display_name} onClick={() => onRemove(p.id)} />
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Round["status"] }) {
  const styles = {
    waiting: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    open: "bg-green-600 text-white animate-pulse",
    locked: "bg-red-600 text-white",
  }[status];
  const label = { waiting: "Waiting", open: "Buzzers open", locked: "Locked" }[status];
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${styles}`}>{label}</span>
  );
}

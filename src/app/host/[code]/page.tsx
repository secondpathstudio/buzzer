"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { use, useMemo, useState } from "react";
import { useBuzzes } from "@/hooks/useBuzzes";
import { useCurrentRound, type Round } from "@/hooks/useCurrentRound";
import { useParticipants } from "@/hooks/useParticipants";
import { useRoundActions } from "@/hooks/useRoundActions";
import type { Tables } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { formatGap, joinUrl } from "@/lib/format";
import { notifyParticipantsChanged } from "@/lib/roomEvents";
import { getSupabase } from "@/lib/supabase/client";
import { HostGate } from "@/components/HostGate";
import { ConnectionBanner } from "@/components/ConnectionBanner";
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

        <ParticipantList
          participants={participants ?? []}
          max={room.max_participants}
          onRemove={remove}
          error={removeError}
        />
      </section>

      <section className="flex flex-col gap-6">
        <RoundControls roomId={room.id} round={round ?? null} />
        <BuzzList
          buzzes={buzzes ?? []}
          names={names}
          joined={participants?.length ?? 0}
          status={round?.status}
          onRemove={remove}
        />
      </section>
    </main>
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
  onRemove,
}: {
  buzzes: Tables<"buzzes">[];
  names: Map<string, string>;
  joined: number;
  status: Round["status"] | undefined;
  onRemove: (participantId: string) => void;
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
                className={`group flex items-center gap-4 rounded-xl px-4 py-3 ${
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
                {rank > 1 && first && (
                  <span className="font-mono text-sm text-neutral-500">
                    {formatGap(first.buzzed_at, b.buzzed_at)}
                  </span>
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
  participants,
  max,
  onRemove,
  error,
}: {
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
      {participants.length === 0 ? (
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

function RemoveButton({ name, onClick }: { name: string | undefined; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Remove ${name ?? "participant"}`}
      title="Remove from room"
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-neutral-400 opacity-60 hover:bg-red-600 hover:text-white hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
    >
      ×
    </button>
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

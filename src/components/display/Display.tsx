"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { useBuzzes } from "@/hooks/useBuzzes";
import { GroupChip } from "@/components/GroupChip";
import { Scoreboard } from "@/components/display/Scoreboard";
import { useCurrentRound, type Round } from "@/hooks/useCurrentRound";
import { useDisplayBackground } from "@/hooks/useDisplayBackground";
import { useDisplayOptions } from "@/hooks/useDisplayOptions";
import { type Group, useGroups } from "@/hooks/useGroups";
import { useParticipants } from "@/hooks/useParticipants";
import { formatDelta, usePointActions } from "@/hooks/usePointActions";
import { type PointEvent, useScoreboard } from "@/hooks/useScoreboard";
import { useRoundActions } from "@/hooks/useRoundActions";
import type { Tables } from "@/lib/database.types";
import { readableText } from "@/lib/color";
import type { Media } from "@/lib/media";
import { formatGap, joinUrl } from "@/lib/format";
import { useOnRoomChanged } from "@/lib/roomEvents";

const MUTE_KEY = "buzzer:display-muted";
const TOAST_MS = 2500;

type Toast = { id: string; text: string; color: string | undefined };

/**
 * Full-screen display mode. With `controls`, the keyboard and a clicker run
 * the room (host only). Without, it's a read-only screen for a paired TV:
 * the host panel runs everything, and only F (fullscreen) and M (mute) work.
 */
export function Display({ room, controls }: { room: Tables<"rooms">; controls: boolean }) {
  const { data: round } = useCurrentRound(room.id);
  const { data: buzzes, refetch: refetchBuzzes } = useBuzzes(round?.id);
  const { data: participants, refetch: refetchParticipants } = useParticipants(room.id);
  const groupsOn = room.groups_mode !== "off";
  const { data: groups, refetch: refetchGroups } = useGroups(room.id, groupsOn);
  useOnRoomChanged(room.id, (topic) => {
    if (topic === "groups") {
      void refetchGroups();
    } else {
      void refetchParticipants();
      void refetchBuzzes();
    }
  });
  const { run, error: roundError } = useRoundActions(room.id);
  const pointsOn = room.points_enabled;
  const points = usePointActions(room);
  // Saved on the room, so the host panel can switch them on a TV.
  const showScores = room.display_scores;
  const showQr = room.display_qr;
  const options = useDisplayOptions(room.id);
  const background = useDisplayBackground(room);
  const [toast, setToast] = useState<Toast>();
  const [muted, setMuted] = useState(readMuted);
  const beep = useBeep();

  const names = useMemo(
    () => new Map(participants?.map((p) => [p.id, p.display_name])),
    [participants],
  );
  const shownGroups = groupsOn ? groups : undefined;

  // "+10 → Alice · Red" when points are awarded (inserts only, not undo).
  const toastInfo = useRef({ names, groups: shownGroups });
  useEffect(() => {
    toastInfo.current = { names, groups: shownGroups };
  });
  const { data: board, refetch: refetchBoard } = useScoreboard(room.id, pointsOn, (payload) => {
    if (payload.eventType !== "INSERT") return;
    const e = payload.new as PointEvent;
    const { names, groups } = toastInfo.current;
    const group = groups?.find((g) => g.id === e.group_id);
    const who = e.participant_id ? names.get(e.participant_id) : undefined;
    const target = [who, group ? `${group.emoji ? `${group.emoji} ` : ""}${group.name}` : undefined]
      .filter(Boolean)
      .join(" · ");
    setToast({ id: e.id, text: `${formatDelta(e.delta)} → ${target || "?"}`, color: group?.color });
  });
  useEffect(() => {
    if (pointsOn) void refetchBoard();
  }, [pointsOn, participants, groups, refetchBoard]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  const groupOf = useMemo(() => {
    const byId = new Map(shownGroups?.map((g) => [g.id, g]));
    return new Map(
      participants?.flatMap((p) => {
        const g = p.group_id ? byId.get(p.group_id) : undefined;
        return g ? [[p.id, g] as const] : [];
      }),
    );
  }, [shownGroups, participants]);

  // Space / → / PageDown: waiting → open → locked → new open round.
  const advance = useCallback(() => {
    if (!round) return;
    if (round.status === "waiting") void run("open_round");
    else if (round.status === "open") void run("lock_round");
    else void run("reset_round");
  }, [round, run]);

  // A / D: award or deduct the first preset for this round's winner.
  const winnerId = buzzes?.[0]?.participant_id;
  const awardWinner = useCallback(
    (sign: 1 | -1) => {
      if (!round || !winnerId) return;
      void points.award(sign * room.point_presets[0], { participantId: winnerId }, { roundId: round.id });
    },
    [round, winnerId, points, room.point_presets],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      beep.unlock();
      if (!controls && !"fFmM".includes(e.key)) return;
      switch (e.key) {
        case " ":
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          advance();
          break;
        case "r":
        case "R":
          void run("reset_round");
          break;
        case "l":
        case "L":
          if (round?.status === "open") void run("lock_round");
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "q":
        case "Q":
          void options.set({ qr: !showQr });
          break;
        case "s":
        case "S":
          if (pointsOn) void options.set({ scores: !showScores });
          break;
        case "a":
        case "A":
          if (pointsOn) awardWinner(1);
          break;
        case "d":
        case "D":
          if (pointsOn) awardWinner(-1);
          break;
        case "z":
        case "Z":
          if (pointsOn) void points.undo();
          break;
        case "m":
        case "M":
          setMuted((v) => {
            try {
              localStorage.setItem(MUTE_KEY, v ? "0" : "1");
            } catch {}
            return !v;
          });
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls, advance, run, round?.status, beep, pointsOn, awardWinner, points, options, showQr, showScores]);

  // A TV may never get a key press; a click unlocks sound too.
  useEffect(() => {
    const unlock = () => beep.unlock();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, [beep]);

  // Beep when the first buzz of a round arrives (not on page load).
  const lastCount = useRef<{ roundId: string; count: number }>(undefined);
  const count = buzzes?.length;
  useEffect(() => {
    if (!round || count === undefined) return;
    const prev = lastCount.current;
    if (prev?.roundId === round.id && prev.count === 0 && count > 0 && !muted) beep.play();
    lastCount.current = { roundId: round.id, count };
  }, [round, count, muted, beep]);

  const status = round?.status;
  const hasBuzzes = !!buzzes?.length;
  const url = joinUrl(room.code);
  const pulsing = status === "open" && !hasBuzzes;
  const scoresShown = pointsOn && showScores;
  // The waiting screen has its own big QR, so the overlay only shows over everything else.
  const waitingShown = !scoresShown && !!round && !hasBuzzes && status === "waiting";

  return (
    <div
      className={`fixed inset-0 flex cursor-default select-none flex-col overflow-hidden text-white ${
        pulsing && !background ? "animate-open-pulse" : "bg-neutral-950"
      }`}
    >
      {background && <Background media={background} dim={room.display_background_dim} pulsing={pulsing} />}
      <ConnectionBanner />
      <header className="flex items-center justify-between px-[3vw] pt-[2vh] text-[2.2vh] text-white/60">
        <span className="truncate">{room.title ?? ""}</span>
        {round && (
          <span className="shrink-0">
            Round {round.number} · {statusLabel(round.status)}
          </span>
        )}
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center px-[4vw]">
        {scoresShown ? (
          <Scoreboard board={board} groupsOn={groupsOn} topStudents={room.display_top_students} />
        ) : !round ? null : hasBuzzes ? (
          <Results buzzes={buzzes!} names={names} groupOf={groupOf} status={round.status} />
        ) : status === "open" ? (
          <p className="text-center text-[min(16vw,26vh)] font-black leading-none tracking-tight">
            BUZZERS
            <br />
            OPEN
          </p>
        ) : status === "locked" ? (
          <div className="text-center">
            <p className="text-[min(10vw,18vh)] font-black leading-none">Round closed</p>
            <p className="mt-[3vh] text-[4vh] text-white/60">No one buzzed</p>
          </div>
        ) : (
          <Waiting
            url={url}
            code={room.code}
            joined={participants?.length ?? 0}
            groups={shownGroups?.map((g) => ({
              group: g,
              count: participants?.filter((p) => p.group_id === g.id).length ?? 0,
            }))}
          />
        )}
      </main>

      {showQr && !waitingShown && (
        <div className="absolute right-[2vw] bottom-[8vh] flex flex-col items-center rounded-[2vh] bg-white p-[2vh] text-neutral-950 shadow-2xl">
          <QRCodeSVG value={url} size={512} marginSize={0} className="h-[32vh] w-[32vh]" />
          <p className="mt-[1.5vh] font-mono text-[5vh] font-bold tracking-[0.2em]">{room.code}</p>
        </div>
      )}

      {toast && (
        // Centred, so the totals at the top of the scoreboard stay visible.
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            key={toast.id}
            role="status"
            className="rounded-full px-[3vw] py-[1.5vh] text-[5vh] font-black shadow-2xl motion-safe:animate-reveal-pop"
            style={{
              backgroundColor: toast.color ?? "#ffffff",
              color: toast.color ? readableText(toast.color) : "#0a0a0a",
            }}
          >
            {toast.text}
          </div>
        </div>
      )}

      <footer className="flex items-center justify-between gap-6 px-[3vw] pb-[2vh] text-[1.8vh] text-white/40">
        {controls ? (
          <span>
            <Key>Space</Key> {nextLabel(status)} · <Key>R</Key> reset · <Key>L</Key> lock ·{" "}
            <Key>Q</Key> QR · <Key>F</Key> fullscreen · <Key>M</Key> {muted ? "unmute" : "mute"}
            {pointsOn && (
              <>
                {" "}· <Key>S</Key> {showScores ? "buzzer" : "scores"} · <Key>A</Key>/<Key>D</Key> ±
                {room.point_presets[0]} winner · <Key>Z</Key> undo
              </>
            )}
          </span>
        ) : (
          <span>
            <Key>F</Key> fullscreen · <Key>M</Key> {muted ? "unmute" : "mute"}
          </span>
        )}
        {controls && (roundError ?? points.error ?? options.error) && (
          <span className="text-red-400">{roundError ?? points.error ?? options.error}</span>
        )}
      </footer>
    </div>
  );
}

/** Behind everything (the root is a stacking context): the file, a dimming layer, and the open tint. */
function Background({ media, dim, pulsing }: { media: Media; dim: number; pulsing: boolean }) {
  const layer = "pointer-events-none absolute inset-0 -z-10 h-full w-full";
  return (
    <>
      {media.kind === "video" ? (
        <video key={media.url} src={media.url} autoPlay muted loop playsInline className={`${layer} object-cover`} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- user media from storage
        <img src={media.url} alt="" className={`${layer} object-cover`} />
      )}
      <div className={`${layer} bg-black`} style={{ opacity: dim / 100 }} />
      {pulsing && <div className={`${layer} animate-open-tint`} />}
    </>
  );
}

function Waiting({
  url,
  code,
  joined,
  groups,
}: {
  url: string;
  code: string;
  joined: number;
  groups: { group: Group; count: number }[] | undefined;
}) {
  return (
    <div className="flex items-center gap-[6vw]">
      <div className="rounded-[2vh] bg-white p-[2.5vh]">
        <QRCodeSVG value={url} size={1024} marginSize={0} className="h-[min(60vh,40vw)] w-[min(60vh,40vw)]" />
      </div>
      <div className="flex flex-col gap-[2vh]">
        <p className="text-[3.5vh] text-white/60">Scan to join, or go to</p>
        <p className="text-[4vh] font-semibold">{url.replace(/^https?:\/\//, "").replace(/\/r\/.*$/, "/r")}</p>
        <p className="font-mono text-[min(9vw,16vh)] font-black leading-none tracking-[0.15em]">{code}</p>
        <p className="mt-[3vh] text-[5vh] font-semibold">
          <span className="tabular-nums">{joined}</span> joined
        </p>
        {groups && groups.length > 0 && (
          <ul className="flex max-w-[45vw] flex-wrap gap-[1vh]">
            {groups.map(({ group, count }) => (
              <li key={group.id}>
                <GroupChip group={group} className="text-[3vh]">
                  <span className="tabular-nums opacity-80">{count}</span>
                </GroupChip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Results({
  buzzes,
  names,
  groupOf,
  status,
}: {
  buzzes: Tables<"buzzes">[];
  names: Map<string, string>;
  groupOf: Map<string, Group>;
  status: Round["status"];
}) {
  const [first, ...rest] = buzzes;
  const winner = names.get(first.participant_id) ?? "(removed)";
  const winnerGroup = groupOf.get(first.participant_id);

  return (
    <div className="flex w-full flex-col items-center text-center">
      <p className="text-[4vh] font-bold uppercase tracking-[0.3em] text-amber-300/80">First</p>
      <p
        className="max-w-full break-words font-black leading-[1.05] text-amber-300"
        style={{ fontSize: fitSize(winner, 26, 150) }}
      >
        {winner}
      </p>
      {winnerGroup && <GroupChip group={winnerGroup} className="mt-[2vh] text-[5vh]" />}
      {rest.length > 0 && (
        <ol className="mt-[5vh] flex flex-wrap justify-center gap-x-[5vw] gap-y-[2vh] text-[5vh]">
          {rest.slice(0, 2).map((b, i) => (
            <li key={b.participant_id} className="flex items-baseline gap-[1vw]">
              <span className="font-mono text-white/50">{i + 2}</span>
              <span className="font-semibold">{names.get(b.participant_id) ?? "(removed)"}</span>
              {groupOf.has(b.participant_id) && (
                <GroupChip group={groupOf.get(b.participant_id)!} className="self-center text-[2.5vh]" />
              )}
              <span className="font-mono text-[3vh] text-white/50">
                {formatGap(first.buzzed_at, b.buzzed_at)}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-[5vh] text-[3vh] text-white/50">
        {buzzes.length} buzzed{status === "open" ? " · buzzers still open" : ""}
      </p>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-white/20 px-[0.5em] font-sans">{children}</kbd>;
}

/** Shrink long names so they fit the screen width. */
function fitSize(text: string, maxVh: number, widthBudgetVw: number) {
  return `min(${maxVh}vh, ${Math.min(maxVh, widthBudgetVw / Math.max(text.length, 1)).toFixed(2)}vw)`;
}

function statusLabel(status: Round["status"]) {
  return { waiting: "Waiting", open: "Open", locked: "Locked" }[status];
}

function nextLabel(status: Round["status"] | undefined) {
  return status === "waiting" ? "open buzzers" : status === "open" ? "lock" : "next round";
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** A short two-tone chime via Web Audio; no sound file needed. */
function useBeep() {
  const ctx = useRef<AudioContext>(undefined);
  return useMemo(
    () => ({
      // Browsers only allow audio after a user gesture; call on key presses.
      unlock() {
        ctx.current ??= new AudioContext();
        if (ctx.current.state === "suspended") void ctx.current.resume();
      },
      play() {
        const c = ctx.current;
        if (!c || c.state !== "running") return;
        [880, 1320].forEach((freq, i) => {
          const start = c.currentTime + i * 0.12;
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = "triangle";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.3, start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
          osc.connect(gain).connect(c.destination);
          osc.start(start);
          osc.stop(start + 0.4);
        });
      },
    }),
    [],
  );
}

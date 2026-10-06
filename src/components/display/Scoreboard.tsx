import { GroupChip } from "@/components/GroupChip";
import type { IndividualScore, Scoreboard as Board } from "@/hooks/useScoreboard";

/**
 * Projector scoreboard: a bar per group in group colours (bars animate as
 * totals change) with the top 5 students below, or the top 10 students
 * when groups are off.
 */
export function Scoreboard({ board, groupsOn }: { board: Board | undefined; groupsOn: boolean }) {
  if (!board) return null;
  const groups = groupsOn ? board.groups : [];
  const top = board.individuals.filter((p) => p.total !== 0);

  if (groups.length === 0) {
    return (
      <div className="w-full max-w-[70vw]">
        <h2 className="mb-[3vh] text-center text-[5vh] font-black uppercase tracking-[0.2em] text-white/60">
          Scoreboard
        </h2>
        <TopStudents students={top.slice(0, 10)} size="large" />
      </div>
    );
  }

  const max = Math.max(1, ...groups.map((g) => g.total));
  return (
    <div className="flex h-full w-full flex-col items-center gap-[3vh] py-[2vh]">
      <div className="flex min-h-0 w-full flex-1 items-stretch justify-center gap-[3vw]">
        {groups.map((g) => (
          <div key={g.id} className="flex w-[min(14vw,22vh)] min-w-0 flex-col items-center gap-[1.5vh]">
            <span className="font-mono text-[6vh] font-black tabular-nums leading-none">{g.total}</span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-[1.5vh] motion-safe:transition-[height] motion-safe:duration-700 motion-safe:ease-out"
                style={{
                  height: `${(Math.max(0, g.total) / max) * 100}%`,
                  minHeight: "0.8vh",
                  backgroundColor: g.color,
                }}
              />
            </div>
            <GroupChip group={g} className="text-[2.6vh]" />
          </div>
        ))}
      </div>
      {top.length > 0 && <TopStudents students={top.slice(0, 5)} size="small" />}
    </div>
  );
}

function TopStudents({ students, size }: { students: IndividualScore[]; size: "small" | "large" }) {
  if (students.length === 0) {
    return <p className="text-center text-[4vh] text-white/50">No points yet</p>;
  }
  if (size === "small") {
    return (
      <ol className="flex flex-wrap justify-center gap-x-[3vw] gap-y-[1vh] text-[3vh]">
        {students.map((p, i) => (
          <li key={p.participant_id} className="flex items-baseline gap-[0.6vw]">
            <span className="font-mono text-white/50">{i + 1}</span>
            <span className="font-semibold">{p.display_name}</span>
            <span className="font-mono text-white/70 tabular-nums">{p.total}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="flex flex-col gap-[1.2vh] text-[4.5vh]">
      {students.map((p, i) => (
        <li key={p.participant_id} className="flex items-baseline gap-[2vw] border-b border-white/10 pb-[1vh]">
          <span className="w-[4vw] text-right font-mono text-white/50">{i + 1}</span>
          <span className="flex-1 truncate font-semibold">{p.display_name}</span>
          <span className="font-mono font-bold tabular-nums">{p.total}</span>
        </li>
      ))}
    </ol>
  );
}

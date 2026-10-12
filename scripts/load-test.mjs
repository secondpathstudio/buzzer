// Load test: one host and N simulated students against a real Supabase project.
// Usage: node --env-file=.env.local scripts/load-test.mjs [--students=50] [--rounds=3]
//          [--jitter=500] [--no-groups] [--no-points]
//
// Each student is its own client with its own realtime socket, subscribed to
// the same tables as the student page and refetching on every event the way
// useLiveQuery does. The test times joins, how fast an Open reaches every
// phone, a buzz storm, how fast the host sees all buzzes, and the scoreboard
// refetch fan-out after a point award.
//
// Anonymous sign-ins are limited per IP (30/hour by default; raise it under
// Auth -> Rate Limits). Student sessions are saved to scripts/.load-test-users.json
// (gitignored) and reused, so only the first run needs new sign-ins. Each run
// makes one new host and one room, which expires after 24h.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Missing Supabase env vars; run with --env-file=.env.local");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const N = Number(args.students ?? 50);
const ROUNDS = Number(args.rounds ?? 3);
const JITTER_MS = Number(args.jitter ?? 500); // human reaction spread before buzzing
const GROUPS = !args["no-groups"];
const POINTS = !args["no-points"];
const WAIT_MS = 15_000;
const CACHE = new URL("./.load-test-users.json", import.meta.url);

if (N + 1 > 200) console.warn(`WARN  ${N + 1} sockets exceeds Supabase Free's 200 realtime connections`);

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

/** Run fn over items with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

function stats(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  const pct = (p) => (v.length ? Math.round(v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))]) : NaN);
  return { n: v.length, p50: pct(50), p95: pct(95), max: v.length ? Math.round(v[v.length - 1]) : NaN };
}

const rows = [];
let failed = 0;
let warned = 0;
function report(label, values, total, { target } = {}) {
  const s = stats(values);
  const ok = s.n === total;
  const slow = target != null && s.p95 > target;
  if (!ok) failed++;
  else if (slow) warned++;
  rows.push({ label, s, total, status: !ok ? "FAIL" : slow ? "WARN" : "ok" });
  console.log(
    `${!ok ? "FAIL" : slow ? "WARN" : "ok  "}  ${label.padEnd(38)} ${String(s.n).padStart(4)}/${total}` +
      `  p50 ${String(s.p50).padStart(5)}ms  p95 ${String(s.p95).padStart(5)}ms  max ${String(s.max).padStart(5)}ms`,
  );
}
function check(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

/** Counts queries per phase, to show how much one event fans out. */
let queries = 0;

function newClient() {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(saved) {
  const c = newClient();
  if (saved) {
    const { data, error } = await c.auth.setSession(saved);
    // Refresh early so the token can't expire mid-test.
    const exp = data.session?.expires_at ?? 0;
    if (!error && exp * 1000 - Date.now() < 10 * 60_000) await c.auth.refreshSession();
    const { data: s } = await c.auth.getSession();
    if (s.session) {
      await c.realtime.setAuth(s.session.access_token);
      return c;
    }
  }
  const { error } = await c.auth.signInAnonymously();
  if (error) {
    const hint = error.status === 429 ? " (anonymous sign-in rate limit; raise it under Auth -> Rate Limits)" : "";
    throw new Error(`anonymous sign-in failed: ${error.message}${hint}`);
  }
  const { data: s } = await c.auth.getSession();
  await c.realtime.setAuth(s.session.access_token);
  return c;
}

async function rpc(c, fn, params) {
  queries++;
  const { data, error } = await c.rpc(fn, params);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/**
 * A query kept fresh by a postgres_changes subscription, mirroring
 * useLiveQuery: every event triggers a refetch, with at most one in flight
 * and one queued. waitFor() resolves with the time a fetch that *started*
 * after `since` returned data matching the predicate.
 */
class Live {
  constructor(client, { name, table, filter, event = "*", fetch }) {
    Object.assign(this, { client, name, table, filter, event, fetch });
    this.data = undefined;
    this.fetchedAt = -1; // start time of the fetch that produced `data`
    this.waiters = new Set();
    this.inFlight = false;
    this.queued = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.channel = this.client
        .channel(`${this.name}:${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: this.event, schema: "public", table: this.table, filter: this.filter }, () =>
          this.refetch(),
        )
        // Changes only flow once Realtime confirms the Postgres side, a beat
        // after SUBSCRIBED; anything earlier is missed.
        .on("system", {}, (p) => {
          if (p.extension !== "postgres_changes") return;
          if (p.status === "ok") {
            this.refetch();
            resolve();
          } else reject(new Error(`${this.name}: ${p.message}`));
        })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            reject(new Error(`${this.name} ${status}${err ? `: ${err.message}` : ""}`));
          }
        });
    });
  }

  async refetch() {
    if (this.inFlight) {
      this.queued = true;
      return;
    }
    this.inFlight = true;
    try {
      do {
        this.queued = false;
        const started = now();
        queries++;
        try {
          this.data = await this.fetch(this.client);
          this.fetchedAt = started;
          for (const w of this.waiters) w.check();
        } catch {
          // Keep the last good data; the next event retries.
        }
      } while (this.queued);
    } finally {
      this.inFlight = false;
    }
  }

  waitFor(since, pred = () => true, timeout = WAIT_MS) {
    return new Promise((resolve) => {
      const w = {
        check: () => {
          if (this.fetchedAt >= since && pred(this.data)) done(now());
        },
      };
      const timer = setTimeout(() => done(null), timeout);
      const done = (t) => {
        clearTimeout(timer);
        this.waiters.delete(w);
        resolve(t);
      };
      this.waiters.add(w);
      w.check();
    });
  }

  stop() {
    if (this.channel) return this.client.removeChannel(this.channel);
  }
}

// Same queries as the hooks in src/hooks.
const fetchers = {
  room: (code) => async (c) => (await c.from("rooms").select("*").eq("code", code).maybeSingle()).data,
  round: (roomId) => async (c) =>
    (await c.from("rooms").select("current_round:rounds!rooms_current_round_fk(*)").eq("id", roomId).maybeSingle())
      .data?.current_round ?? null,
  groups: (roomId) => async (c) =>
    (await c.from("groups").select("*").eq("room_id", roomId).order("sort_order").order("created_at")).data,
  scoreboard: (roomId) => async (c) => {
    const { data, error } = await c.rpc("get_scoreboard", { p_room_id: roomId });
    if (error) throw error;
    return data;
  },
  participants: (roomId) => async (c) =>
    (await c.from("participants").select("*").eq("room_id", roomId).order("joined_at")).data,
  buzzes: (roundId) => async (c) =>
    (await c.from("buzzes").select("*").eq("round_id", roundId).order("position")).data,
};

// ---------------------------------------------------------------- setup

console.log(
  `Load test: ${N} students, ${ROUNDS} rounds, groups ${GROUPS ? "on" : "off"}, points ${POINTS ? "on" : "off"}\n`,
);

let saved = [];
try {
  saved = JSON.parse(readFileSync(CACHE, "utf8"));
} catch {}

let t = now();
const host = await signIn(null);
let fresh = 0;
const students = await pool(Array.from({ length: N }), 10, async (_, i) => {
  if (!saved[i]) fresh++;
  return { i, client: await signIn(saved[i]) };
});
const sessions = await Promise.all(students.map(async (s) => (await s.client.auth.getSession()).data.session));
writeFileSync(
  CACHE,
  JSON.stringify(
    [...sessions.map((s) => ({ access_token: s.access_token, refresh_token: s.refresh_token })), ...saved.slice(N)],
  ),
);
console.log(`Signed in ${N} students (${fresh} new, ${N - fresh} reused) in ${Math.round(now() - t)}ms\n`);

const room = await rpc(host, "create_room", { p_title: `Load test ${N}` });
if (GROUPS) {
  const colors = ["#dc2626", "#2563eb", "#16a34a", "#ca8a04"];
  await rpc(host, "save_groups", {
    p_room_id: room.id,
    p_groups: colors.map((color, i) => ({ name: `Team ${i + 1}`, color })),
  });
  await rpc(host, "set_group_settings", { p_room_id: room.id, p_mode: "random" });
}
if (POINTS) await rpc(host, "set_points_settings", { p_room_id: room.id, p_enabled: true });

// Host subscriptions, as on the host page.
const hostRound = new Live(host, { name: "h-round", table: "rounds", filter: `room_id=eq.${room.id}`, fetch: fetchers.round(room.id) });
const hostParts = new Live(host, { name: "h-parts", table: "participants", filter: `room_id=eq.${room.id}`, fetch: fetchers.participants(room.id) });
await Promise.all([hostRound.start(), hostParts.start()]);

// ---------------------------------------------------------------- join

t = now();
const joinTimes = [];
const joinErrors = [];
await Promise.all(
  students.map(async (s) => {
    const t0 = now();
    try {
      await rpc(s.client, "get_join_info", { p_code: room.code });
      s.participant = await rpc(s.client, "join_room", {
        p_code: room.code,
        p_display_name: `Load ${String(s.i + 1).padStart(3, "0")}`,
      });
      joinTimes.push(now() - t0);
    } catch (e) {
      joinErrors.push(e.message);
    }
  }),
);
report("join (get_join_info + join_room)", joinTimes, N, { target: 2000 });
if (joinErrors.length) console.log(`      errors: ${[...new Set(joinErrors)].join(", ")}`);
const hostSawAll = await hostParts.waitFor(t, (d) => d?.length === N);
check("host roster shows every student", hostSawAll != null, hostSawAll ? `${Math.round(hostSawAll - t)}ms after first join` : `saw ${hostParts.data?.length}`);

if (GROUPS) {
  const counts = new Map();
  for (const p of hostParts.data ?? []) counts.set(p.group_id, (counts.get(p.group_id) ?? 0) + 1);
  const sizes = [...counts.values()];
  check("groups balanced", sizes.length > 0 && !counts.has(null) && Math.max(...sizes) - Math.min(...sizes) <= 1, `sizes ${sizes.join("/")}`);
}

// ---------------------------------------------------------------- subscribe

const joined = students.filter((s) => s.participant);
t = now();
const subTimes = [];
const subErrors = [];
await pool(joined, 25, async (s) => {
  const t0 = now();
  const c = s.client;
  s.round = new Live(c, { name: "round", table: "rounds", filter: `room_id=eq.${room.id}`, fetch: fetchers.round(room.id) });
  s.lives = [
    new Live(c, { name: "room", table: "rooms", filter: `code=eq.${room.code}`, event: "UPDATE", fetch: fetchers.room(room.code) }),
    s.round,
    new Live(c, { name: "me", table: "participants", filter: `id=eq.${s.participant.id}`, fetch: async () => null }),
  ];
  if (GROUPS) s.lives.push(new Live(c, { name: "groups", table: "groups", filter: `room_id=eq.${room.id}`, fetch: fetchers.groups(room.id) }));
  if (POINTS) {
    s.board = new Live(c, { name: "board", table: "point_events", filter: `room_id=eq.${room.id}`, fetch: fetchers.scoreboard(room.id) });
    s.lives.push(s.board);
  }
  try {
    await Promise.all(s.lives.map((l) => l.start()));
    subTimes.push(now() - t0);
  } catch (e) {
    subErrors.push(e.message);
  }
});
const channels = joined.reduce((n, s) => n + s.lives.length, 0);
report(`subscribe (${channels} channels)`, subTimes, joined.length, { target: 3000 });
if (subErrors.length) console.log(`      errors: ${[...new Set(subErrors)].join(", ")}`);
// Let the initial fetches settle before timing anything.
await sleep(1000);

// ---------------------------------------------------------------- rounds

const wins = new Map();
for (let r = 1; r <= ROUNDS; r++) {
  console.log(`\nRound ${r}`);
  queries = 0;
  const t0 = now();
  const round = r === 1
    ? await rpc(host, "open_round", { p_room_id: room.id })
    : await rpc(host, "reset_round", { p_room_id: room.id });
  const openRpc = now() - t0;

  const hostBuzzes = new Live(host, { name: "h-buzzes", table: "buzzes", filter: `round_id=eq.${round.id}`, fetch: fetchers.buzzes(round.id) });
  await hostBuzzes.start();

  // Each student buzzes as soon as their phone shows the round open.
  const seen = [];
  const buzzTimes = [];
  const positions = [];
  let lastBuzzAt = 0;
  await Promise.all(
    joined.map(async (s) => {
      const at = await s.round.waitFor(t0, (d) => d?.id === round.id && d.status === "open");
      if (at == null) return;
      seen.push(at - t0);
      await sleep(Math.random() * JITTER_MS);
      const b0 = now();
      try {
        positions.push(await rpc(s.client, "buzz", { p_round_id: round.id }));
        buzzTimes.push(now() - b0);
        lastBuzzAt = Math.max(lastBuzzAt, now());
      } catch {}
    }),
  );
  console.log(`      open_round RPC ${Math.round(openRpc)}ms`);
  report("open reaches every phone", seen, joined.length, { target: 1000 });
  report("buzz RPC", buzzTimes, joined.length, { target: 1000 });

  const hostAll = await hostBuzzes.waitFor(0, (d) => d?.length === buzzTimes.length);
  check(
    "host sees every buzz",
    hostAll != null,
    hostAll != null ? `${Math.round(Math.max(0, hostAll - lastBuzzAt))}ms after the last buzz` : `saw ${hostBuzzes.data?.length}`,
  );
  const list = hostBuzzes.data ?? [];
  const sorted = [...positions].sort((a, b) => a - b);
  check("positions are 1..N with no gaps or repeats", sorted.every((p, i) => p === i + 1));
  check(
    "position order matches server time",
    list.every((b, i) => i === 0 || new Date(list[i - 1].buzzed_at) <= new Date(b.buzzed_at)),
  );
  console.log(`      queries during the round: ${queries}`);
  await hostBuzzes.stop();

  if (POINTS && list.length) {
    const winner = list[0].participant_id;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
    queries = 0;
    const a0 = now();
    await rpc(host, "award_points", { p_room_id: room.id, p_participant_id: winner, p_delta: 5, p_round_id: round.id });
    // RLS only sends the event to the winner and their groupmates: the
    // student footer shows just their own and their group's total.
    const group = joined.find((s) => s.participant.id === winner)?.participant.group_id;
    const told = joined.filter((s) => s.participant.id === winner || (group && s.participant.group_id === group));
    const boards = await Promise.all(told.map((s) => s.board.waitFor(a0).then((at) => (at == null ? null : at - a0))));
    report("award reaches winner + groupmates", boards, told.length, { target: 1000 });
    await sleep(1000);
    console.log(`      queries for one award: ${queries} (${told.length} get_scoreboard expected)`);
  }
}

if (POINTS) {
  const [winner, n] = [...wins.entries()][0] ?? [];
  const s = joined.find((x) => x.participant.id === winner);
  const mine = s?.board.data?.individuals?.find((x) => x.participant_id === winner)?.total;
  check("winner's own scoreboard total", mine === 5 * n, `${mine} vs ${5 * n}`);
}

// ---------------------------------------------------------------- done

await Promise.all([...joined.flatMap((s) => s.lives.map((l) => l.stop())), hostRound.stop(), hostParts.stop()]);
console.log(
  `\nRoom ${room.code} (expires in 24h). ${failed ? `${failed} failure(s)` : "No failures"}` +
    `${warned ? `, ${warned} slower than target` : ""}.`,
);
process.exit(failed ? 1 : 0);

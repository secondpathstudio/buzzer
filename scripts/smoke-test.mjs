// End-to-end check of the schema against a real Supabase project.
// Usage: node --env-file=.env.local scripts/smoke-test.mjs
// Creates 3 anonymous users and one room (which expires after 24h).
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function user() {
  const c = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`);
  return c;
}

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const [host, alice, bob] = await Promise.all([user(), user(), user()]);

const { data: room, error: e1 } = await host.rpc("create_room", { p_title: "Smoke test" });
check("create_room", !e1 && room?.code?.length === 6, e1?.message ?? room?.code);

const { error: e2 } = await alice.rpc("join_room", { p_code: room.code.toLowerCase(), p_display_name: " Alice " });
const { error: e3 } = await bob.rpc("join_room", { p_code: room.code, p_display_name: "Bob" });
check("students join (case-insensitive code)", !e2 && !e3, e2?.message ?? e3?.message);

const { error: e4 } = await alice.rpc("join_room", { p_code: "ZZZZZZ", p_display_name: "Alice" });
check("unknown code -> room_not_found", e4?.message === "room_not_found", e4?.message);

const { error: e5 } = await alice.rpc("open_round", { p_room_id: room.id });
check("student can't open -> not_host", e5?.message === "not_host", e5?.message);

const { error: e6 } = await alice.rpc("buzz", { p_round_id: room.current_round_id });
check("buzz before open -> round_not_open", e6?.message === "round_not_open", e6?.message);

const { error: e7 } = await host.rpc("open_round", { p_room_id: room.id });
check("host opens round", !e7, e7?.message);

const { data: posB } = await bob.rpc("buzz", { p_round_id: room.current_round_id });
const { data: posA } = await alice.rpc("buzz", { p_round_id: room.current_round_id });
const { data: posB2 } = await bob.rpc("buzz", { p_round_id: room.current_round_id });
check("buzz order", posB === 1 && posA === 2, `bob=${posB} alice=${posA}`);
check("double buzz returns same position", posB2 === 1, `bob again=${posB2}`);

const { data: buzzes } = await host.from("buzzes").select("*").eq("round_id", room.current_round_id).order("position");
check("host sees 2 buzzes in order", buzzes?.length === 2 &&
  new Date(buzzes[0].buzzed_at) <= new Date(buzzes[1].buzzed_at));

const { data: round } = await host.from("rounds").select("winner_id").eq("id", room.current_round_id).single();
check("winner_id set", round?.winner_id === buzzes?.[0]?.participant_id);

const outsider = await user();
const { data: peek } = await outsider.from("participants").select("*").eq("room_id", room.id);
check("outsider sees no participants (RLS)", peek?.length === 0, `saw ${peek?.length}`);

const { error: e8 } = await alice.from("buzzes").delete().eq("round_id", room.current_round_id);
const { data: still } = await host.from("buzzes").select("*").eq("round_id", room.current_round_id);
check("clients can't write tables", still?.length === 2, e8?.message);

const { data: next, error: e9 } = await host.rpc("reset_round", { p_room_id: room.id });
check("reset opens round 2", !e9 && next?.number === 2 && next?.status === "open", e9?.message);
const { data: posA2 } = await alice.rpc("buzz", { p_round_id: next.id });
check("buzz in new round", posA2 === 1, `alice=${posA2}`);
const { error: e10 } = await bob.rpc("buzz", { p_round_id: room.current_round_id });
check("old round is locked", e10?.message === "round_not_open", e10?.message);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);

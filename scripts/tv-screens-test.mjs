// Checks TV screen pairing (supabase/migrations/*_tv_screens.sql) against a
// real Supabase project.
// Usage: node --env-file=.env.local scripts/tv-screens-test.mjs
// Creates 4 anonymous users and 3 rooms (which expire after 24h). The test
// background image is removed at the end.
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

async function rpc(c, fn, params) {
  const { data, error } = await c.rpc(fn, params);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

const [host, student, screen, otherHost] = await Promise.all([user(), user(), user(), user()]);
const screenId = (await screen.auth.getUser()).data.user.id;

// Unpaired screen
const s1 = await rpc(screen, "get_screen_state");
check("unpaired screen gets a 6-char code", !s1.paired && /^[A-Z2-9]{6}$/.test(s1.pair_code), s1.pair_code);
const s2 = await rpc(screen, "get_screen_state");
check("code is stable between calls", s2.pair_code === s1.pair_code);

const room1 = await rpc(host, "create_room", { p_title: "TV test 1" });
await rpc(student, "join_room", { p_code: room1.code, p_display_name: "Student" });
await rpc(otherHost, "create_room", { p_title: "Other host" });

const { data: peek } = await screen.from("rooms").select("id").eq("id", room1.id);
check("unpaired screen can't see the room", peek?.length === 0, `saw ${peek?.length}`);

// Pairing
const { error: e1 } = await host.rpc("pair_screen", { p_code: "ZZZZZZ" });
check("wrong code -> invalid_pair_code", e1?.message === "invalid_pair_code", e1?.message);
const { error: e2 } = await student.rpc("pair_screen", { p_code: s1.pair_code });
check("non-host can't pair -> not_host", e2?.message === "not_host", e2?.message);
const paired = await rpc(host, "pair_screen", { p_code: ` ${s1.pair_code.slice(0, 3).toLowerCase()} ${s1.pair_code.slice(3)} ` });
check("host pairs with a lowercase, spaced code", paired?.user_id === screenId);
const { error: e3 } = await otherHost.rpc("pair_screen", { p_code: s1.pair_code });
check("code can't be reused", e3?.message === "invalid_pair_code", e3?.message);

let st = await rpc(screen, "get_screen_state");
check("paired screen shows the host's room", st.paired && st.room_code === room1.code, st.room_code);
const { data: hostScreens } = await host.from("screens").select("user_id");
check("host sees their screen", hostScreens?.length === 1 && hostScreens[0].user_id === screenId);
const { data: otherScreens } = await otherHost.from("screens").select("user_id");
check("other host doesn't", otherScreens?.length === 0);

// Read access
const { data: r } = await screen.from("rooms").select("*").eq("id", room1.id);
const { data: parts } = await screen.from("participants").select("*").eq("room_id", room1.id);
const { data: rounds } = await screen.from("rounds").select("*").eq("room_id", room1.id);
check("screen reads room, participants, rounds", r?.length === 1 && parts?.length === 1 && rounds?.length === 1);

await rpc(host, "set_points_settings", { p_room_id: room1.id, p_enabled: true });
await rpc(host, "open_round", { p_room_id: room1.id });
await rpc(student, "buzz", { p_round_id: room1.current_round_id });
const { data: buzzes } = await screen.from("buzzes").select("*").eq("round_id", room1.current_round_id);
check("screen reads buzzes", buzzes?.length === 1);
await rpc(host, "award_points", { p_room_id: room1.id, p_participant_id: parts[0].id, p_delta: 5 });
const { data: events } = await screen.from("point_events").select("*").eq("room_id", room1.id);
const board = await rpc(screen, "get_scoreboard", { p_room_id: room1.id });
check("screen reads point events and the full scoreboard", events?.length === 1 && board.individuals?.[0]?.total === 5);

// Realtime reaches the screen
const got = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 10_000);
  screen
    .channel("tv-test")
    .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: `room_id=eq.${room1.id}` }, () => {
      clearTimeout(timer);
      resolve(true);
    })
    .on("system", {}, (p) => {
      if (p.extension === "postgres_changes" && p.status === "ok") host.rpc("lock_round", { p_room_id: room1.id }).then(() => {});
    })
    .subscribe();
});
check("screen gets realtime round changes", await got);
await screen.removeAllChannels();

// Screens are read-only
const { error: e4 } = await screen.rpc("reset_round", { p_room_id: room1.id });
check("screen can't control rounds -> not_host", e4?.message === "not_host", e4?.message);
const { error: e5 } = await screen.rpc("set_display_options", { p_room_id: room1.id, p_scores: true });
check("screen can't change display options -> not_host", e5?.message === "not_host", e5?.message);

// Display options
const opts = await rpc(host, "set_display_options", { p_room_id: room1.id, p_scores: true });
check("host sets scoreboard on", opts.display_scores === true && opts.display_qr === false);
const opts2 = await rpc(host, "set_display_options", { p_room_id: room1.id, p_qr: true });
check("null leaves the other option alone", opts2.display_scores === true && opts2.display_qr === true);

// Display background
const BUCKET = "buzzer-bucket";
const hostId = (await host.auth.getUser()).data.user.id;
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
const bgId = crypto.randomUUID();
const bgPath = `${hostId}/${bgId}.png`;
const { error: upErr } = await host.storage.from(BUCKET).upload(bgPath, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" });
if (upErr) throw new Error(`upload: ${upErr.message}`);
try {
  await rpc(host, "register_media_asset", {
    p_asset_id: bgId, p_storage_path: bgPath, p_kind: "image", p_mime_type: "image/png", p_bytes: PNG.length, p_label: "bg",
  });
  check("no background by default", (await rpc(screen, "get_display_background", { p_room_id: room1.id })) === null);
  const withBg = await rpc(host, "set_display_background", { p_room_id: room1.id, p_media_id: bgId });
  check("host sets a background", withBg.display_background_media_id === bgId);
  const bg = await rpc(screen, "get_display_background", { p_room_id: room1.id });
  check("screen reads the background", bg?.path === bgPath && bg?.kind === "image", JSON.stringify(bg));
  const { error: e8 } = await student.rpc("get_display_background", { p_room_id: room1.id });
  check("student can't read it -> not_host", e8?.message === "not_host", e8?.message);
  const { error: e9 } = await screen.rpc("set_display_background", { p_room_id: room1.id });
  check("screen can't change it -> not_host", e9?.message === "not_host", e9?.message);
  const otherRoom = await rpc(otherHost, "create_room", { p_title: "TV test other" });
  const { error: e10 } = await otherHost.rpc("set_display_background", { p_room_id: otherRoom.id, p_media_id: bgId });
  check("can't use another host's media -> invalid_media", e10?.message === "invalid_media", e10?.message);
  check("background dim defaults to 55", withBg.display_background_dim === 55, withBg.display_background_dim);
  const dimmed = await rpc(host, "set_display_background_dim", { p_room_id: room1.id, p_dim: 80 });
  check("host sets the dim", dimmed.display_background_dim === 80);
  const { error: e11 } = await host.rpc("set_display_background_dim", { p_room_id: room1.id, p_dim: 95 });
  check("dim over 90 rejected", e11?.message === "invalid_background_dim", e11?.message);
  const { error: e12 } = await screen.rpc("set_display_background_dim", { p_room_id: room1.id, p_dim: 10 });
  check("screen can't change the dim -> not_host", e12?.message === "not_host", e12?.message);
  await rpc(host, "delete_media_asset", { p_asset_id: bgId });
  const { data: cleared } = await host.from("rooms").select("display_background_media_id").eq("id", room1.id).single();
  check("deleting the file clears the background", cleared.display_background_media_id === null);
} finally {
  await host.rpc("delete_media_asset", { p_asset_id: bgId });
  await host.storage.from(BUCKET).remove([bgPath]);
}

// Which room the screen shows
const room2 = await rpc(host, "create_room", { p_title: "TV test 2" });
st = await rpc(screen, "get_screen_state");
check("a newer room takes over the screen", st.room_code === room2.code, st.room_code);
await rpc(host, "show_room_on_screens", { p_room_id: room1.id });
st = await rpc(screen, "get_screen_state");
check("Show on TV pins an older room", st.room_code === room1.code, st.room_code);
const room3 = await rpc(host, "create_room", { p_title: "TV test 3" });
st = await rpc(screen, "get_screen_state");
check("creating a room after pinning shows the new one", st.room_code === room3.code, st.room_code);
const { error: e6 } = await otherHost.rpc("show_room_on_screens", { p_room_id: room1.id });
check("other host can't pin -> not_host", e6?.message === "not_host", e6?.message);

// Unpairing
const { error: e7 } = await otherHost.rpc("unpair_screen", { p_user_id: screenId });
check("other host can't unpair -> not_host", e7?.message === "not_host", e7?.message);
await rpc(host, "unpair_screen", { p_user_id: screenId });
st = await rpc(screen, "get_screen_state");
check("unpaired screen gets a new code", !st.paired && st.pair_code && st.pair_code !== s1.pair_code, st.pair_code);
const { data: after } = await screen.from("rooms").select("id").eq("id", room1.id);
check("unpaired screen loses access", after?.length === 0, `saw ${after?.length}`);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);

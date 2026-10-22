// Checks for the groups / points / reveal media migration
// (PLAN-groups-points.md §13) against a real Supabase project.
// Usage: node --env-file=.env.local scripts/groups-points-test.mjs
//
// Uses 12 anonymous sign-ins (stay under Auth → Rate Limits). Rooms expire
// after 24h; uploaded test files are removed at the end.
// Gating checks (§13.9, §13.14) temporarily remove plan_features rows, so
// they only run when SUPABASE_SERVICE_ROLE_KEY is set. Never run them
// against a database real classes are using.
import { createClient } from "@supabase/supabase-js";
import { roomTicket } from "./room-ticket.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "buzzer-bucket";
const STUDENTS = 9;

async function user() {
  const c = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`);
  c.uid = data.user.id;
  return c;
}

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

const COLORS = ["#E53935", "#FDD835", "#1E88E5", "#43A047"];
function groupList(n) {
  return Array.from({ length: n }, (_, i) => ({ name: `G${i + 1}`, color: COLORS[i % 4] }));
}

async function sizes(host, roomId) {
  const { data } = await host.from("participants").select("group_id").eq("room_id", roomId);
  const counts = new Map();
  for (const p of data) counts.set(p.group_id, (counts.get(p.group_id) ?? 0) + 1);
  return { counts, unassigned: counts.get(null) ?? 0, list: [...counts.values()].sort((a, b) => b - a) };
}
const spread = (list) => Math.max(...list) - Math.min(...list);

async function room(host, title) {
  return rpc(host, "create_room", { p_ticket: await roomTicket(host), p_title: title, p_replace: true });
}

const host = await user();
const host2 = await user();
const outsider = await user();
const students = [];
for (let i = 0; i < STUDENTS; i++) students.push(await user());
const join = (s, code, i, groupId) =>
  s.rpc("join_room", { p_code: code, p_display_name: `S${i}`, p_group_id: groupId ?? undefined });

// ---------- 0. Defaults: everything off ----------
const A = await room(host, "GP test A");
check("new room has groups off and points off", A.groups_mode === "off" && A.points_enabled === false);
const ent = await rpc(host, "get_room_entitlements", { p_room_id: A.id });
check("self-hosted: all features entitled", ["custom_media", "groups", "points"].every((f) => ent.features.includes(f)), JSON.stringify(ent));
const { error: entErr } = await students[0].rpc("get_room_entitlements", { p_room_id: A.id });
check("entitlements are host only", entErr?.message === "not_host", entErr?.message);

// ---------- 1. Even distribution (sequential) ----------
const { error: modeErr } = await host.rpc("set_group_settings", { p_room_id: A.id, p_mode: "random" });
check("random needs groups first", modeErr?.message === "need_at_least_two_groups", modeErr?.message);
const { error: countErr } = await host.rpc("save_groups", { p_room_id: A.id, p_groups: groupList(1) });
check("1 group -> invalid_group_count", countErr?.message === "invalid_group_count", countErr?.message);
const groupsA = await rpc(host, "save_groups", { p_room_id: A.id, p_groups: groupList(4) });
await rpc(host, "set_group_settings", { p_room_id: A.id, p_mode: "random", p_noun: "House", p_noun_plural: "Houses" });
for (let i = 0; i < STUDENTS; i++) {
  const { error } = await join(students[i], A.code, i);
  if (error) throw new Error(`join A: ${error.message}`);
}
const sA = await sizes(host, A.id);
check("sequential joins balanced (9 into 4 -> 3/2/2/2)", sA.unassigned === 0 && sA.list.join("/") === "3/2/2/2", sA.list.join("/"));

// ---------- 11. Rejoin keeps group, no new slot ----------
const { data: before } = await students[0].from("participants").select("id, group_id").eq("room_id", A.id).eq("user_id", students[0].uid).single();
const { data: rejoined } = await join(students[0], A.code, 0, groupsA[3].id);
const { count: countA } = await host.from("participants").select("*", { count: "exact", head: true }).eq("room_id", A.id);
check("rejoin keeps group and slot", rejoined?.group_id === before.group_id && countA === STUDENTS, `count=${countA}`);

// ---------- join info ----------
const info = await rpc(outsider, "get_join_info", { p_code: A.code.toLowerCase() });
check("get_join_info returns groups + labels", info.groups.length === 4 && info.group_noun === "House" && info.groups_mode === "random");

// ---------- 2. Concurrent balance ----------
const B = await room(host, "GP test B");
await rpc(host, "save_groups", { p_room_id: B.id, p_groups: groupList(4) });
await rpc(host, "set_group_settings", { p_room_id: B.id, p_mode: "random" });
const results = await Promise.all(students.map((s, i) => join(s, B.code, i)));
const sB = await sizes(host, B.id);
check("concurrent joins balanced", results.every((r) => !r.error) && sB.unassigned === 0 && spread(sB.list) <= 1, sB.list.join("/"));

// ---------- 3. Choose mode ----------
// Hosts get 3 active rooms on the free plan, so host2 runs room C.
const C = await room(host2, "GP test C");
const groupsC = await rpc(host2, "save_groups", { p_room_id: C.id, p_groups: groupList(2) });
await rpc(host2, "set_group_settings", { p_room_id: C.id, p_mode: "choose" });
const { error: noGroup } = await join(students[0], C.code, 0);
check("choose: no group -> group_required", noGroup?.message === "group_required", noGroup?.message);
const { error: badGroup } = await join(students[0], C.code, 0, groupsA[0].id);
check("choose: other room's group -> invalid_group", badGroup?.message === "invalid_group", badGroup?.message);
const { data: chose, error: chooseErr } = await join(students[0], C.code, 0, groupsC[1].id);
check("choose: valid group joins", !chooseErr && chose?.group_id === groupsC[1].id, chooseErr?.message);
const { error: switchErr } = await students[0].rpc("choose_group", { p_group_id: groupsC[0].id });
check("choose_group only while unassigned", switchErr?.message === "group_choice_closed", switchErr?.message);
await rpc(host2, "move_participant", { p_participant_id: chose.id, p_group_id: null });
const picked = await rpc(students[0], "choose_group", { p_group_id: groupsC[0].id });
check("unassigned student can choose_group", picked.group_id === groupsC[0].id);
const { error: crossMove } = await host2.rpc("move_participant", { p_participant_id: chose.id, p_group_id: groupsA[0].id });
check("move to another room's group -> invalid_group", crossMove?.message === "invalid_group", crossMove?.message);

// ---------- 4. Enable random mid-session ----------
const D = await room(host, "GP test D");
for (let i = 0; i < STUDENTS; i++) await join(students[i], D.code, i);
let groupsD = await rpc(host, "save_groups", { p_room_id: D.id, p_groups: groupList(3) });
check("groups off: joiners stay unassigned", (await sizes(host, D.id)).unassigned === STUDENTS);
await rpc(host, "set_group_settings", { p_room_id: D.id, p_mode: "random" });
const sD = await sizes(host, D.id);
check("enabling random assigns everyone, balanced", sD.unassigned === 0 && sD.list.join("/") === "3/3/3", sD.list.join("/"));

// ---------- 5. Shuffle ----------
await rpc(host, "shuffle_groups", { p_room_id: D.id });
const sD2 = await sizes(host, D.id);
check("shuffle keeps everyone assigned, balanced", sD2.unassigned === 0 && spread(sD2.list) <= 1, sD2.list.join("/"));
const { error: studentShuffle } = await students[0].rpc("shuffle_groups", { p_room_id: D.id });
check("student can't shuffle", studentShuffle?.message === "not_host", studentShuffle?.message);

// ---------- 6. Delete a group in random mode ----------
groupsD = await rpc(host, "save_groups", {
  p_room_id: D.id,
  p_groups: groupsD.slice(0, 2).map((g) => ({ id: g.id, name: g.name, color: g.color })),
});
const sD3 = await sizes(host, D.id);
check("deleted group's members reassigned", sD3.unassigned === 0 && sD3.counts.size === 2 && spread(sD3.list) <= 1, sD3.list.join("/"));
const swapped = await rpc(host, "save_groups", {
  p_room_id: D.id,
  p_groups: [
    { id: groupsD[0].id, name: groupsD[1].name, color: "#000000" },
    { id: groupsD[1].id, name: groupsD[0].name, color: "#FFFFFF" },
  ],
});
check("save_groups can swap names", swapped[0].name === groupsD[1].name && swapped[0].id === groupsD[0].id);
const { error: dupErr } = await host.rpc("save_groups", {
  p_room_id: D.id,
  p_groups: [{ name: "Red", color: "#FF0000" }, { name: "red", color: "#FF0000" }],
});
check("duplicate names rejected", dupErr?.message === "duplicate_group_name", dupErr?.message);

// ---------- 7. Points snapshot ----------
const [gA, gB] = groupsD;
const { data: meD } = await host.from("participants").select("*").eq("room_id", D.id).eq("group_id", gA.id).limit(1).single();
const { error: offErr } = await host.rpc("award_points", { p_room_id: D.id, p_delta: 10, p_participant_id: meD.id });
check("award while points off -> points_disabled", offErr?.message === "points_disabled", offErr?.message);
const { error: presetErr } = await host.rpc("set_points_settings", { p_room_id: D.id, p_enabled: true, p_presets: [1, 0] });
check("zero preset rejected", presetErr?.message === "invalid_presets", presetErr?.message);
await rpc(host, "set_points_settings", { p_room_id: D.id, p_enabled: true, p_presets: [5, 10, 50] });
const { error: targetErr } = await host.rpc("award_points", { p_room_id: D.id, p_delta: 10, p_participant_id: meD.id, p_group_id: gA.id });
check("both targets -> invalid_target", targetErr?.message === "invalid_target", targetErr?.message);
const { error: deltaErr } = await host.rpc("award_points", { p_room_id: D.id, p_delta: 0, p_group_id: gA.id });
check("zero delta -> invalid_delta", deltaErr?.message === "invalid_delta", deltaErr?.message);
const { error: studentAward } = await students[0].rpc("award_points", { p_room_id: D.id, p_delta: 10, p_group_id: gA.id });
check("student can't award", studentAward?.message === "not_host", studentAward?.message);

const award = await rpc(host, "award_points", { p_room_id: D.id, p_delta: 10, p_participant_id: meD.id, p_round_id: D.current_round_id });
check("student award snapshots group", award.group_id === gA.id);
await rpc(host, "move_participant", { p_participant_id: meD.id, p_group_id: gB.id });
const total = (board, id) => board.groups.find((g) => g.id === id)?.total;
const me = (board, id) => board.individuals.find((p) => p.participant_id === id)?.total;
let board = await rpc(host, "get_scoreboard", { p_room_id: D.id });
check("after move: A keeps 10, B 0, student 10", total(board, gA.id) === 10 && total(board, gB.id) === 0 && me(board, meD.id) === 10,
  `A=${total(board, gA.id)} B=${total(board, gB.id)} me=${me(board, meD.id)}`);

// ---------- 8. Void / undo / reset ----------
await rpc(host, "award_points", { p_room_id: D.id, p_delta: -3, p_group_id: gB.id });
board = await rpc(host, "get_scoreboard", { p_room_id: D.id });
check("group deduction", total(board, gB.id) === -3);
const undone = await rpc(host, "undo_last_points", { p_room_id: D.id });
board = await rpc(host, "get_scoreboard", { p_room_id: D.id });
check("undo voids the latest", undone?.delta === -3 && total(board, gB.id) === 0);
await rpc(host, "void_point_event", { p_event_id: award.id });
board = await rpc(host, "get_scoreboard", { p_room_id: D.id });
check("void removes from student and group", me(board, meD.id) === 0 && total(board, gA.id) === 0);
await rpc(host, "award_points", { p_room_id: D.id, p_delta: 7, p_group_id: gA.id });
await rpc(host, "award_points", { p_room_id: D.id, p_delta: 7, p_participant_id: meD.id });
const voided = await rpc(host, "reset_points", { p_room_id: D.id });
board = await rpc(host, "get_scoreboard", { p_room_id: D.id });
check("reset voids all", voided === 2 && board.groups.every((g) => g.total === 0) && board.individuals.every((p) => p.total === 0), `voided=${voided}`);
const nothing = await rpc(host, "undo_last_points", { p_room_id: D.id });
check("undo with nothing left returns null", nothing === null, JSON.stringify(nothing));

// ---------- 10. RLS ----------
const { data: peekGroups } = await outsider.from("groups").select("*").eq("room_id", D.id);
const { data: peekPoints } = await outsider.from("point_events").select("*").eq("room_id", D.id);
check("outsider can't read groups or points", peekGroups?.length === 0 && peekPoints?.length === 0);
const { error: outsiderBoard } = await outsider.rpc("get_scoreboard", { p_room_id: D.id });
check("outsider can't read scoreboard", outsiderBoard?.message === "not_a_participant", outsiderBoard?.message);
// meD is in group B now, so the +4 snapshots to B. Pick someone in group A.
const studentIdx = students.findIndex((s) => s.uid === meD.user_id);
const { data: inA } = await host.from("participants").select("user_id").eq("room_id", D.id).eq("group_id", gA.id).limit(1).single();
const other = students.find((s) => s.uid === inA.user_id);
const plus4 = await rpc(host, "award_points", { p_room_id: D.id, p_delta: 4, p_participant_id: meD.id });
const theirBoard = await rpc(other, "get_scoreboard", { p_room_id: D.id });
check("student scoreboard: all groups, only own row", theirBoard.groups.length === 2 && theirBoard.individuals.length === 1 &&
  theirBoard.individuals[0].participant_id !== meD.id);
const { data: myBoard } = await students[studentIdx].rpc("get_scoreboard", { p_room_id: D.id });
check("student sees own total", myBoard?.individuals[0]?.total === 4);
// Groupmates do see events credited to their group (the display shows them anyway).
const { data: otherEvents } = await other.from("point_events").select("*").eq("id", plus4.id);
check("student can't read another group's student events", otherEvents?.length === 0, `saw ${otherEvents?.length}`);
const { error: insGroup } = await host.from("groups").insert({ room_id: D.id, name: "Hack", color: "#000000" });
const { error: insPoints } = await host.from("point_events").insert({ room_id: D.id, delta: 100, group_id: gA.id });
check("direct inserts blocked", !!insGroup && !!insPoints);

// ---------- Groups off hides, never deletes ----------
await rpc(host, "set_group_settings", { p_room_id: D.id, p_mode: "off" });
const sOff = await sizes(host, D.id);
check("turning groups off keeps assignments", sOff.unassigned === 0);
const offInfo = await rpc(outsider, "get_join_info", { p_code: D.code });
check("join info hides groups when off", offInfo.groups.length === 0 && offInfo.intro_media === null);

// ---------- 12–13. Media ----------
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
const uploaded = [];
async function upload(client, id = crypto.randomUUID()) {
  const path = `${client.uid}/${id}.png`;
  const { error } = await client.storage.from(BUCKET).upload(path, new Blob([PNG], { type: "image/png" }), {
    contentType: "image/png",
    upsert: false,
  });
  if (error) throw new Error(`upload: ${error.message}`);
  uploaded.push([client, path]);
  return { id, path };
}
const register = (client, { id, path }, bytes = PNG.length) =>
  client.rpc("register_media_asset", {
    p_asset_id: id, p_storage_path: path, p_kind: "image", p_mime_type: "image/png", p_bytes: bytes, p_label: "test",
  });

try {
  // A fresh room: starting later rooms ended A, and join info needs a live one.
  const M = await room(host, "GP test media");
  const groupsM = await rpc(host, "save_groups", { p_room_id: M.id, p_groups: groupList(2) });
  await rpc(host, "set_group_settings", { p_room_id: M.id, p_mode: "random" });
  const { error: foreignUpload } = await host.storage
    .from(BUCKET)
    .upload(`${host2.uid}/${crypto.randomUUID()}.png`, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" });
  check("upload into another host's folder blocked", !!foreignUpload, foreignUpload?.message);

  const f1 = await upload(host);
  const { error: badPath } = await register(host, { id: f1.id, path: `${host2.uid}/${f1.id}.png` });
  check("register path outside own folder -> error", badPath?.message === "invalid_media_path", badPath?.message);
  const ghostId = crypto.randomUUID();
  const { error: ghost } = await register(host, { id: ghostId, path: `${host.uid}/${ghostId}.png` });
  check("register missing object -> media_not_uploaded", ghost?.message === "media_not_uploaded", ghost?.message);
  const { error: wrongSize } = await register(host, f1, 999);
  check("register with wrong size -> invalid_media", wrongSize?.message === "invalid_media", wrongSize?.message);
  const { data: asset1, error: regErr } = await register(host, f1);
  check("register own upload", !regErr && asset1?.id === f1.id, regErr?.message);

  const f2 = await upload(host2);
  const { data: asset2 } = await register(host2, f2);
  const { error: foreignAttach } = await host.rpc("set_group_reveal_media", { p_group_id: groupsM[0].id, p_media_id: asset2.id });
  check("attach another host's asset -> invalid_media", foreignAttach?.message === "invalid_media", foreignAttach?.message);
  const { error: foreignSave } = await host.rpc("save_groups", {
    p_room_id: M.id,
    p_groups: groupsM.map((g, i) => ({ id: g.id, name: g.name, color: g.color, ...(i === 0 ? { reveal_media_id: asset2.id } : {}) })),
  });
  check("save_groups with another host's asset -> invalid_media", foreignSave?.message === "invalid_media", foreignSave?.message);

  await rpc(host, "set_group_reveal_media", { p_group_id: groupsM[0].id, p_media_id: asset1.id });
  await rpc(host, "set_room_intro_media", { p_room_id: M.id, p_media_id: asset1.id });
  const mediaInfo = await rpc(outsider, "get_join_info", { p_code: M.code });
  check("join info includes intro + group media",
    mediaInfo.intro_media?.path === f1.path && mediaInfo.groups.find((g) => g.id === groupsM[0].id)?.reveal_media?.kind === "image");

  // Library limit: fill to max_media_assets (20 by default), then one more.
  const { data: plan } = await host.from("plans").select("max_media_assets").eq("id", "free").single();
  for (let i = 1; i < plan.max_media_assets; i++) {
    const { error } = await register(host, await upload(host));
    if (error) throw new Error(`register #${i + 1}: ${error.message}`);
  }
  const { error: full } = await register(host, await upload(host));
  check(`registration #${plan.max_media_assets + 1} -> media_limit_reached`, full?.message === "media_limit_reached", full?.message);

  const deletedPath = await rpc(host, "delete_media_asset", { p_asset_id: asset1.id });
  const { data: gAfter } = await host.from("groups").select("reveal_media_id").eq("id", groupsM[0].id).single();
  const { data: rAfter } = await host.from("rooms").select("reveal_intro_media_id").eq("id", M.id).single();
  check("deleting an asset nulls its references", deletedPath === f1.path && gAfter.reveal_media_id === null && rAfter.reveal_intro_media_id === null);
  const { error: notMine } = await host.rpc("delete_media_asset", { p_asset_id: asset2.id });
  check("can't delete another host's asset", notMine?.message === "invalid_media", notMine?.message);
} finally {
  for (const client of [host, host2]) {
    const paths = uploaded.filter(([c]) => c === client).map(([, p]) => p);
    const { data: assets } = await client.from("media_assets").select("id");
    for (const a of assets ?? []) await client.rpc("delete_media_asset", { p_asset_id: a.id });
    if (paths.length) {
      const { error } = await client.storage.from(BUCKET).remove(paths);
      check("test files removed from storage", !error, error?.message);
    }
  }
}

// ---------- 9 & 14. Gating (needs the service role) ----------
if (!serviceKey) {
  console.log("SKIP  gating checks (set SUPABASE_SERVICE_ROLE_KEY to run them)");
} else {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const GATED = ["groups", "points", "custom_media"];
  const { data: saved, error: readErr } = await admin.from("plan_features").select("*").in("feature_key", GATED);
  if (readErr) throw readErr;
  try {
    await admin.from("plan_features").delete().in("feature_key", GATED);
    const G = await room(host2, "GP test gating");
    const blocked = async (fn, args, as = host) => (await as.rpc(fn, args)).error?.message === "feature_not_available";
    check("gated: save_groups", await blocked("save_groups", { p_room_id: G.id, p_groups: groupList(2) }, host2));
    check("gated: enabling groups", await blocked("set_group_settings", { p_room_id: A.id, p_mode: "choose" }));
    check("gated: enabling points", await blocked("set_points_settings", { p_room_id: G.id, p_enabled: true }, host2));
    check("gated: award_points", await blocked("award_points", { p_room_id: D.id, p_delta: 5, p_group_id: gA.id }));
    check("ungated: disabling groups + points", !(await host.rpc("set_group_settings", { p_room_id: A.id, p_mode: "off" })).error &&
      !(await host.rpc("set_points_settings", { p_room_id: D.id, p_enabled: false })).error);
    check("ungated: reading the scoreboard", !(await host.rpc("get_scoreboard", { p_room_id: D.id })).error);
    check("ungated: clearing media", !(await host.rpc("set_room_intro_media", { p_room_id: A.id, p_media_id: null })).error);
    const { error: upErr } = await host.storage.from(BUCKET)
      .upload(`${host.uid}/${crypto.randomUUID()}.png`, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" });
    check("gated: media upload policy", !!upErr, upErr?.message);
    const ent2 = await rpc(host2, "get_room_entitlements", { p_room_id: G.id });
    check("entitlements list nothing", ent2.features.length === 0, JSON.stringify(ent2.features));

    await admin.from("room_feature_grants").insert({ room_id: G.id, feature_key: "groups", source: "manual" });
    check("room grant re-enables for that room", !(await host2.rpc("save_groups", { p_room_id: G.id, p_groups: groupList(2) })).error);
    check("…and only that room", await blocked("save_groups", { p_room_id: A.id, p_groups: groupList(2) }));
  } finally {
    await admin.from("plan_features").upsert(saved);
    const { count } = await admin.from("plan_features").select("*", { count: "exact", head: true }).in("feature_key", GATED);
    check("plan_features restored", count === saved.length, `${count}/${saved.length}`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);

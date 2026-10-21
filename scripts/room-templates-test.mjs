// Checks for the room templates migration against a real Supabase project.
// Usage: node --env-file=.env.local scripts/room-templates-test.mjs
//
// Uses 3 anonymous sign-ins. Rooms expire after 24h; test templates and
// uploaded files are removed at the end.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BUCKET = "buzzer-bucket";

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

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
async function asset(client) {
  const id = crypto.randomUUID();
  const path = `${client.uid}/${id}.png`;
  const { error } = await client.storage.from(BUCKET).upload(path, new Blob([PNG], { type: "image/png" }), {
    contentType: "image/png",
    upsert: false,
  });
  if (error) throw new Error(`upload: ${error.message}`);
  return rpc(client, "register_media_asset", {
    p_asset_id: id, p_storage_path: path, p_kind: "image", p_mime_type: "image/png", p_bytes: PNG.length, p_label: "test",
  });
}

const configOf = async (client, templateId) =>
  (await client.from("room_templates").select("config").eq("id", templateId).single()).data.config;
const groupsOf = async (client, roomId) =>
  (await client.from("groups").select("*").eq("room_id", roomId).order("sort_order")).data;

const host = await user();
const host2 = await user();
const student = await user();

try {
  const intro = await asset(host);
  const clip = await asset(host);

  // ---------- 1. Set up a room and save it ----------
  const A = await rpc(host, "create_room", { p_title: "Templates test A" });
  await rpc(host, "save_groups", {
    p_room_id: A.id,
    p_groups: [
      { name: "Gryffindor", color: "#E53935", emoji: "🦁", reveal_media_id: clip.id },
      { name: "Hufflepuff", color: "#FDD835", emoji: null },
      { name: "Ravenclaw", color: "#1E88E5", emoji: "🦅" },
    ],
  });
  await rpc(host, "set_group_settings", { p_room_id: A.id, p_mode: "random", p_noun: "House", p_noun_plural: "Houses" });
  await rpc(host, "set_sorting_text", { p_room_id: A.id, p_text: "The hat is thinking…" });
  await rpc(host, "set_points_settings", { p_room_id: A.id, p_enabled: true, p_presets: [10, 50, -10] });
  await rpc(host, "set_room_intro_media", { p_room_id: A.id, p_media_id: intro.id });
  await rpc(host, "set_display_options", { p_room_id: A.id, p_scores: true, p_qr: true });

  const t = await rpc(host, "save_room_template", { p_room_id: A.id, p_name: "  Hogwarts  " });
  check("save trims the name", t.name === "Hogwarts", t.name);
  check("config has the title and 3 groups in order",
    t.config.title === "Templates test A" && t.config.groups.map((g) => g.name).join() === "Gryffindor,Hufflepuff,Ravenclaw");

  // ---------- 2. Create a room from it ----------
  const B = await rpc(host, "create_room", { p_title: "Templates test B", p_template_id: t.id });
  const gB = await groupsOf(host, B.id);
  check("new room keeps its own title", B.title === "Templates test B");
  check("groups copied with order, colours, emoji",
    gB.map((g) => `${g.name}:${g.color}:${g.emoji}`).join() === "Gryffindor:#E53935:🦁,Hufflepuff:#FDD835:null,Ravenclaw:#1E88E5:🦅",
    gB.map((g) => g.name).join());
  check("group reveal media copied", gB[0].reveal_media_id === clip.id && gB[1].reveal_media_id === null);
  check("group settings copied",
    B.groups_mode === "random" && B.group_noun === "House" && B.group_noun_plural === "Houses" && B.sorting_text === "The hat is thinking…");
  check("points copied", B.points_enabled === true && B.point_presets.join() === "10,50,-10", B.point_presets.join());
  check("intro media and display options copied",
    B.reveal_intro_media_id === intro.id && B.display_scores === true && B.display_qr === true);

  // ---------- 3. Saving under the same name replaces ----------
  await rpc(host, "set_points_settings", { p_room_id: A.id, p_enabled: false, p_presets: [1] });
  const t2 = await rpc(host, "save_room_template", { p_room_id: A.id, p_name: "Hogwarts" });
  const { count } = await host.from("room_templates").select("id", { count: "exact", head: true });
  check("same name overwrites, no duplicate", t2.id === t.id && count === 1 && t2.config.points_enabled === false, `count=${count}`);

  // ---------- 4. Deleted media is skipped ----------
  await rpc(host, "delete_media_asset", { p_asset_id: clip.id });
  const C = await rpc(host, "create_room", { p_title: "Templates test C", p_template_id: t.id });
  const gC = await groupsOf(host, C.id);
  check("deleted clip skipped, rest still applied",
    gC.length === 3 && gC.every((g) => g.reveal_media_id === null) && C.reveal_intro_media_id === intro.id);

  // ---------- 4b. Auto-save to the linked template ----------
  check("a room created from a template is linked to it", C.template_id === t.id);
  await rpc(host, "set_points_settings", { p_room_id: C.id, p_enabled: true, p_presets: [2, 4] });
  await rpc(host, "save_groups", {
    p_room_id: C.id,
    p_groups: [
      { name: "Gryffindor", color: "#E53935", emoji: "🦁" },
      { name: "Hufflepuff", color: "#FDD835" },
      { name: "Slytherin", color: "#43A047", emoji: "🐍" },
    ],
  });
  const auto = await configOf(host, t.id);
  check("points change auto-saves", auto.points_enabled === true && auto.point_presets.join() === "2,4", JSON.stringify(auto.point_presets));
  check("groups change auto-saves", auto.groups.map((g) => g.name).join() === "Gryffindor,Hufflepuff,Slytherin");
  const unlinked = await rpc(host, "unlink_room_template", { p_room_id: C.id });
  await rpc(host, "set_points_settings", { p_room_id: C.id, p_enabled: false, p_presets: [7] });
  const after = await configOf(host, t.id);
  check("after unlinking, changes don't reach the template",
    unlinked.template_id === null && after.point_presets.join() === "2,4");
  const { error: unlinkErr } = await host2.rpc("unlink_room_template", { p_room_id: A.id });
  check("can't unlink another host's room", unlinkErr?.message === "not_host", unlinkErr?.message);

  // ---------- 5. Apply to an existing room replaces groups ----------
  // (Free plan: 3 active rooms per host, so C is reused. It's unlinked now.)
  await rpc(host, "set_group_settings", { p_room_id: C.id, p_mode: "off" });
  await rpc(host, "save_groups", { p_room_id: C.id, p_groups: [{ name: "Red", color: "#E53935" }, { name: "Blue", color: "#1E88E5" }] });
  await rpc(host, "set_group_settings", { p_room_id: C.id, p_mode: "choose" });
  await rpc(student, "join_room", { p_code: C.code, p_display_name: "S1", p_group_id: (await groupsOf(host, C.id))[0].id });
  const C2 = await rpc(host, "apply_room_template", { p_room_id: C.id, p_template_id: t.id });
  const gC2 = await groupsOf(host, C.id);
  const { data: member } = await host.from("participants").select("group_id").eq("room_id", C.id).single();
  check("apply replaces groups and keeps the title",
    gC2.map((g) => g.name).join() === "Gryffindor,Hufflepuff,Slytherin" && C2.title === "Templates test C" && C2.groups_mode === "random");
  check("loading links the room", C2.template_id === t.id);
  check("loading doesn't change the template", (await configOf(host, t.id)).point_presets.join() === "2,4");
  check("existing student is reassigned in random mode", gC2.some((g) => g.id === member.group_id));

  // ---------- 6. A template with everything off ----------
  await rpc(host, "set_group_settings", { p_room_id: A.id, p_mode: "off" });
  await rpc(host, "set_room_intro_media", { p_room_id: A.id });
  await rpc(host, "set_display_options", { p_room_id: A.id, p_scores: false, p_qr: false });
  const plain = await rpc(host, "save_room_template", { p_room_id: A.id, p_name: "Plain" });
  const B2 = await rpc(host, "apply_room_template", { p_room_id: B.id, p_template_id: plain.id });
  check("plain template turns everything off",
    B2.groups_mode === "off" && B2.points_enabled === false && B2.reveal_intro_media_id === null && B2.display_qr === false);

  // ---------- 7. Other hosts and students ----------
  const { data: seen } = await host2.from("room_templates").select("id");
  check("other hosts can't read templates", seen.length === 0);
  const { error: useErr } = await host2.rpc("create_room", { p_template_id: t.id });
  check("other hosts can't use a template", useErr?.message === "template_not_found", useErr?.message);
  const { count: host2Rooms } = await host2.from("rooms").select("id", { count: "exact", head: true });
  check("failed template leaves no room behind", host2Rooms === 0, `rooms=${host2Rooms}`);
  const { error: saveErr } = await host2.rpc("save_room_template", { p_room_id: A.id, p_name: "Stolen" });
  check("can't save another host's room", saveErr?.message === "not_host", saveErr?.message);
  const { error: delErr } = await host2.rpc("delete_room_template", { p_template_id: t.id });
  check("can't delete another host's template", delErr?.message === "template_not_found", delErr?.message);
  const { error: blankErr } = await student.rpc("create_blank_room", { p_title: "x" });
  check("create_blank_room isn't callable", !!blankErr, blankErr?.message);

  // ---------- 8. Names ----------
  const { error: emptyErr } = await host.rpc("save_room_template", { p_room_id: A.id, p_name: "   " });
  check("blank name rejected", emptyErr?.message === "invalid_template_name", emptyErr?.message);
  const { error: dupErr } = await host.rpc("rename_room_template", { p_template_id: plain.id, p_name: "Hogwarts" });
  check("rename onto an existing name rejected", dupErr?.message === "duplicate_template_name", dupErr?.message);
  const renamed = await rpc(host, "rename_room_template", { p_template_id: plain.id, p_name: "Plain room" });
  check("rename works", renamed.name === "Plain room");
  await rpc(host, "delete_room_template", { p_template_id: plain.id });
  const { data: bAfter } = await host.from("rooms").select("template_id").eq("id", B.id).single();
  check("deleting a template unlinks its rooms", bAfter.template_id === null);
} finally {
  const { data: templates } = await host.from("room_templates").select("id");
  for (const tmpl of templates ?? []) await host.rpc("delete_room_template", { p_template_id: tmpl.id });
  const { data: assets } = await host.from("media_assets").select("id, storage_path");
  for (const a of assets ?? []) await host.rpc("delete_media_asset", { p_asset_id: a.id });
  const { data: files } = await host.storage.from(BUCKET).list(host.uid);
  if (files?.length) await host.storage.from(BUCKET).remove(files.map((f) => `${host.uid}/${f.name}`));
  const { count } = await host.from("room_templates").select("id", { count: "exact", head: true });
  check("test templates removed", count === 0);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);

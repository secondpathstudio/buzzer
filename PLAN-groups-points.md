# Feature Plan: Groups, Points & Reveal Media (v0.3)

Adds optional **groups** (teams, houses, tables), **points**, and **custom reveal media** (the host's own intro and per-group images or videos shown when a student is assigned) to the buzzer. All are **off by default**, tucked into a collapsed panel, and built behind a feature-gating layer. A hosted version could paywall them later, while self-hosters get everything.

> **For Claude Code — read first**
> 1. Read `PLAN.md` and the **existing code and migrations** before starting. The core app is already built and may differ slightly from `PLAN.md`. Adapt names and patterns to what actually exists.
> 2. Put all database changes in a **new migration** (`supabase migration new groups_points`). Never edit the original migration.
> 3. Build the gating *structure* only. **No billing, checkout, pricing page, or payment code.**
> 4. Follow the build order in section 12 and check off acceptance criteria as you go.

---

## 1. Goals and non-goals

**Goals**
- The host can turn on **Groups** with one of two modes:
  - **Random & even:** students are auto-assigned on join, balanced, with a short reveal animation.
  - **Students choose:** students pick a group on the join screen.
- The host can turn on **Points** to award or deduct points to individual students or whole groups, with group and individual scoreboards.
- The host can upload **custom reveal media**: one shared intro clip plus one clip per group, played on the student's phone during assignment (section 6).
- All features are **off and collapsed by default**. With both off, the app looks and behaves exactly as it does today.
- Every gated action is checked **in the database**, so a hosted version can paywall it later with a one-line data change. Self-hosted installs have everything enabled by default.

**Non-goals (this plan)**
- Payments, checkout, upgrade flows (only a placeholder prompt, hidden by default)
- Scores that persist across rooms (e.g. a semester-long cup)
- One-buzz-per-group rules, group size limits, students switching groups themselves
- CSV export
- Server-side video transcoding or editing (hosts upload ready-made files)

---

## 2. Design principles

1. **Off by default, collapsed by default.** All config lives in one collapsed **Room options** panel on the host page. When a feature is off, none of its UI appears anywhere: no chips, no point buttons, no scoreboard.
2. **Turning off hides; it never deletes.** Switching groups or points off keeps the data, so switching back on restores it.
3. **Server-enforced.** Clients still only read tables. Every write goes through a `SECURITY DEFINER` function, as in the core app.
4. **Gate on enable and use, never on read or disable.** Enabling a feature and awarding points require the entitlement. Turning a feature off and reading existing data never do.
5. **Groups and points never affect buzz fairness.** `buzz()` is unchanged.

---

## 3. Feature gating (entitlements)

### Model
- A `features` registry lists the gateable features (`groups`, `points`, `custom_media`).
- `plan_features` maps plans to features. **Self-hosted seed: every plan gets every feature.**
- `room_feature_grants` (created now, left empty) lets a future credit or event pass unlock a feature for a single room.
- A room has a feature if the **host's effective plan** includes it **or** the room has a grant.

**To paywall later (hosted only):**
```sql
delete from public.plan_features where plan_id = 'free'
  and feature_key in ('groups', 'points', 'custom_media');
```

### SQL helpers
| Function | Purpose |
|---|---|
| `effective_plan(p_host_id) → text` | Host's plan if active (`plan_expires_at` null or in the future), else `'free'`. Also returns `'free'` when no `hosts` row exists yet (e.g. a host uploading media before creating a room). Optionally refactor `create_room` to use it. |
| `room_has_feature(p_room_id, p_feature) → boolean` | Plan features ∪ room grants |
| `host_has_feature(p_host_id, p_feature) → boolean` | Plan features only. Used where no room is involved (media uploads). |
| `require_room_feature(p_room_id, p_feature)` | Raises `feature_not_available` (hint = feature key) if missing |
| `get_room_entitlements(p_room_id) → jsonb` | Host only. Returns `{ plan, features: [...], max_participants }` for the UI |

### Client structure
| File | Purpose |
|---|---|
| `src/lib/features.ts` | Registry mirroring the DB: `{ groups: { label, description }, points: {...} }` and a `FeatureKey` type |
| `src/hooks/useRoomEntitlements.ts` | Calls `get_room_entitlements`; exposes `has(feature)` |
| `src/components/FeatureGate.tsx` | `<FeatureGate feature="groups" fallback={<UpgradePrompt feature="groups" />}>…</FeatureGate>` |
| `src/components/UpgradePrompt.tsx` | Placeholder. Renders a small lock + "Available on paid plans" **only if** `NEXT_PUBLIC_BILLING_ENABLED === 'true'`; otherwise "Not enabled on this server". No links, no checkout. |

Add `NEXT_PUBLIC_BILLING_ENABLED=false` and `NEXT_PUBLIC_MEDIA_MAX_MB=8` to `.env.example`.

---

## 4. Groups

### Modes (`rooms.groups_mode`)
| Mode | Join behaviour |
|---|---|
| `off` (default) | No groups anywhere |
| `random` | On join, assigned to the group with the **fewest members** (ties broken randomly), then the reveal animation plays |
| `choose` | Join screen shows group buttons; a choice is required |

### Rules
- **Group count:** 2–12 per room. Names 1–30 characters, unique within the room. Each group has a hex colour and an optional emoji.
- **Labels:** the host can rename the concept with `group_noun` / `group_noun_plural` (defaults "Group" / "Groups"; e.g. "House" / "Houses", "Team" / "Teams", "Table" / "Tables"). All UI copy uses these.
- **Balanced assignment** happens inside `join_room` while it already holds the room row lock, so concurrent joins stay balanced (sizes differ by at most 1).
- **Enabling `random` with students already in the room** assigns every unassigned participant, balanced.
- **Enabling `choose` with students already in the room:** unassigned students see a group picker on their phone (`choose_group`).
- **Rejoining** (refresh) keeps the student's group.
- **Host controls:**
  - Move any student to another group, or to none.
  - **Shuffle:** reassign everyone randomly and evenly.
- **Deleting a group** unassigns its members; in `random` mode they're immediately reassigned. Warn the host if the group has points, because its group points are removed with it.

### Reveal (random mode)
After joining, the student sees a short suspense screen ("Assigning your {group_noun}…", about 2 seconds), then a full-screen reveal: the group name, emoji, and the screen tinted in the group colour. This should be skippable with a tap, and respect `prefers-reduced-motion`.

### Presets
- **Shipped in the repo (generic only):** "2 Teams" (Red, Blue), "4 Teams" (Red, Yellow, Blue, Green), "Custom".
- **"Save as my preset":** saves the current group list (names, colours, emoji, labels, and reveal media IDs from section 6) to the host's browser `localStorage`, so it can be reused in tomorrow's room. Nothing about it is stored server-side or in the repo.
- **IP note:** keep franchise-specific names, crests, and terms out of the repo and any hosted version. Hosts type them into their own room or save them as a local preset.

---

## 5. Points

### Model: a ledger, never counters
- Every award is a row in `point_events` with a `delta`, which can be negative (deductions are allowed).
- **Award to a student:** the row stores the `participant_id` **and a snapshot of their current `group_id`**. The points count toward both the student and the group. Moving the student later does **not** move past points.
- **Award to a group directly:** the row stores `group_id` only.
- **Totals:**
  - Group total = sum of non-voided deltas with that `group_id`
  - Student total = sum of non-voided deltas with that `participant_id`
- **Undo:** sets `voided_at` and never deletes. **Reset points** voids all events in the room.
- **Quick-award presets:** `rooms.point_presets`, default `{1, 5, 10}`, editable by the host (1–6 values, each non-zero, within ±1000).

### Visibility
- **Host:** full scoreboard
- **Display:** group scoreboard + top students
- **Students:** their own points and their group's total only

---

## 6. Reveal media (Step F)

Hosts can replace the built-in text reveal with their own images or videos: an optional **intro** clip per room, shared by every student, plus an optional **reveal clip per group**. Hosts make one ready-made clip per group (e.g. a character announcing the group name). Playing a shared intro first makes the assignment feel live, even though each group's clip is pre-rendered. Gated by `custom_media`.

### Reveal sequence (random mode)
1. **Join screen:** `get_join_info` returns the intro media. Preload **only the intro** while the student types their name.
2. **Tap Join:** the intro starts immediately (`muted`, `playsInline`, `autoPlay`, no controls). With no intro set, show the built-in suspense screen.
3. **`join_room` returns:** look up the assigned group's `reveal_media` from the join info and start loading **only that one file**.
4. **Cut** (short crossfade) to the group clip once both:
   - the intro has played for at least `MIN_INTRO_MS` = 2000, and
   - the group clip is ready (`canplaythrough`, or image `load`).
   If the intro ends first, loop it.
5. **Finish:** when the group clip ends (video) or after `IMAGE_REVEAL_MS` = 3000 (image), go to the buzzer screen with the group chip. A **Skip** tap works at any point.
6. **Fallbacks:**
   - No group clip set → built-in text reveal (after the intro, if any).
   - Group clip not ready within `MEDIA_TIMEOUT_MS` = 6000, or it errors → built-in text reveal.
   - `prefers-reduced-motion` or Save-Data (`navigator.connection?.saveData`) → skip media, use the text reveal.
   - **A join must never get stuck on media.**

### Other modes and cases
- **Choose mode:** no intro. Play the chosen group's clip as a confirmation, if one is set.
- **Groups off:** reveal media is unused and its UI is hidden.
- **Refresh after reveal:** don't replay. Store `revealSeen:{roomId}` in `sessionStorage`.

### Playback rules
- Full-screen fixed overlay with `object-fit: contain`.
  - Group clip: letterbox in the group colour.
  - Intro: letterbox in a neutral dark colour.
- **Silent by default** (phones only autoplay muted video). Show an optional 🔊 button that unmutes on tap and remember the choice for the session.
- Images and videos are both allowed for the intro and for group clips.

### Storage
Create the bucket in the migration:
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reveal-media', 'reveal-media', true,
        8 * 1024 * 1024,   -- MEDIA_MAX_BYTES; keep between 5 and 10 MB
        array['video/mp4','video/webm','image/png','image/jpeg','image/webp','image/gif']);
```
- **Public read:** files are served by public URL, so the CDN can cache them. Paths contain UUIDs, so they're unguessable. Build URLs with `supabase.storage.from('reveal-media').getPublicUrl(path)`.
- **Path convention:** `{host_id}/{asset_id}.{ext}`
- **Storage RLS on `storage.objects`:**
  - INSERT allowed when the caller is authenticated, `bucket_id = 'reveal-media'`, `(storage.foldername(name))[1] = auth.uid()::text`, and `public.host_has_feature(auth.uid(), 'custom_media')`.
  - DELETE allowed in the caller's own folder only.
  - No UPDATE: upload with `upsert: false`; to replace a file, upload a new one.
  - Grant `execute` on `host_has_feature` to `authenticated`, because the storage policy runs as the uploading user.
- **The bucket limit is authoritative.** The client also checks size and type before uploading, for a friendly error. Read the client limit from `NEXT_PUBLIC_MEDIA_MAX_MB` (default `8`; must match the bucket).
- **Deleting files:** use the Storage API (`storage.remove`). Never delete `storage.objects` rows with SQL.

### Data model (same migration)
```sql
insert into public.features values ('custom_media', 'Custom reveal media');
-- SELF-HOSTED DEFAULT: every plan gets it
insert into public.plan_features select id, 'custom_media' from public.plans;

alter table public.plans
  add column max_media_assets int not null default 20;   -- per-host library size; gateable later

create table public.media_assets (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null references public.hosts(id) on delete cascade,
  storage_path text not null unique,             -- '{host_id}/{id}.{ext}'
  kind         text not null check (kind in ('image', 'video')),
  mime_type    text not null,
  bytes        int  not null check (bytes > 0),
  label        text check (char_length(label) <= 60),   -- e.g. "Red reveal"
  duration_ms  int,                               -- measured client-side; informational
  created_at   timestamptz not null default now()
);   -- belongs to the host, NOT the room, so the library survives room expiry

alter table public.groups
  add column reveal_media_id uuid references public.media_assets(id) on delete set null;
alter table public.rooms
  add column reveal_intro_media_id uuid references public.media_assets(id) on delete set null;
```
- **RLS:** `media_assets` SELECT for the owning host only. Students get media paths through `get_join_info`, which is `SECURITY DEFINER`. No write policies.

### RPCs
| Function | Gate | Notes |
|---|---|---|
| `register_media_asset(p_asset_id, p_storage_path, p_kind, p_mime_type, p_bytes, p_label?, p_duration_ms?)` → `media_assets` row | `custom_media` (host) | Checks: path starts with `auth.uid()/`; the object exists in `storage.objects` for this bucket and owner; `bytes` matches the object's `metadata->>'size'`; library count < `max_media_assets` (`media_limit_reached`). Creates the `hosts` row if missing. |
| `delete_media_asset(p_asset_id)` → `storage_path` | none | Owner only. Deletes the row (references become null) and returns the path, which the client then removes with `storage.remove`. |
| `set_room_intro_media(p_room_id, p_media_id uuid null)` | `custom_media` unless clearing | Asset must belong to the room's host (`invalid_media`) |
| `set_group_reveal_media(p_group_id, p_media_id uuid null)` | `custom_media` unless clearing | Same ownership check |
| `save_groups` (extend) | — | Items may include an optional `reveal_media_id` (same ownership check), so applying a preset takes one call |
| `get_join_info` (extend) | — | Adds `intro_media: {path, kind} \| null` and `groups[].reveal_media: {path, kind} \| null` |

**Upload flow (client):**
1. Validate size and type.
2. Generate `asset_id`.
3. Upload to `{uid}/{asset_id}.{ext}` with `upsert: false`, showing progress.
4. Call `register_media_asset`.
5. If registration fails, remove the uploaded object.

### Host UI
- Inside the **Groups** settings, a collapsed sub-section **Custom reveal (optional)**, wrapped in `FeatureGate feature="custom_media"`. It only appears when groups are on.
  - **Intro:** a thumbnail with Choose… / Clear
  - **Each group row:** a small reveal thumbnail with Choose… / Clear
  - A **Preview reveal** button plays intro → a chosen group's clip in a phone-sized frame on the host screen.
- **Media picker** (modal):
  - The host's library as a grid. Thumbnails: the image itself, or the video's first frame via `<video preload="metadata">`.
  - **Upload** button using `accept` for the allowed types, with a progress bar and an editable label.
  - Delete with confirmation. If an asset is in use, warn: "Used by: Intro, Red".
  - Oversize error copy: "Max {N} MB. Try a 5-second, 720p MP4 (usually 1–2 MB)."

### Error codes → UI copy
| Error | Message |
|---|---|
| `media_limit_reached` | "Your media library is full ({N} files). Delete one to upload more." |
| `invalid_media` | "That file isn't in your library." |
| Storage `413` / payload too large | "File is larger than {N} MB." |
| Storage `415` / invalid MIME type | "Use MP4, WebM, PNG, JPG, WebP or GIF." |

### Known limitations (OK for now)
- The media library is tied to the host's browser session (anonymous). Clearing browser data loses access to the library until email linking exists.
- When the cleanup cron deletes old anonymous hosts, their `media_assets` rows go but their storage files remain. Orphan cleanup is listed in "Later".

### Host guide (put in README)
- Short **MP4 (H.264)**, about 5 seconds, 720p portrait (720×1280) or square (720×720), no audio needed: usually **1–2 MB**.
- Bake the background into the video. Transparent video isn't consistent across phone browsers.
- Convert GIFs to MP4, which is often 5–10× smaller:
  ```
  ffmpeg -i in.gif -movflags +faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" out.mp4
  ```
- Shrink any video:
  ```
  ffmpeg -i in.mov -vf "scale=720:-2" -c:v libx264 -crf 28 -preset slow -an -movflags +faststart out.mp4
  ```
  `+faststart` lets playback begin before the whole file downloads.
- **Bandwidth:** each student downloads at most two files (intro + their own group's clip). At about 2.5 MB per student, 150 students is about 375 MB per session. That fits comfortably within Supabase Free's 5 GB egress + 5 GB cached egress per month for a single instructor.
- Upload third-party or franchise media only to your own instance. **Never commit it to the repo.**

---

## 7. Schema changes (new migration)

```sql
-- ---------- Entitlements ----------
create table public.features (
  key   text primary key,
  label text not null
);
insert into public.features values ('groups', 'Groups'), ('points', 'Points');
-- ('custom_media', ...) and the media tables: see section 6

create table public.plan_features (
  plan_id     text references public.plans(id)    on delete cascade,
  feature_key text references public.features(key) on delete cascade,
  primary key (plan_id, feature_key)
);
-- SELF-HOSTED DEFAULT: every plan gets every feature
insert into public.plan_features
  select p.id, f.key from public.plans p cross join public.features f;

create table public.room_feature_grants (           -- empty until billing exists
  room_id     uuid references public.rooms(id) on delete cascade,
  feature_key text references public.features(key),
  source      text not null check (source in ('credit', 'event_pass', 'manual')),
  created_at  timestamptz not null default now(),
  primary key (room_id, feature_key)
);

-- ---------- Room settings ----------
alter table public.rooms
  add column groups_mode       text    not null default 'off'
             check (groups_mode in ('off', 'random', 'choose')),
  add column group_noun        text    not null default 'Group'
             check (char_length(group_noun) between 1 and 20),
  add column group_noun_plural text    not null default 'Groups'
             check (char_length(group_noun_plural) between 1 and 20),
  add column points_enabled    boolean not null default false,
  add column point_presets     int[]   not null default '{1,5,10}';

-- ---------- Groups ----------
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  color      text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  emoji      text check (char_length(emoji) <= 8),
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  constraint groups_room_name_key unique (room_id, name) deferrable initially deferred
);   -- deferrable so save_groups can swap or rename names in one transaction

alter table public.participants
  add column group_id uuid references public.groups(id) on delete set null;
create index on public.participants (group_id);
create index on public.groups (room_id);

-- ---------- Points ----------
create table public.point_events (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  group_id       uuid references public.groups(id)       on delete set null,
  round_id       uuid references public.rounds(id)       on delete set null,
  delta          int  not null check (delta <> 0 and delta between -1000 and 1000),
  reason         text check (char_length(reason) <= 80),
  created_at     timestamptz not null default now(),
  voided_at      timestamptz
);
create index on public.point_events (room_id) where voided_at is null;
```

**Implementation notes**
- **No CHECK for "participant or group required" on `point_events`.** `ON DELETE SET NULL` could null both columns and make the delete fail. Enforce it in `award_points` instead.
- **Cross-room safety:** every function must verify that any `group_id` or `participant_id` belongs to the same room.
- **RLS:** enable on all new tables.
  - `groups` and `point_events`: SELECT for room host or members (reuse `is_room_host` / `is_room_member`).
  - `features` and `plan_features`: SELECT for authenticated.
  - `room_feature_grants`: SELECT for room host.
  - **No write policies.**
- **Realtime:** add `groups` and `point_events` to the `supabase_realtime` publication. `rooms` is already published, so settings changes reach clients.
- **Permissions:** revoke execute from `public` and `anon` on every new function; grant only the client-facing ones to `authenticated`.

---

## 8. RPC contract

### Changed
| Function | Change |
|---|---|
| `join_room(p_code, p_display_name, p_group_id uuid default null)` | **Signature change:** `drop function public.join_room(text, text)` first, otherwise Postgres keeps both versions. Re-grant, regenerate types, update the client call. |

`join_room` behaviour by mode:
- **`off`:** `group_id` stays null.
- **`random`:** ignores `p_group_id` and picks the smallest group (ties random) while holding the room lock.
- **`choose`:** `p_group_id` is required (`group_required`) and must belong to the room (`invalid_group`).
- **Rejoin:** keeps the existing group. In `choose` mode, it sets the group only if the student is currently unassigned and `p_group_id` was given.

### New: join and student
| Function | Caller | Notes |
|---|---|---|
| `get_join_info(p_code)` → jsonb | Any signed-in user | `{ room_id, title, groups_mode, group_noun, group_noun_plural, groups: [{id, name, color, emoji, reveal_media}], intro_media, is_full }` for a non-expired room (media fields from section 6). Needed because RLS hides groups until the student has joined. |
| `choose_group(p_group_id)` | Student | `choose` mode only, and only while the student is unassigned |

### New: groups (host only)
| Function | Gate | Notes |
|---|---|---|
| `set_group_settings(p_room_id, p_mode, p_noun?, p_noun_plural?)` | `groups`, unless `p_mode = 'off'` | Non-off modes need ≥2 groups (`need_at_least_two_groups`). `random` assigns unassigned participants. |
| `save_groups(p_room_id, p_groups jsonb)` | `groups` | Array of `{ id?, name, color, emoji? }`; array order = `sort_order`. Upserts by id, deletes missing groups, enforces 2–12 (`invalid_group_count`). In `random` mode, reassigns orphans. Returns saved groups. |
| `move_participant(p_participant_id, p_group_id uuid null)` | `groups` | Same-room check |
| `shuffle_groups(p_room_id)` | `groups` | Participants in random order, dealt round-robin across groups in random order |

### New: points (host only)
| Function | Gate | Notes |
|---|---|---|
| `set_points_settings(p_room_id, p_enabled, p_presets int[]?)` | `points`, unless disabling | Validates presets |
| `award_points(p_room_id, p_delta, p_participant_id?, p_group_id?, p_round_id?, p_reason?)` → `point_events` row | `points` | Requires `points_enabled` (`points_disabled`). Exactly one of participant or group (`invalid_target`). Participant awards snapshot the participant's current `group_id`. |
| `undo_last_points(p_room_id)` → voided row or null | none | Voids the most recent non-voided event |
| `void_point_event(p_event_id)` | none | |
| `reset_points(p_room_id)` | none | Voids all; the UI asks for confirmation |

### New: read
| Function | Caller | Notes |
|---|---|---|
| `get_scoreboard(p_room_id)` → jsonb | Host or member | `{ groups: [{id, name, color, emoji, total, member_count}], individuals: [{participant_id, display_name, group_id, total}] }`. Members get only their own row in `individuals` plus all group totals. |
| `get_room_entitlements(p_room_id)` → jsonb | Host | See section 3 |

### New error codes → UI copy
| Error | Message |
|---|---|
| `feature_not_available` | With billing enabled: show `UpgradePrompt`. Otherwise: "This feature isn't enabled on this server." |
| `group_required` | "Pick a {group_noun} to join." |
| `invalid_group` | "That {group_noun} no longer exists. Pick another." Refresh the join info. |
| `need_at_least_two_groups` | "Add at least two {group_noun_plural} first." |
| `invalid_group_count` | "Use between 2 and 12 {group_noun_plural}." |
| `points_disabled` | "Turn on Points in Room options first." |
| `invalid_target` / `invalid_delta` | Developer error; log it and show a generic message |

---

## 9. Realtime

| Page | New subscriptions |
|---|---|
| Host, Display | `groups` (room_id = room); `point_events` (room_id = room) → refetch `get_scoreboard` (debounce ~200 ms) |
| Student | `groups` (room_id = room) only when groups are on; `point_events` (room_id = room) only when points are on |

- Room settings (`groups_mode`, `points_enabled`, labels) arrive through the existing `rooms` subscription.
- **Subscribe to these channels only when the feature is on.** With both features off, there are zero new subscriptions.
- Keep the existing rule: refetch full state on reconnect and on `visibilitychange`.
- Reveal media needs no realtime: students read it once, through `get_join_info`.

---

## 10. UI spec

### Host panel
- At the bottom, add a **collapsed** section titled **Room options** (`<details>` or an accordion; closed by default, open/closed state remembered in `localStorage`).
- Inside are two rows, each with a toggle (off by default) wrapped in `FeatureGate`:
  - **Groups:** turning on expands inline:
    - Mode: segmented control **Random & even** | **Students choose**
    - Labels: singular and plural inputs (placeholder "Group / Groups")
    - Group list editor: name, colour swatch, optional emoji, reorder, delete, "+ Add"; preset picker (shipped presets + saved local presets); **Save as my preset**
    - Hint: "Set up groups before showing the QR code."
  - **Points:** turning on expands inline:
    - Quick-award preset chips (editable)
    - **Reset points** (with confirmation)
- **When groups are on:**
  - The participant list is grouped under coloured headers with counts.
  - Each participant row has a "Move to…" menu.
  - A **Shuffle** button appears.
- **When points are on:**
  - Each row in the live buzz ranking gets quick buttons: `+p1 +p2 +p3` for the presets, a `−` toggle to flip them to deductions, and "…" for a custom amount and reason.
  - A compact scoreboard (group totals) sits above the buzz list.
  - An **Undo last** button appears.

### Student page
- **Join screen:**
  - In `choose` mode, show large coloured group buttons under the name field; joining requires a selection.
  - In `random` mode, after joining, show the reveal: custom media if set (section 6), otherwise the built-in reveal (section 4).
- **Buzzer screen:**
  - Groups on: a group chip at the top and a subtle background tint in the group colour.
  - Points on: a small footer, "You: 15 · {Group}: 120".
- If unassigned while the room is in `choose` mode, show the group picker before the buzzer.

### Display (`/display/[code]`)
- **Waiting:** when groups are on, show group roster counts as coloured pills under the QR code.
- **Result:**
  - The winner's name with a group chip in the group colour.
  - When points are awarded, show an animated "+10 → {Group}" toast.
- **Scoreboard view (points on):**
  - Toggle with `S`.
  - Big vertical bars per group in group colours, animated when totals change, with the top 5 students below.
  - If groups are off, show the top 10 students only.

**New display keys (only active when the feature is on)**
| Key | Action |
|---|---|
| `S` | Toggle scoreboard |
| `A` | Award the first preset to the current round's winner |
| `D` | Deduct the first preset from the current round's winner |
| `Z` | Undo last points |

`A` and `D` call `award_points` with the winner's `participant_id` and `p_round_id`. Make sure these keys don't conflict with existing shortcuts.

---

## 11. File map (suggested; follow existing conventions)

```
supabase/migrations/<timestamp>_groups_points.sql
src/lib/features.ts
src/lib/groupPresets.ts                 # shipped generic presets + localStorage helpers
src/hooks/useRoomEntitlements.ts
src/hooks/useGroups.ts
src/hooks/useScoreboard.ts
src/components/FeatureGate.tsx
src/components/UpgradePrompt.tsx
src/components/host/RoomOptions.tsx
src/components/host/GroupsSettings.tsx
src/components/host/PointsSettings.tsx
src/components/host/ParticipantGroups.tsx
src/components/student/GroupPicker.tsx
src/components/student/GroupReveal.tsx
src/components/display/Scoreboard.tsx
src/components/GroupChip.tsx
src/lib/media.ts                        # limits, MIME list, upload + register helpers, public URL builder
src/components/host/RevealMediaSettings.tsx
src/components/host/MediaPicker.tsx     # library grid + upload
src/components/host/RevealPreview.tsx
src/components/student/RevealPlayer.tsx # intro → group clip sequencing, fallbacks
```

---

## 12. Build order and acceptance criteria

### Step A: Migration + SQL tests
- [ ] New migration applies cleanly on top of the existing schema (`supabase db reset`)
- [ ] SQL tests pass (section 13)
- [ ] Types regenerated

### Step B: Gating plumbing
- [ ] `features.ts`, `useRoomEntitlements`, `FeatureGate`, `UpgradePrompt`, env var
- **Done when:** the app is visually and behaviourally unchanged, and running the paywall SQL from section 3 locally makes the toggles show "Not enabled on this server" and the RPCs reject. Restore the rows afterwards.

### Step C: Groups
- [ ] Room options panel (collapsed) with the Groups toggle and settings
- [ ] Join flow for both modes, `get_join_info`, `choose_group`
- [ ] Reveal animation (random mode)
- [ ] Host roster grouping, Move, Shuffle
- [ ] Display roster pills and winner group chip
- [ ] Shipped presets + local "Save as my preset"
- **Done when:** with 4 groups in random mode, 8 student browsers end up 2/2/2/2 and each sees a reveal. In choose mode, a student can't join without picking. Switching groups off hides all group UI, and switching back on restores the assignments.

### Step D: Points
- [ ] Points toggle and presets
- [ ] Quick-award on buzz rows, custom amount, deductions, Undo last, Reset
- [ ] Scoreboard on host, display (`S`), and student footer
- [ ] Display keys `A`, `D`, `Z`
- **Done when:** awarding +10 to a student updates their total *and* their group's total on all screens within about 1 second. Moving that student afterwards doesn't move the 10 points. Undo restores the previous totals.

### Step E: Polish
- [ ] All new error codes mapped to copy
- [ ] Reduced-motion support for the reveal and scoreboard animations
- [ ] README: a "Groups & Points" section, plus a note on how hosted deployments can gate features
- [ ] Playwright: 1 host + 8 students covering random groups, a buzz, and an award, verified on the display

### Step F: Reveal media (section 6)
- [ ] Bucket, storage policies, `media_assets`, column additions, RPCs (can ship in the same migration as Step A, or a follow-up migration if A has already been applied)
- [ ] Media picker with upload, library, delete, and labels
- [ ] Custom reveal sub-section (collapsed, inside Groups) with Intro + per-group pickers and Preview
- [ ] `RevealPlayer` with intro → group clip sequencing and all fallbacks
- [ ] Presets save and apply media IDs, skipping missing assets
- [ ] README host guide
- **Done when:**
  - In random mode with an intro + 4 group clips, 8 students each see the intro and then *their own* group's clip. The network panel shows each student downloaded only the intro and one group clip.
  - With throttling ("Slow 3G"), students fall back to the text reveal within about 6 seconds and still reach the buzzer.
  - A file over the size limit or of the wrong type is rejected, both in the UI and by the bucket if the UI is bypassed.
  - With no media set, the built-in reveal is unchanged.
  - Refreshing after the reveal doesn't replay it.
  - The whole sub-section is hidden when groups are off and collapsed by default.

---

## 13. SQL tests to write

1. **Even distribution:** 4 groups, 41 sequential joins → sizes 11/10/10/10.
2. **Concurrent balance:** parallel joins (separate connections) still differ by at most 1.
3. **Choose mode:** joining without a group → `group_required`; with another room's group → `invalid_group`.
4. **Enable random mid-session:** existing unassigned participants are all assigned, balanced.
5. **Shuffle:** all participants reassigned, sizes differ by at most 1.
6. **Delete group in random mode:** its members are reassigned to the remaining groups.
7. **Points snapshot:** award to a student in group A, move them to B → A keeps the points, B doesn't get them, the student's total is unchanged.
8. **Void/undo/reset** totals are correct; voided rows are excluded.
9. **Gating:**
   - With `plan_features` rows removed: enabling groups or points and `award_points` → `feature_not_available`.
   - Disabling and reading still work.
   - A `room_feature_grants` row re-enables the feature for that room only.
10. **RLS:**
    - A student can't read another room's groups or points.
    - Through `get_scoreboard`, a student sees only their own individual total.
    - Direct inserts into `groups` and `point_events` are blocked.
11. **Rejoin** keeps the group and doesn't consume a slot.
12. **Media ownership:**
    - Registering a path outside `auth.uid()/` → error.
    - Registering a path with no storage object → error.
    - Attaching another host's asset to a group or room → `invalid_media`.
13. **Media limits:** the 21st registration → `media_limit_reached`. Deleting an asset nulls `groups.reveal_media_id` and `rooms.reveal_intro_media_id`.
14. **Media gating:** with `custom_media` removed from `plan_features`, upload policy, registration and attaching are rejected. Clearing still works, and `get_join_info` still returns existing media.

---

## 14. Later (not in this plan)

- Billing: checkout, credits, semester pass → insert into `room_feature_grants` or upgrade the plan
- Persistent scoreboards across rooms (e.g. a semester-long cup). A natural paid feature that pairs with saved history.
- Buzz rules: one buzz per group, or lock out a group after a wrong answer
- Max group size in `choose` mode, and letting students switch groups themselves
- CSV export of the scoreboard
- Orphaned storage cleanup: a scheduled job that removes bucket files with no `media_assets` row, via the Storage API
- A join ticker on the display ("Ana → Red") during the waiting state
- Optional sound design, and per-group audio stings

---

## 15. Pre-presentation checklist (for the host)

1. Create the room **on the day**, since rooms expire after 24 hours.
2. Open **Room options** and turn **Groups** on:
   - Choose **Random & even**.
   - Set the labels to **House / Houses**.
   - Enter the four names, colours and emoji.
   - Tap **Save as my preset** so next time takes one tap.
3. Under **Groups → Custom reveal**, upload the intro clip and the four group clips (MP4, under the size limit), assign each one, and tap **Preview reveal**. Save the preset again so the clips are included.
4. Turn **Points** on and set presets (e.g. 5 / 10 / 50).
5. Open display mode on the projector and test with two phones: join, watch the reveal, buzz, `A` to award, `S` for the scoreboard, `Z` to undo.
6. Show the QR code.

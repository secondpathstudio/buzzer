-- =====================================================================
-- Groups, points & reveal media (PLAN-groups-points.md, v0.3)
--
-- Everything here is OFF by default: rooms start with groups_mode = 'off'
-- and points_enabled = false, so the app behaves exactly as before.
--
-- Feature gating: a room has a feature if the host's effective plan has
-- it (plan_features) or the room has a grant (room_feature_grants).
-- SELF-HOSTED DEFAULT: every plan gets every feature.
-- To paywall later (hosted only):
--   delete from public.plan_features where plan_id = 'free'
--     and feature_key in ('groups', 'points', 'custom_media');
--
-- Gate on enable and use, never on read or disable.
-- buzz() is unchanged: groups and points never affect buzz fairness.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Entitlements
-- ---------------------------------------------------------------------
create table public.features (
  key   text primary key,
  label text not null
);
insert into public.features values
  ('groups', 'Groups'),
  ('points', 'Points'),
  ('custom_media', 'Custom reveal media');

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

alter table public.plans
  add column max_media_assets int not null default 20;   -- per-host library size


-- ---------------------------------------------------------------------
-- Room settings
-- ---------------------------------------------------------------------
alter table public.rooms
  add column groups_mode       text    not null default 'off'
             check (groups_mode in ('off', 'random', 'choose')),
  add column group_noun        text    not null default 'Group'
             check (char_length(group_noun) between 1 and 20),
  add column group_noun_plural text    not null default 'Groups'
             check (char_length(group_noun_plural) between 1 and 20),
  add column points_enabled    boolean not null default false,
  add column point_presets     int[]   not null default '{1,5,10}';


-- ---------------------------------------------------------------------
-- Reveal media library. Belongs to the host, not the room, so it
-- survives room expiry. Files live in the 'buzzer-bucket' storage bucket
-- at '{host_id}/{asset_id}.{ext}'.
-- ---------------------------------------------------------------------
create table public.media_assets (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null references public.hosts(id) on delete cascade,
  storage_path text not null unique,
  kind         text not null check (kind in ('image', 'video')),
  mime_type    text not null,
  bytes        int  not null check (bytes > 0),
  label        text check (char_length(label) <= 60),
  duration_ms  int,                                  -- measured client-side; informational
  created_at   timestamptz not null default now()
);
create index on public.media_assets (host_id);

alter table public.rooms
  add column reveal_intro_media_id uuid references public.media_assets(id) on delete set null;


-- ---------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------
create table public.groups (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 30),
  color           text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  emoji           text check (char_length(emoji) <= 8),
  sort_order      int  not null default 0,
  reveal_media_id uuid references public.media_assets(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint groups_room_name_key unique (room_id, name) deferrable initially deferred
);   -- deferrable so save_groups can swap or rename names in one transaction
create index on public.groups (room_id);

alter table public.participants
  add column group_id uuid references public.groups(id) on delete set null;
create index on public.participants (group_id);


-- ---------------------------------------------------------------------
-- Points: a ledger, never counters. Undo/reset set voided_at.
-- No "participant or group required" CHECK: ON DELETE SET NULL could null
-- both and make the delete fail. award_points() enforces it instead.
-- ---------------------------------------------------------------------
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
create index on public.point_events (participant_id);
create index on public.point_events (group_id);


-- =====================================================================
-- Entitlement helpers
-- =====================================================================

-- Host's plan if active, else 'free'. Also 'free' when no hosts row exists.
create or replace function public.effective_plan(p_host_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case
       when h.plan <> 'free' and (h.plan_expires_at is null or h.plan_expires_at > now())
       then h.plan else 'free' end
     from public.hosts h where h.id = p_host_id),
    'free');
$$;

-- Plan features only (no room involved, e.g. media uploads)
create or replace function public.host_has_feature(p_host_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plan_features
    where plan_id = public.effective_plan(p_host_id) and feature_key = p_feature
  );
$$;

-- Plan features ∪ room grants
create or replace function public.room_has_feature(p_room_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.rooms r
      where r.id = p_room_id and public.host_has_feature(r.host_id, p_feature))
    or exists (
      select 1 from public.room_feature_grants
      where room_id = p_room_id and feature_key = p_feature);
$$;

create or replace function public.require_room_feature(p_room_id uuid, p_feature text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.room_has_feature(p_room_id, p_feature) then
    raise exception 'feature_not_available' using hint = p_feature;
  end if;
end $$;

-- Host only. What the UI needs to decide which options to offer.
create or replace function public.get_room_entitlements(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found or v_room.host_id <> auth.uid() then raise exception 'not_host'; end if;

  return jsonb_build_object(
    'plan', public.effective_plan(v_room.host_id),
    'features', coalesce((
      select jsonb_agg(f.key order by f.key) from public.features f
      where public.room_has_feature(p_room_id, f.key)), '[]'::jsonb),
    'max_participants', v_room.max_participants
  );
end $$;


-- =====================================================================
-- Group assignment helpers (internal). Callers must hold the room row
-- lock, so concurrent joins/moves stay balanced.
-- =====================================================================

-- The group with the fewest members (ties broken randomly), or null.
create or replace function public.smallest_group(p_room_id uuid)
returns uuid language sql volatile security definer set search_path = '' as $$
  select g.id
  from public.groups g
  left join public.participants p on p.group_id = g.id
  where g.room_id = p_room_id
  group by g.id
  order by count(p.id), random()
  limit 1;
$$;

-- Assign every unassigned participant, keeping sizes balanced.
create or replace function public.assign_unassigned(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pid uuid;
begin
  for v_pid in
    select id from public.participants
    where room_id = p_room_id and group_id is null
    order by random()
  loop
    update public.participants set group_id = public.smallest_group(p_room_id)
    where id = v_pid;
  end loop;
end $$;

-- Locks and returns the room, raising not_host unless the caller hosts it.
create or replace function public.lock_hosted_room(p_room_id uuid)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or v_room.host_id <> auth.uid() then raise exception 'not_host'; end if;
  return v_room;
end $$;

-- Raises invalid_media unless the asset belongs to p_host_id.
create or replace function public.check_media_owner(p_media_id uuid, p_host_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_media_id is not null and not exists (
    select 1 from public.media_assets where id = p_media_id and host_id = p_host_id
  ) then
    raise exception 'invalid_media';
  end if;
end $$;


-- =====================================================================
-- Join
-- =====================================================================

-- Everything the join screen needs before the student is a member
-- (RLS hides groups until then).
create or replace function public.get_join_info(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_room   public.rooms;
  v_on     boolean;
  v_bucket constant text := 'buzzer-bucket';
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_room from public.rooms
  where code = upper(trim(p_code)) and expires_at > now();
  if not found then raise exception 'room_not_found'; end if;

  v_on := v_room.groups_mode <> 'off';

  return jsonb_build_object(
    'room_id', v_room.id,
    'title', v_room.title,
    'groups_mode', v_room.groups_mode,
    'group_noun', v_room.group_noun,
    'group_noun_plural', v_room.group_noun_plural,
    'groups', case when v_on then coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', g.id, 'name', g.name, 'color', g.color, 'emoji', g.emoji,
          'reveal_media', case when m.id is not null
            then jsonb_build_object('path', m.storage_path, 'kind', m.kind) end)
        order by g.sort_order, g.created_at)
      from public.groups g
      left join public.media_assets m on m.id = g.reveal_media_id
      where g.room_id = v_room.id), '[]'::jsonb)
      else '[]'::jsonb end,
    'intro_media', case when v_on then (
      select jsonb_build_object('path', m.storage_path, 'kind', m.kind)
      from public.media_assets m where m.id = v_room.reveal_intro_media_id) end,
    'media_bucket', v_bucket,
    'is_full', (select count(*) from public.participants where room_id = v_room.id)
               >= v_room.max_participants
  );
end $$;


-- Student: join by code. Enforces the participant cap atomically and, in
-- random mode, assigns the smallest group while holding the room lock.
drop function public.join_room(text, text);

create or replace function public.join_room(
  p_code text, p_display_name text, p_group_id uuid default null)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare
  v_uid         uuid := auth.uid();
  v_name        text := trim(p_display_name);
  v_room        public.rooms;
  v_count       int;
  v_group_id    uuid;
  v_participant public.participants;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'invalid_name';
  end if;

  -- Row lock: two students can't both grab the last slot, and group
  -- assignment sees every earlier join.
  select * into v_room from public.rooms
  where code = upper(trim(p_code)) and expires_at > now()
  for update;
  if not found then raise exception 'room_not_found'; end if;

  if p_group_id is not null and v_room.groups_mode = 'choose' and not exists (
    select 1 from public.groups where id = p_group_id and room_id = v_room.id
  ) then
    raise exception 'invalid_group';
  end if;

  -- Already in the room (refresh / reopened tab): update the name and keep
  -- the group. In choose mode, an unassigned student may pick one now.
  update public.participants set
    display_name = v_name,
    group_id = case
      when group_id is null and v_room.groups_mode = 'choose' then p_group_id
      else group_id end
  where room_id = v_room.id and user_id = v_uid
  returning * into v_participant;
  if found then return v_participant; end if;

  select count(*) into v_count from public.participants where room_id = v_room.id;
  if v_count >= v_room.max_participants then
    raise exception 'room_full'
      using hint = format('This room is limited to %s participants', v_room.max_participants);
  end if;

  if v_room.groups_mode = 'random' then
    v_group_id := public.smallest_group(v_room.id);
  elsif v_room.groups_mode = 'choose' then
    if p_group_id is null then raise exception 'group_required'; end if;
    v_group_id := p_group_id;
  end if;

  insert into public.participants (room_id, user_id, display_name, group_id)
  values (v_room.id, v_uid, v_name, v_group_id)
  returning * into v_participant;

  return v_participant;
end $$;


-- Student: pick a group in choose mode, only while unassigned.
-- Picking the group you're already in is a no-op.
create or replace function public.choose_group(p_group_id uuid)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare
  v_room        public.rooms;
  v_participant public.participants;
begin
  select r.* into v_room from public.rooms r
  join public.groups g on g.room_id = r.id
  where g.id = p_group_id
  for update of r;
  if not found then raise exception 'invalid_group'; end if;

  select * into v_participant from public.participants
  where room_id = v_room.id and user_id = auth.uid();
  if not found then raise exception 'not_a_participant'; end if;

  if v_participant.group_id = p_group_id then return v_participant; end if;
  if v_room.groups_mode <> 'choose' or v_participant.group_id is not null then
    raise exception 'group_choice_closed';
  end if;

  update public.participants set group_id = p_group_id
  where id = v_participant.id returning * into v_participant;
  return v_participant;
end $$;


-- =====================================================================
-- Groups (host only)
-- =====================================================================

-- Mode and labels. Turning off needs no entitlement and keeps all data.
create or replace function public.set_group_settings(
  p_room_id uuid, p_mode text, p_noun text default null, p_noun_plural text default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  v_room   public.rooms;
  v_noun   text := nullif(trim(p_noun), '');
  v_plural text := nullif(trim(p_noun_plural), '');
begin
  v_room := public.lock_hosted_room(p_room_id);
  if p_mode is null or p_mode not in ('off', 'random', 'choose') then
    raise exception 'invalid_mode';
  end if;
  if p_mode <> 'off' then
    perform public.require_room_feature(p_room_id, 'groups');
    if (select count(*) from public.groups where room_id = p_room_id) < 2 then
      raise exception 'need_at_least_two_groups';
    end if;
  end if;
  if char_length(v_noun) > 20 or char_length(v_plural) > 20 then
    raise exception 'invalid_group_noun';
  end if;

  update public.rooms set
    groups_mode = p_mode,
    group_noun = coalesce(v_noun, group_noun),
    group_noun_plural = coalesce(v_plural, group_noun_plural)
  where id = p_room_id
  returning * into v_room;

  if p_mode = 'random' then perform public.assign_unassigned(p_room_id); end if;
  return v_room;
end $$;


-- Replace the room's group list. p_groups is an array of
-- { id?, name, color, emoji?, reveal_media_id? }; array order = sort_order.
-- Upserts by id and deletes groups missing from the list (their members
-- become unassigned, or are reassigned in random mode). Omitting
-- reveal_media_id keeps the current value; null clears it.
create or replace function public.save_groups(p_room_id uuid, p_groups jsonb)
returns setof public.groups language plpgsql security definer set search_path = '' as $$
declare
  v_room    public.rooms;
  v_item    jsonb;
  v_index   int := 0;
  v_id      uuid;
  v_name    text;
  v_color   text;
  v_emoji   text;
  v_media   uuid;
  v_current public.groups;
  v_keep    uuid[] := '{}';
begin
  v_room := public.lock_hosted_room(p_room_id);
  perform public.require_room_feature(p_room_id, 'groups');

  if jsonb_typeof(p_groups) is distinct from 'array'
     or jsonb_array_length(p_groups) not between 2 and 12 then
    raise exception 'invalid_group_count';
  end if;

  if (select count(distinct lower(trim(e->>'name'))) from jsonb_array_elements(p_groups) e)
     < jsonb_array_length(p_groups) then
    raise exception 'duplicate_group_name';
  end if;

  for v_item in select * from jsonb_array_elements(p_groups) loop
    v_name  := trim(v_item->>'name');
    v_color := v_item->>'color';
    v_emoji := nullif(trim(v_item->>'emoji'), '');
    v_id    := nullif(v_item->>'id', '')::uuid;

    if v_name is null or char_length(v_name) not between 1 and 30 then
      raise exception 'invalid_group_name';
    end if;
    if v_color is null or v_color !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'invalid_group_color';
    end if;
    if char_length(v_emoji) > 8 then raise exception 'invalid_group_emoji'; end if;

    v_current := null;
    if v_id is not null then
      select * into v_current from public.groups where id = v_id and room_id = p_room_id;
      if not found then raise exception 'invalid_group'; end if;
    end if;

    if v_item ? 'reveal_media_id' then
      v_media := nullif(v_item->>'reveal_media_id', '')::uuid;
      -- Only a new attachment needs the entitlement; keeping or clearing doesn't.
      if v_media is not null and v_media is distinct from v_current.reveal_media_id then
        perform public.require_room_feature(p_room_id, 'custom_media');
        perform public.check_media_owner(v_media, v_room.host_id);
      end if;
    else
      v_media := v_current.reveal_media_id;
    end if;

    if v_id is null then
      insert into public.groups (room_id, name, color, emoji, sort_order, reveal_media_id)
      values (p_room_id, v_name, v_color, v_emoji, v_index, v_media)
      returning id into v_id;
    else
      update public.groups set
        name = v_name, color = v_color, emoji = v_emoji,
        sort_order = v_index, reveal_media_id = v_media
      where id = v_id;
    end if;

    v_keep := v_keep || v_id;
    v_index := v_index + 1;
  end loop;

  delete from public.groups where room_id = p_room_id and id <> all (v_keep);

  if v_room.groups_mode = 'random' then perform public.assign_unassigned(p_room_id); end if;

  return query select * from public.groups where room_id = p_room_id order by sort_order;
end $$;


-- Move a participant to another group in the same room, or to none.
create or replace function public.move_participant(p_participant_id uuid, p_group_id uuid default null)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare
  v_room_id     uuid;
  v_participant public.participants;
begin
  select room_id into v_room_id from public.participants where id = p_participant_id;
  if v_room_id is null then raise exception 'not_host'; end if;
  perform public.lock_hosted_room(v_room_id);
  perform public.require_room_feature(v_room_id, 'groups');

  if p_group_id is not null and not exists (
    select 1 from public.groups where id = p_group_id and room_id = v_room_id
  ) then
    raise exception 'invalid_group';
  end if;

  update public.participants set group_id = p_group_id
  where id = p_participant_id returning * into v_participant;
  return v_participant;
end $$;


-- Reassign everyone: participants in random order, dealt round-robin
-- across groups in random order, so sizes differ by at most 1.
create or replace function public.shuffle_groups(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.lock_hosted_room(p_room_id);
  perform public.require_room_feature(p_room_id, 'groups');
  if (select count(*) from public.groups where room_id = p_room_id) < 2 then
    raise exception 'need_at_least_two_groups';
  end if;

  with g as (
    select id, row_number() over (order by random()) - 1 as i, count(*) over () as n
    from public.groups where room_id = p_room_id
  ), p as (
    select id, row_number() over (order by random()) - 1 as i
    from public.participants where room_id = p_room_id
  )
  update public.participants pt set group_id = g.id
  from p join g on g.i = p.i % g.n
  where pt.id = p.id;
end $$;


-- =====================================================================
-- Points (host only)
-- =====================================================================

create or replace function public.set_points_settings(
  p_room_id uuid, p_enabled boolean, p_presets int[] default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  v_room := public.lock_hosted_room(p_room_id);
  if p_enabled then perform public.require_room_feature(p_room_id, 'points'); end if;

  if p_presets is not null and (
    coalesce(cardinality(p_presets), 0) not between 1 and 6
    or array_ndims(p_presets) <> 1
    or exists (select 1 from unnest(p_presets) v
               where v is null or v = 0 or v not between -1000 and 1000)
  ) then
    raise exception 'invalid_presets';
  end if;

  update public.rooms set
    points_enabled = coalesce(p_enabled, points_enabled),
    point_presets = coalesce(p_presets, point_presets)
  where id = p_room_id
  returning * into v_room;
  return v_room;
end $$;


-- Award (or deduct) points to exactly one student or one group. Student
-- awards also count toward the group they're in right now (snapshot), so
-- moving them later doesn't move past points.
create or replace function public.award_points(
  p_room_id        uuid,
  p_delta          int,
  p_participant_id uuid default null,
  p_group_id       uuid default null,
  p_round_id       uuid default null,
  p_reason         text default null)
returns public.point_events language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms;
  v_group uuid := p_group_id;
  v_event public.point_events;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found or v_room.host_id <> auth.uid() then raise exception 'not_host'; end if;
  perform public.require_room_feature(p_room_id, 'points');
  if not v_room.points_enabled then raise exception 'points_disabled'; end if;

  if p_delta is null or p_delta = 0 or p_delta not between -1000 and 1000 then
    raise exception 'invalid_delta';
  end if;
  if (p_participant_id is null) = (p_group_id is null) then
    raise exception 'invalid_target';
  end if;

  if p_participant_id is not null then
    select group_id into v_group from public.participants
    where id = p_participant_id and room_id = p_room_id;
    if not found then raise exception 'invalid_target'; end if;
    -- Hidden groups (mode off) don't collect points.
    if v_room.groups_mode = 'off' then v_group := null; end if;
  elsif not exists (select 1 from public.groups where id = p_group_id and room_id = p_room_id) then
    raise exception 'invalid_target';
  end if;

  if p_round_id is not null and not exists (
    select 1 from public.rounds where id = p_round_id and room_id = p_room_id
  ) then
    raise exception 'invalid_target';
  end if;

  insert into public.point_events (room_id, participant_id, group_id, round_id, delta, reason)
  values (p_room_id, p_participant_id, v_group, p_round_id, p_delta,
          left(nullif(trim(p_reason), ''), 80))
  returning * into v_event;
  return v_event;
end $$;


-- Void the most recent non-voided event. Returns it, or null if none.
create or replace function public.undo_last_points(p_room_id uuid)
returns public.point_events language plpgsql security definer set search_path = '' as $$
declare v_event public.point_events;
begin
  if not public.is_room_host(p_room_id) then raise exception 'not_host'; end if;

  update public.point_events set voided_at = now()
  where id = (
    select id from public.point_events
    where room_id = p_room_id and voided_at is null
    order by created_at desc, id desc
    limit 1
    for update)
  returning * into v_event;

  if not found then return null; end if;
  return v_event;
end $$;


create or replace function public.void_point_event(p_event_id uuid)
returns public.point_events language plpgsql security definer set search_path = '' as $$
declare v_event public.point_events;
begin
  select * into v_event from public.point_events where id = p_event_id;
  if not found or not public.is_room_host(v_event.room_id) then raise exception 'not_host'; end if;

  update public.point_events set voided_at = coalesce(voided_at, now())
  where id = p_event_id returning * into v_event;
  return v_event;
end $$;


-- Void every event in the room. Returns how many were voided.
create or replace function public.reset_points(p_room_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if not public.is_room_host(p_room_id) then raise exception 'not_host'; end if;
  update public.point_events set voided_at = now()
  where room_id = p_room_id and voided_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;


-- Host: every group and every student. Member: every group, and only
-- their own row in individuals.
create or replace function public.get_scoreboard(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_is_host boolean := public.is_room_host(p_room_id);
  v_me      uuid;
begin
  if not v_is_host then
    select id into v_me from public.participants
    where room_id = p_room_id and user_id = auth.uid();
    if v_me is null then raise exception 'not_a_participant'; end if;
  end if;

  return jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', g.id, 'name', g.name, 'color', g.color, 'emoji', g.emoji,
          'total', coalesce((select sum(e.delta) from public.point_events e
                             where e.group_id = g.id and e.voided_at is null), 0),
          'member_count', (select count(*) from public.participants p where p.group_id = g.id))
        order by g.sort_order, g.created_at)
      from public.groups g where g.room_id = p_room_id), '[]'::jsonb),
    'individuals', coalesce((
      select jsonb_agg(jsonb_build_object(
          'participant_id', s.id, 'display_name', s.display_name,
          'group_id', s.group_id, 'total', s.total)
        order by s.total desc, s.display_name)
      from (
        select p.id, p.display_name, p.group_id,
               coalesce((select sum(e.delta) from public.point_events e
                         where e.participant_id = p.id and e.voided_at is null), 0) as total
        from public.participants p
        where p.room_id = p_room_id and (v_is_host or p.id = v_me)
      ) s), '[]'::jsonb)
  );
end $$;


-- =====================================================================
-- Reveal media (gated by custom_media)
-- =====================================================================

-- Storage bucket. Upsert, so a bucket created in the dashboard gets the
-- right settings too. Keep the size limit in sync with
-- NEXT_PUBLIC_MEDIA_MAX_MB (5–10 MB is sensible).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('buzzer-bucket', 'buzzer-bucket', true,
        8 * 1024 * 1024,
        array['video/mp4','video/webm','image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket: files are read by public URL (CDN-cacheable; paths
-- contain UUIDs). Hosts may upload into and delete from their own folder
-- only. No UPDATE: upload with upsert: false.
create policy "hosts upload reveal media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'buzzer-bucket'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and public.host_has_feature((select auth.uid()), 'custom_media')
  );

-- storage.remove() needs SELECT as well as DELETE.
create policy "hosts read own reveal media"
  on storage.objects for select to authenticated
  using (bucket_id = 'buzzer-bucket' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "hosts delete own reveal media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'buzzer-bucket' and (storage.foldername(name))[1] = (select auth.uid()::text));


-- Record an uploaded file in the host's library. The object must already
-- exist at '{uid}/{asset_id}.{ext}', owned by the caller, with matching
-- size and type.
create or replace function public.register_media_asset(
  p_asset_id     uuid,
  p_storage_path text,
  p_kind         text,
  p_mime_type    text,
  p_bytes        int,
  p_label        text default null,
  p_duration_ms  int  default null)
returns public.media_assets language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_object storage.objects;
  v_limit  int;
  v_asset  public.media_assets;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.host_has_feature(v_uid, 'custom_media') then
    raise exception 'feature_not_available' using hint = 'custom_media';
  end if;

  if p_asset_id is null
     or p_storage_path !~ ('^' || v_uid::text || '/' || p_asset_id::text || '\.[a-z0-9]{2,5}$') then
    raise exception 'invalid_media_path';
  end if;

  select * into v_object from storage.objects
  where bucket_id = 'buzzer-bucket' and name = p_storage_path and owner_id = v_uid::text;
  if not found then raise exception 'media_not_uploaded'; end if;

  if p_bytes is distinct from (v_object.metadata->>'size')::int
     or p_mime_type is distinct from v_object.metadata->>'mimetype'
     or p_kind is distinct from split_part(p_mime_type, '/', 1) then
    raise exception 'invalid_media';
  end if;

  insert into public.hosts (id) values (v_uid) on conflict (id) do nothing;
  -- Serialise registrations per host so the library limit holds.
  perform 1 from public.hosts where id = v_uid for update;

  select p.max_media_assets into v_limit from public.plans p
  where p.id = public.effective_plan(v_uid);
  if (select count(*) from public.media_assets where host_id = v_uid) >= v_limit then
    raise exception 'media_limit_reached' using hint = v_limit::text;
  end if;

  insert into public.media_assets (id, host_id, storage_path, kind, mime_type, bytes, label, duration_ms)
  values (p_asset_id, v_uid, p_storage_path, p_kind, p_mime_type, p_bytes,
          left(nullif(trim(p_label), ''), 60), p_duration_ms)
  returning * into v_asset;
  return v_asset;
end $$;


-- Remove from the library (references become null). Returns the storage
-- path; the client then deletes the file with storage.remove().
create or replace function public.delete_media_asset(p_asset_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  delete from public.media_assets where id = p_asset_id and host_id = auth.uid()
  returning storage_path into v_path;
  if v_path is null then raise exception 'invalid_media'; end if;
  return v_path;
end $$;


create or replace function public.set_room_intro_media(p_room_id uuid, p_media_id uuid default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  v_room := public.lock_hosted_room(p_room_id);
  if p_media_id is not null then
    perform public.require_room_feature(p_room_id, 'custom_media');
    perform public.check_media_owner(p_media_id, v_room.host_id);
  end if;
  update public.rooms set reveal_intro_media_id = p_media_id
  where id = p_room_id returning * into v_room;
  return v_room;
end $$;


create or replace function public.set_group_reveal_media(p_group_id uuid, p_media_id uuid default null)
returns public.groups language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms;
  v_group public.groups;
begin
  select * into v_group from public.groups where id = p_group_id;
  if not found then raise exception 'not_host'; end if;
  v_room := public.lock_hosted_room(v_group.room_id);
  if p_media_id is not null then
    perform public.require_room_feature(v_room.id, 'custom_media');
    perform public.check_media_owner(p_media_id, v_room.host_id);
  end if;
  update public.groups set reveal_media_id = p_media_id
  where id = p_group_id returning * into v_group;
  return v_group;
end $$;


-- =====================================================================
-- Row Level Security: read-only for clients, as in the core schema.
-- =====================================================================
alter table public.features            enable row level security;
alter table public.plan_features       enable row level security;
alter table public.room_feature_grants enable row level security;
alter table public.media_assets        enable row level security;
alter table public.groups              enable row level security;
alter table public.point_events        enable row level security;

create policy "features are public"
  on public.features for select to authenticated using (true);

create policy "plan features are public"
  on public.plan_features for select to authenticated using (true);

create policy "room grants visible to host"
  on public.room_feature_grants for select to authenticated
  using (public.is_room_host(room_id));

create policy "host reads own media"
  on public.media_assets for select to authenticated using (host_id = auth.uid());

create policy "groups visible within room"
  on public.groups for select to authenticated
  using (public.is_room_host(room_id) or public.is_room_member(room_id));

-- Students only see events for themselves or their current group, so they
-- can't read other students' totals (PLAN-groups-points.md §5).
create policy "point events visible to host and the people they concern"
  on public.point_events for select to authenticated
  using (
    public.is_room_host(room_id)
    or exists (
      select 1 from public.participants p
      where p.room_id = point_events.room_id
        and p.user_id = auth.uid()
        and (p.id = point_events.participant_id or p.group_id = point_events.group_id)
    )
  );

-- No insert/update/delete policies on purpose.


-- =====================================================================
-- Permissions. New functions default to EXECUTE for public, so revoke
-- everything and grant back only the client-facing RPCs.
-- =====================================================================
revoke execute on function
  public.effective_plan(uuid),
  public.host_has_feature(uuid, text),
  public.room_has_feature(uuid, text),
  public.require_room_feature(uuid, text),
  public.get_room_entitlements(uuid),
  public.smallest_group(uuid),
  public.assign_unassigned(uuid),
  public.lock_hosted_room(uuid),
  public.check_media_owner(uuid, uuid),
  public.get_join_info(text),
  public.join_room(text, text, uuid),
  public.choose_group(uuid),
  public.set_group_settings(uuid, text, text, text),
  public.save_groups(uuid, jsonb),
  public.move_participant(uuid, uuid),
  public.shuffle_groups(uuid),
  public.set_points_settings(uuid, boolean, int[]),
  public.award_points(uuid, int, uuid, uuid, uuid, text),
  public.undo_last_points(uuid),
  public.void_point_event(uuid),
  public.reset_points(uuid),
  public.get_scoreboard(uuid),
  public.register_media_asset(uuid, text, text, text, int, text, int),
  public.delete_media_asset(uuid),
  public.set_room_intro_media(uuid, uuid),
  public.set_group_reveal_media(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.host_has_feature(uuid, text),        -- the storage upload policy runs as the user
  public.get_room_entitlements(uuid),
  public.get_join_info(text),
  public.join_room(text, text, uuid),
  public.choose_group(uuid),
  public.set_group_settings(uuid, text, text, text),
  public.save_groups(uuid, jsonb),
  public.move_participant(uuid, uuid),
  public.shuffle_groups(uuid),
  public.set_points_settings(uuid, boolean, int[]),
  public.award_points(uuid, int, uuid, uuid, uuid, text),
  public.undo_last_points(uuid),
  public.void_point_event(uuid),
  public.reset_points(uuid),
  public.get_scoreboard(uuid),
  public.register_media_asset(uuid, text, text, text, int, text, int),
  public.delete_media_asset(uuid),
  public.set_room_intro_media(uuid, uuid),
  public.set_group_reveal_media(uuid, uuid)
to authenticated;

revoke all on
  public.features, public.plan_features, public.room_feature_grants,
  public.media_assets, public.groups, public.point_events
from anon;


-- =====================================================================
-- Realtime. rooms is already published, so settings changes reach
-- clients. Clients subscribe to these only while the feature is on.
-- =====================================================================
alter publication supabase_realtime add table public.groups, public.point_events;

-- =====================================================================
-- TV screens: a separate device (e.g. a Raspberry Pi on the room's TV)
-- that shows display mode for the host's rooms, read-only.
--
-- The screen opens /tv, signs in anonymously and shows a pairing code.
-- The host types the code into their host panel once. From then on the
-- screen shows the host's newest active room, or the one they last
-- pinned with "Show on TV", whichever is more recent.
--
-- Also: "Show scoreboard" / "Show QR" for display mode are now saved on
-- the room, so the host panel can switch them on a TV across the room.
-- =====================================================================

create table public.screens (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  host_id              uuid references public.hosts(id) on delete set null,  -- null = not paired
  pair_code            text unique,         -- shown on the TV while unpaired
  pair_code_expires_at timestamptz,
  room_id              uuid references public.rooms(id) on delete set null,  -- pinned room
  pinned_at            timestamptz,
  paired_at            timestamptz,
  created_at           timestamptz not null default now()
);
create index screens_host_idx on public.screens(host_id);

alter table public.screens enable row level security;

create policy "screens visible to themselves and their host"
  on public.screens for select to authenticated
  using (user_id = auth.uid() or host_id = auth.uid());

alter table public.rooms
  add column display_scores boolean not null default false,
  add column display_qr     boolean not null default false;


-- True when the caller is a screen paired to the room's host.
create or replace function public.is_room_screen(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    join public.screens s on s.host_id = r.host_id
    where r.id = p_room_id and s.user_id = auth.uid()
  );
$$;

grant execute on function public.is_room_screen(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Screens read everything display mode shows, like the host. Members
-- are checked before screens, so students' realtime checks stay as cheap
-- as before.
-- ---------------------------------------------------------------------
drop policy "room visible to host and members" on public.rooms;
create policy "room visible to host, members and screens"
  on public.rooms for select to authenticated
  using (host_id = auth.uid() or public.is_room_member(id) or public.is_room_screen(id));

drop policy "participants visible within room" on public.participants;
create policy "participants visible within room"
  on public.participants for select to authenticated
  using (public.is_room_host(room_id) or public.is_room_member(room_id) or public.is_room_screen(room_id));

drop policy "rounds visible within room" on public.rounds;
create policy "rounds visible within room"
  on public.rounds for select to authenticated
  using (public.is_room_host(room_id) or public.is_room_member(room_id) or public.is_room_screen(room_id));

drop policy "buzzes visible within room" on public.buzzes;
create policy "buzzes visible within room"
  on public.buzzes for select to authenticated
  using (exists (
    select 1 from public.rounds r
    where r.id = round_id
      and (public.is_room_host(r.room_id) or public.is_room_member(r.room_id)
           or public.is_room_screen(r.room_id))
  ));

drop policy "groups visible within room" on public.groups;
create policy "groups visible within room"
  on public.groups for select to authenticated
  using (public.is_room_host(room_id) or public.is_room_member(room_id) or public.is_room_screen(room_id));

drop policy "point events visible to host and the people they concern" on public.point_events;
create policy "point events visible to host, screens and the people they concern"
  on public.point_events for select to authenticated
  using (
    public.is_room_host(room_id)
    or exists (
      select 1 from public.participants p
      where p.room_id = point_events.room_id
        and p.user_id = auth.uid()
        and (p.id = point_events.participant_id or p.group_id = point_events.group_id)
    )
    or public.is_room_screen(room_id)
  );


-- ---------------------------------------------------------------------
-- Screen side
-- ---------------------------------------------------------------------

-- Registers the caller as a screen if needed and returns what /tv shows:
-- { paired, pair_code, pair_code_expires_at, host_id, room_code }.
-- Unpaired screens get a fresh 6-character code every 15 minutes.
create or replace function public.get_screen_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_screen public.screens;
  v_code   text;
  v_pinned public.rooms;
  v_newest public.rooms;
  v_room   public.rooms;
  v_chars  constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  insert into public.screens (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_screen from public.screens where user_id = v_uid for update;

  if v_screen.host_id is null then
    if v_screen.pair_code is null or v_screen.pair_code_expires_at < now() then
      loop
        select string_agg(substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1), '')
          into v_code from generate_series(1, 6);
        begin
          update public.screens
          set pair_code = v_code, pair_code_expires_at = now() + interval '15 minutes'
          where user_id = v_uid returning * into v_screen;
          exit;
        exception when unique_violation then
          -- Code in use by another screen; try another.
        end;
      end loop;
    end if;
    return jsonb_build_object(
      'paired', false,
      'pair_code', v_screen.pair_code,
      'pair_code_expires_at', v_screen.pair_code_expires_at,
      'host_id', null,
      'room_code', null);
  end if;

  select * into v_pinned from public.rooms
  where id = v_screen.room_id and host_id = v_screen.host_id and expires_at > now();
  select * into v_newest from public.rooms
  where host_id = v_screen.host_id and expires_at > now()
  order by created_at desc limit 1;

  -- Whichever happened last: pinning a room, or creating one.
  v_room := case
    when v_pinned.id is not null and v_pinned.id <> v_newest.id
         and v_screen.pinned_at > v_newest.created_at then v_pinned
    else v_newest end;

  return jsonb_build_object(
    'paired', true,
    'pair_code', null,
    'pair_code_expires_at', null,
    'host_id', v_screen.host_id,
    'room_code', v_room.code);
end $$;


-- ---------------------------------------------------------------------
-- Host side
-- ---------------------------------------------------------------------

-- Pair the screen showing p_code to the caller.
create or replace function public.pair_screen(p_code text)
returns public.screens language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_screen public.screens;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.hosts where id = v_uid) then raise exception 'not_host'; end if;

  update public.screens
  set host_id = v_uid, pair_code = null, pair_code_expires_at = null,
      paired_at = now(), room_id = null, pinned_at = null
  where pair_code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'))
    and pair_code_expires_at > now()
    and host_id is null
  returning * into v_screen;
  if not found then raise exception 'invalid_pair_code'; end if;
  return v_screen;
end $$;

-- Unpair a screen. Its host can do this, and so can the screen itself.
create or replace function public.unpair_screen(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.screens
  set host_id = null, room_id = null, pinned_at = null, paired_at = null
  where user_id = p_user_id and (host_id = auth.uid() or user_id = auth.uid());
  if not found then raise exception 'not_host'; end if;
end $$;

-- Show this room on all of the host's screens (until a newer room is made).
create or replace function public.show_room_on_screens(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  v_room := public.lock_hosted_room(p_room_id);
  update public.screens set room_id = v_room.id, pinned_at = now()
  where host_id = v_room.host_id;
end $$;

-- Display mode's scoreboard and QR overlay. null leaves a setting as is.
create or replace function public.set_display_options(
  p_room_id uuid, p_scores boolean default null, p_qr boolean default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  perform public.lock_hosted_room(p_room_id);
  update public.rooms
  set display_scores = coalesce(p_scores, display_scores),
      display_qr     = coalesce(p_qr, display_qr)
  where id = p_room_id returning * into v_room;
  return v_room;
end $$;


-- Screens get the full scoreboard, like the host. Otherwise unchanged.
create or replace function public.get_scoreboard(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_full boolean := public.is_room_host(p_room_id) or public.is_room_screen(p_room_id);
  v_me   uuid;
begin
  if not v_full then
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
        where p.room_id = p_room_id and (v_full or p.id = v_me)
      ) s), '[]'::jsonb)
  );
end $$;


revoke execute on function public.get_screen_state() from public, anon;
revoke execute on function public.pair_screen(text) from public, anon;
revoke execute on function public.unpair_screen(uuid) from public, anon;
revoke execute on function public.show_room_on_screens(uuid) from public, anon;
revoke execute on function public.set_display_options(uuid, boolean, boolean) from public, anon;
grant execute on function public.get_screen_state() to authenticated;
grant execute on function public.pair_screen(text) to authenticated;
grant execute on function public.unpair_screen(uuid) to authenticated;
grant execute on function public.show_room_on_screens(uuid) to authenticated;
grant execute on function public.set_display_options(uuid, boolean, boolean) to authenticated;

alter publication supabase_realtime add table public.screens;


-- ---------------------------------------------------------------------
-- Cleanup: the old job deleted every anonymous user after 30 days, which
-- would sign out an active host (and delete their media library) and
-- unpair their TV. Keep hosts with a room in the last 30 days, and
-- screens that are still paired. Same job name, so this replaces it.
-- ---------------------------------------------------------------------
select cron.schedule(
  'purge-old-anon-users',
  '30 4 * * *',
  $$ delete from auth.users u
     where u.is_anonymous
       and u.created_at < now() - interval '30 days'
       and not exists (select 1 from public.hosts h
                       where h.id = u.id and h.plan <> 'free')
       and not exists (select 1 from public.rooms r
                       where r.host_id = u.id and r.created_at > now() - interval '30 days')
       and not exists (select 1 from public.screens s
                       where s.user_id = u.id and s.host_id is not null) $$
);

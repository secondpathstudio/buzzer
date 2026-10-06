-- =====================================================================
-- Buzzer — schema v0.2 (Supabase / Postgres 15+)
--
-- Students: always anonymous auth (signInAnonymously).
-- Hosts:    start anonymous; link an email before paying.
-- Clients can only READ tables (via RLS). Every write goes through a
-- SECURITY DEFINER function below, so caps and fairness are enforced
-- server-side and can't be bypassed from the browser.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Plans: the participant cap lives here, so changing it is one UPDATE.
-- (Existing rooms keep the cap they were created with.)
--
-- SELF-HOSTED DEFAULT: 'free' = 190. Supabase's free tier allows 200
-- concurrent realtime connections, leaving headroom for host + display.
-- HOSTED VERSION (later): set the free cap to 30 or 50, e.g.
--   update public.plans set max_participants = 30 where id = 'free';
-- ---------------------------------------------------------------------
create table public.plans (
  id               text primary key,
  max_participants int  not null check (max_participants > 0),
  max_active_rooms int  not null check (max_active_rooms > 0)
);

insert into public.plans (id, max_participants, max_active_rooms) values
  ('free', 190, 3),
  ('pro',  500, 20);


-- ---------------------------------------------------------------------
-- Hosts (one row per person who has created a room)
-- ---------------------------------------------------------------------
create table public.hosts (
  id                  uuid primary key references auth.users(id) on delete cascade,
  plan                text not null default 'free' references public.plans(id),
  plan_expires_at     timestamptz,          -- null = no expiry
  payment_customer_id text unique,          -- Stripe / Lemon Squeezy customer id
  created_at          timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------
create table public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,    -- 6 chars, used in QR URL /r/CODE
  host_id          uuid not null references auth.users(id) on delete cascade,
  title            text check (char_length(title) <= 100),
  max_participants int  not null,           -- copied from plan (or event pass)
  current_round_id uuid,                    -- FK added below (circular)
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '24 hours'
);


-- ---------------------------------------------------------------------
-- Purchases (written ONLY by your payment webhook using the service
-- role key, which bypasses RLS). provider_ref makes webhooks idempotent.
-- ---------------------------------------------------------------------
create table public.purchases (
  id               uuid primary key default gen_random_uuid(),
  host_id          uuid not null references public.hosts(id) on delete cascade,
  kind             text not null check (kind in ('subscription', 'event_pass')),
  provider_ref     text not null unique,
  max_participants int  not null,
  room_id          uuid references public.rooms(id) on delete set null,  -- event pass target
  valid_until      timestamptz,
  created_at       timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- Participants (students in a room)
-- ---------------------------------------------------------------------
create table public.participants (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at    timestamptz not null default now(),
  unique (room_id, user_id)                 -- refreshes never use a new slot
);


-- ---------------------------------------------------------------------
-- Rounds (Reset = new round, so history is kept)
-- ---------------------------------------------------------------------
create table public.rounds (
  id        uuid primary key default gen_random_uuid(),
  room_id   uuid not null references public.rooms(id) on delete cascade,
  number    int  not null,
  status    text not null default 'waiting'
            check (status in ('waiting', 'open', 'locked')),
  opened_at timestamptz,
  locked_at timestamptz,
  winner_id uuid references public.participants(id) on delete set null,
  unique (room_id, number)
);

alter table public.rooms
  add constraint rooms_current_round_fk
  foreign key (current_round_id) references public.rounds(id) on delete set null;


-- ---------------------------------------------------------------------
-- Buzzes. position is assigned while holding a lock on the round row,
-- so position order and buzzed_at order always agree.
-- ---------------------------------------------------------------------
create table public.buzzes (
  round_id       uuid not null references public.rounds(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  position       int  not null,             -- 1 = fastest
  buzzed_at      timestamptz not null default clock_timestamp(),
  primary key (round_id, participant_id),   -- one buzz per student per round
  unique (round_id, position)
);

create index on public.rooms (host_id);
create index on public.participants (user_id);
create index on public.rounds (room_id);


-- =====================================================================
-- RLS helpers (SECURITY DEFINER avoids recursive policy lookups)
-- =====================================================================
create or replace function public.is_room_host(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms where id = p_room_id and host_id = auth.uid()
  );
$$;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participants where room_id = p_room_id and user_id = auth.uid()
  );
$$;


-- =====================================================================
-- Row Level Security: read-only for clients.
-- Remember: anonymous users get the `authenticated` role too, so every
-- policy checks room membership, never just "is logged in".
-- =====================================================================
alter table public.plans        enable row level security;
alter table public.hosts        enable row level security;
alter table public.rooms        enable row level security;
alter table public.purchases    enable row level security;
alter table public.participants enable row level security;
alter table public.rounds       enable row level security;
alter table public.buzzes       enable row level security;

create policy "plans are public"
  on public.plans for select to authenticated using (true);

create policy "host reads own row"
  on public.hosts for select to authenticated using (id = auth.uid());

create policy "host reads own purchases"
  on public.purchases for select to authenticated using (host_id = auth.uid());

create policy "room visible to host and members"
  on public.rooms for select to authenticated
  using (host_id = auth.uid() or public.is_room_member(id));

create policy "participants visible within room"
  on public.participants for select to authenticated
  using (public.is_room_host(room_id) or public.is_room_member(room_id));

create policy "rounds visible within room"
  on public.rounds for select to authenticated
  using (public.is_room_host(room_id) or public.is_room_member(room_id));

create policy "buzzes visible within room"
  on public.buzzes for select to authenticated
  using (exists (
    select 1 from public.rounds r
    where r.id = round_id
      and (public.is_room_host(r.room_id) or public.is_room_member(r.room_id))
  ));

-- No insert/update/delete policies on purpose.


-- =====================================================================
-- Functions (RPCs) — call from the client with supabase.rpc('name', {...})
-- =====================================================================

-- 6-char code without look-alikes (no 0/O/1/I)
create or replace function public.generate_room_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * 32)::int, 1);
  end loop;
  return result;
end $$;


-- Host: create a room. Cap comes from the host's active plan.
create or replace function public.create_room(p_title text default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_plan     public.plans;
  v_active   int;
  v_room     public.rooms;
  v_round_id uuid;
  v_attempt  int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  insert into public.hosts (id) values (v_uid) on conflict (id) do nothing;

  -- Lapsed paid plans fall back to free
  select p.* into v_plan
  from public.hosts h
  join public.plans p on p.id = case
    when h.plan <> 'free' and (h.plan_expires_at is null or h.plan_expires_at > now())
    then h.plan else 'free' end
  where h.id = v_uid;

  select count(*) into v_active
  from public.rooms where host_id = v_uid and expires_at > now();
  if v_active >= v_plan.max_active_rooms then
    raise exception 'too_many_active_rooms';
  end if;

  loop
    begin
      insert into public.rooms (code, host_id, title, max_participants)
      values (public.generate_room_code(), v_uid,
              nullif(trim(p_title), ''), v_plan.max_participants)
      returning * into v_room;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;

  insert into public.rounds (room_id, number)
  values (v_room.id, 1) returning id into v_round_id;

  update public.rooms set current_round_id = v_round_id
  where id = v_room.id returning * into v_room;

  return v_room;
end $$;


-- Student: join by code. Enforces the participant cap atomically.
create or replace function public.join_room(p_code text, p_display_name text)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare
  v_uid         uuid := auth.uid();
  v_name        text := trim(p_display_name);
  v_room        public.rooms;
  v_count       int;
  v_participant public.participants;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'invalid_name';
  end if;

  -- Row lock: two students can't both grab the last slot
  select * into v_room from public.rooms
  where code = upper(trim(p_code)) and expires_at > now()
  for update;
  if not found then raise exception 'room_not_found'; end if;

  -- Already in the room (refresh / reopened tab): just update the name
  update public.participants set display_name = v_name
  where room_id = v_room.id and user_id = v_uid
  returning * into v_participant;
  if found then return v_participant; end if;

  select count(*) into v_count from public.participants where room_id = v_room.id;
  if v_count >= v_room.max_participants then
    raise exception 'room_full'
      using hint = format('This room is limited to %s participants', v_room.max_participants);
  end if;

  insert into public.participants (room_id, user_id, display_name)
  values (v_room.id, v_uid, v_name)
  returning * into v_participant;

  return v_participant;
end $$;


-- Student: buzz. Returns your position (1 = first). Double taps are harmless.
create or replace function public.buzz(p_round_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_round public.rounds;
  v_pid   uuid;
  v_pos   int;
begin
  -- Lock first, timestamp after: buzzes in a round are processed one at a
  -- time, in the order they reach the database.
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then raise exception 'round_not_found'; end if;
  if v_round.status <> 'open' then raise exception 'round_not_open'; end if;

  select id into v_pid from public.participants
  where room_id = v_round.room_id and user_id = auth.uid();
  if v_pid is null then raise exception 'not_a_participant'; end if;

  select position into v_pos from public.buzzes
  where round_id = p_round_id and participant_id = v_pid;
  if found then return v_pos; end if;

  select count(*) + 1 into v_pos from public.buzzes where round_id = p_round_id;

  insert into public.buzzes (round_id, participant_id, position)
  values (p_round_id, v_pid, v_pos);

  if v_pos = 1 then
    update public.rounds set winner_id = v_pid where id = p_round_id;
  end if;

  return v_pos;
end $$;


-- Host: open the current (waiting) round
create or replace function public.open_round(p_room_id uuid)
returns public.rounds language plpgsql security definer set search_path = '' as $$
declare v_round public.rounds;
begin
  if not public.is_room_host(p_room_id) then raise exception 'not_host'; end if;

  update public.rounds r set status = 'open', opened_at = now()
  from public.rooms rm
  where rm.id = p_room_id and r.id = rm.current_round_id and r.status = 'waiting'
  returning r.* into v_round;

  if not found then raise exception 'round_not_waiting'; end if;
  return v_round;
end $$;


-- Host: stop accepting buzzes on the current round
create or replace function public.lock_round(p_room_id uuid)
returns public.rounds language plpgsql security definer set search_path = '' as $$
declare v_round public.rounds;
begin
  if not public.is_room_host(p_room_id) then raise exception 'not_host'; end if;

  update public.rounds r set status = 'locked', locked_at = now()
  from public.rooms rm
  where rm.id = p_room_id and r.id = rm.current_round_id and r.status = 'open'
  returning r.* into v_round;

  if not found then raise exception 'round_not_open'; end if;
  return v_round;
end $$;


-- Host: Reset. Locks the current round and starts a new one
-- (open immediately by default, or 'waiting' if p_open = false).
create or replace function public.reset_round(p_room_id uuid, p_open boolean default true)
returns public.rounds language plpgsql security definer set search_path = '' as $$
declare
  v_room  public.rooms;
  v_round public.rounds;
begin
  if not public.is_room_host(p_room_id) then raise exception 'not_host'; end if;

  select * into v_room from public.rooms where id = p_room_id for update;

  update public.rounds
  set status = 'locked', locked_at = coalesce(locked_at, now())
  where id = v_room.current_round_id and status <> 'locked';

  insert into public.rounds (room_id, number, status, opened_at)
  select p_room_id,
         coalesce(max(number), 0) + 1,
         case when p_open then 'open' else 'waiting' end,
         case when p_open then now() end
  from public.rounds where room_id = p_room_id
  returning * into v_round;

  update public.rooms set current_round_id = v_round.id where id = p_room_id;
  return v_round;
end $$;


-- Host: remove a participant (e.g. a rude display name on the projector).
-- Frees their slot. They can rejoin; add a ban list later if needed.
create or replace function public.remove_participant(p_participant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_room_id uuid;
begin
  select room_id into v_room_id from public.participants where id = p_participant_id;
  if v_room_id is null or not public.is_room_host(v_room_id) then
    raise exception 'not_host';
  end if;
  delete from public.participants where id = p_participant_id;
end $$;


-- =====================================================================
-- Permissions: nothing for anon; only the RPCs above for authenticated
-- =====================================================================
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_room_host(uuid),
  public.is_room_member(uuid),
  public.create_room(text),
  public.join_room(text, text),
  public.buzz(uuid),
  public.open_round(uuid),
  public.lock_round(uuid),
  public.reset_round(uuid, boolean),
  public.remove_participant(uuid)
to authenticated;

revoke all on all tables in schema public from anon;


-- =====================================================================
-- Realtime (Postgres Changes respects RLS — fine for the POC).
-- Host, display and student pages subscribe to these tables filtered by
-- room_id / round_id. At larger scale, switch to Broadcast-from-database
-- triggers, which fan out more cheaply.
-- =====================================================================
alter publication supabase_realtime
  add table public.rooms, public.rounds, public.buzzes, public.participants;


-- =====================================================================
-- Cleanup (optional). Enable pg_cron first:
-- Dashboard → Database → Extensions → pg_cron. Then run:
--
-- select cron.schedule('purge-expired-rooms', '0 4 * * *',
--   $$ delete from public.rooms where expires_at < now() - interval '7 days' $$);
--
-- Supabase doesn't auto-delete anonymous users. This removes ones older
-- than 30 days that aren't paying hosts. The app should call
-- signInAnonymously() again if a stored session stops working.
--
-- select cron.schedule('purge-old-anon-users', '30 4 * * *',
--   $$ delete from auth.users u
--      where u.is_anonymous
--        and u.created_at < now() - interval '30 days'
--        and not exists (select 1 from public.hosts h
--                        where h.id = u.id and h.plan <> 'free') $$);
-- =====================================================================


-- =====================================================================
-- Payment webhook (Next.js route handler, service role key) — notes:
--   subscription paid  → upsert purchases; update hosts set plan = 'pro',
--                        plan_expires_at = <period end>
--   event pass paid    → insert purchases (room_id set);
--                        update rooms set max_participants = <pass size>
--                        where id = <room_id>
-- Require a linked (non-anonymous) account before checkout.
-- =====================================================================

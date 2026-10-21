-- =====================================================================
-- A paired TV screen can award and deduct points and undo the last award,
-- so a keyboard or clicker on the TV scores the round's winner (A / D / Z,
-- or + / -). Point settings and resets stay with the host.
-- Same as before except the host check.
-- =====================================================================

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
  if not found or not (v_room.host_id = auth.uid() or public.is_room_screen(p_room_id)) then
    raise exception 'not_host';
  end if;
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


create or replace function public.undo_last_points(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event public.point_events;
begin
  if not (public.is_room_host(p_room_id) or public.is_room_screen(p_room_id)) then
    raise exception 'not_host';
  end if;

  update public.point_events set voided_at = now()
  where id = (
    select id from public.point_events
    where room_id = p_room_id and voided_at is null
    order by created_at desc, id desc
    limit 1
    for update)
  returning * into v_event;

  if not found then return null; end if;
  return to_jsonb(v_event);
end $$;

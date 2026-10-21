-- =====================================================================
-- Reset room: start the room over without anyone rejoining. Students,
-- groups and settings stay; every point goes back to 0; round history
-- (and its buzzes) is cleared and the room starts again at Round 1,
-- waiting for the host to open it. A truly fresh room is a new room.
-- =====================================================================

create or replace function public.reset_room(p_room_id uuid)
returns public.rounds language plpgsql security definer set search_path = '' as $$
declare v_round public.rounds;
begin
  perform public.lock_hosted_room(p_room_id);

  -- Voided rather than deleted, like reset_points: the ledger keeps them.
  update public.point_events set voided_at = now()
  where room_id = p_room_id and voided_at is null;

  -- Buzzes go with their rounds; point events keep a null round_id.
  delete from public.rounds where room_id = p_room_id;

  insert into public.rounds (room_id, number, status)
  values (p_room_id, 1, 'waiting')
  returning * into v_round;

  -- Rest on the scoreboard (all zeros), like after a round reset.
  update public.rooms
  set current_round_id = v_round.id,
      display_scores   = display_scores or points_enabled
  where id = p_room_id;
  return v_round;
end $$;

revoke execute on function public.reset_room(uuid) from public, anon;
grant execute on function public.reset_room(uuid) to authenticated;

-- =====================================================================
-- Resetting into a waiting round shows the scoreboard (when points are
-- on), even if nobody scored, so the display rests on the scores between
-- rounds. Opening the round still switches to the buzzer screen.
-- Same as before plus the last update.
-- =====================================================================

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

  if not p_open then
    update public.rooms set display_scores = true
    where id = p_room_id and points_enabled and not display_scores;
  end if;
  return v_round;
end $$;

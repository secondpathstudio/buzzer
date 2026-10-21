-- =====================================================================
-- Opening a round switches display mode from the scoreboard back to the
-- buzzer screen. A trigger catches every way a round opens (open_round,
-- reset_round), and turning display_scores off on the room keeps the
-- host's switch, this browser's display and paired TVs in step. The host
-- can show the scoreboard again (S / the switch) at any time.
-- =====================================================================

create or replace function public.hide_scores_on_open()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.rooms set display_scores = false
  where id = new.room_id and display_scores;
  return null;
end $$;

create trigger rounds_hide_scores_on_open
  after insert or update of status on public.rounds
  for each row when (new.status = 'open')
  execute function public.hide_scores_on_open();

revoke execute on function public.hide_scores_on_open() from public, anon, authenticated;

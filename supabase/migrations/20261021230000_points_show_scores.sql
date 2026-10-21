-- =====================================================================
-- The reverse of rounds_hide_scores_on_open: any change to points (an
-- award, a deduction, undo or reset, which void events) switches display
-- mode to the scoreboard. Opening the next round switches it back.
-- =====================================================================

create or replace function public.show_scores_on_points()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Only writes when it's off, so a reset voiding many events updates once.
  update public.rooms set display_scores = true
  where id = new.room_id and not display_scores;
  return null;
end $$;

create trigger point_events_show_scores
  after insert or update of voided_at on public.point_events
  for each row
  execute function public.show_scores_on_points();

revoke execute on function public.show_scores_on_points() from public, anon, authenticated;

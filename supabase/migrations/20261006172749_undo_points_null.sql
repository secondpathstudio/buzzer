-- undo_last_points returned a composite, and PostgREST renders a null
-- composite as an object of nulls. Return jsonb instead, so "nothing to
-- undo" comes back as a real null.
drop function public.undo_last_points(uuid);

create or replace function public.undo_last_points(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  return to_jsonb(v_event);
end $$;

revoke execute on function public.undo_last_points(uuid) from public, anon;
grant execute on function public.undo_last_points(uuid) to authenticated;

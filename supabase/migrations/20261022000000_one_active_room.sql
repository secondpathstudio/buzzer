-- =====================================================================
-- One active room per host. Starting a new room with p_replace ends the
-- host's current one (expires it now), so back-to-back classes each get
-- a fresh room without waiting out the 24 hours.
-- =====================================================================

update public.plans set max_active_rooms = 1 where id = 'free';

drop function public.create_room(text, uuid);

create function public.create_room(
  p_title       text    default null,
  p_template_id uuid    default null,
  p_replace     boolean default false
)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  if p_replace then
    update public.rooms set expires_at = now()
    where host_id = auth.uid() and expires_at > now();
  end if;

  v_room := public.create_blank_room(p_title);
  if p_template_id is not null then
    v_room := public.apply_room_template(v_room.id, p_template_id);
  end if;
  return v_room;
end $$;

revoke execute on function public.create_room(text, uuid, boolean) from public, anon;
grant execute on function public.create_room(text, uuid, boolean) to authenticated;

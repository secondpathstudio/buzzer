-- =====================================================================
-- How dark the overlay on the display background is, 0–90 %. Capped
-- below 100 so the background never disappears entirely. Saved in
-- templates like the background itself.
-- =====================================================================

alter table public.rooms
  add column display_background_dim smallint not null default 55
    check (display_background_dim between 0 and 90);


create or replace function public.set_display_background_dim(p_room_id uuid, p_dim int)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  perform public.lock_hosted_room(p_room_id);
  if p_dim is null or p_dim not between 0 and 90 then
    raise exception 'invalid_background_dim';
  end if;
  update public.rooms set display_background_dim = p_dim
  where id = p_room_id returning * into v_room;
  return v_room;
end $$;


-- ---------------------------------------------------------------------
-- Templates: same as before, plus the dim.
-- ---------------------------------------------------------------------
create or replace function public.room_template_config(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title',                       r.title,
    'groups_mode',                 r.groups_mode,
    'group_noun',                  r.group_noun,
    'group_noun_plural',           r.group_noun_plural,
    'sorting_text',                r.sorting_text,
    'reveal_intro_media_id',       r.reveal_intro_media_id,
    'points_enabled',              r.points_enabled,
    'point_presets',               to_jsonb(r.point_presets),
    'display_scores',              r.display_scores,
    'display_qr',                  r.display_qr,
    'display_background_media_id', r.display_background_media_id,
    'display_background_dim',      r.display_background_dim,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', g.name, 'color', g.color, 'emoji', g.emoji,
               'reveal_media_id', g.reveal_media_id)
             order by g.sort_order)
      from public.groups g where g.room_id = r.id), '[]'::jsonb))
  from public.rooms r where r.id = p_room_id;
$$;


-- Wraps the settings step rather than copying it again: apply the
-- rest, then the dim (older templates have none: the default).
alter function public.apply_room_template_settings(uuid, uuid) rename to apply_room_template_settings_base;
revoke execute on function public.apply_room_template_settings_base(uuid, uuid) from public, anon, authenticated;

create or replace function public.apply_room_template_settings(p_room_id uuid, p_template_id uuid)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_dim int;
begin
  perform public.apply_room_template_settings_base(p_room_id, p_template_id);
  select coalesce((config->>'display_background_dim')::int, 55) into v_dim
  from public.room_templates where id = p_template_id;
  return public.set_display_background_dim(p_room_id, least(greatest(v_dim, 0), 90));
end $$;
revoke execute on function public.apply_room_template_settings(uuid, uuid) from public, anon, authenticated;


drop trigger rooms_sync_template on public.rooms;
create trigger rooms_sync_template
  after update of title, groups_mode, group_noun, group_noun_plural, sorting_text,
                  reveal_intro_media_id, points_enabled, point_presets,
                  display_scores, display_qr, display_background_media_id,
                  display_background_dim
  on public.rooms
  for each row when (new.template_id is not null)
  execute function public.sync_room_template();


revoke execute on function public.set_display_background_dim(uuid, int) from public, anon;
grant execute on function public.set_display_background_dim(uuid, int) to authenticated;

-- =====================================================================
-- Display background: an image or looping video from the host's media
-- library, shown behind display mode (this browser's and paired TVs').
-- Part of the custom_media feature. Saved in templates like the other
-- display options.
-- =====================================================================

alter table public.rooms
  add column display_background_media_id uuid references public.media_assets(id) on delete set null;


-- null clears it.
create or replace function public.set_display_background(p_room_id uuid, p_media_id uuid default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  v_room := public.lock_hosted_room(p_room_id);
  if p_media_id is not null then
    perform public.require_room_feature(p_room_id, 'custom_media');
    perform public.check_media_owner(p_media_id, v_room.host_id);
  end if;
  update public.rooms set display_background_media_id = p_media_id
  where id = p_room_id returning * into v_room;
  return v_room;
end $$;


-- The file to show, as {path, kind}, or null. Screens can't read the
-- host's media library, so display mode asks for it here.
create or replace function public.get_display_background(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_room_host(p_room_id) or public.is_room_screen(p_room_id)) then
    raise exception 'not_host';
  end if;
  if not public.room_has_feature(p_room_id, 'custom_media') then
    return null;
  end if;
  return (
    select jsonb_build_object('path', m.storage_path, 'kind', m.kind)
    from public.rooms r
    join public.media_assets m on m.id = r.display_background_media_id
    where r.id = p_room_id);
end $$;


-- ---------------------------------------------------------------------
-- Templates: same as before, plus the background.
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
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', g.name, 'color', g.color, 'emoji', g.emoji,
               'reveal_media_id', g.reveal_media_id)
             order by g.sort_order)
      from public.groups g where g.room_id = r.id), '[]'::jsonb))
  from public.rooms r where r.id = p_room_id;
$$;


create or replace function public.apply_room_template_settings(p_room_id uuid, p_template_id uuid)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  v_room      public.rooms;
  v_config    jsonb;
  v_media_ok  boolean;
  v_groups_ok boolean;
  v_groups    jsonb;
  v_intro     uuid;
  v_bg        uuid;
begin
  v_room := public.lock_hosted_room(p_room_id);
  select config into v_config from public.room_templates
  where id = p_template_id and host_id = v_room.host_id;
  if not found then raise exception 'template_not_found'; end if;

  v_media_ok  := public.room_has_feature(p_room_id, 'custom_media');
  v_groups_ok := public.room_has_feature(p_room_id, 'groups')
                 and jsonb_array_length(v_config->'groups') >= 2;

  if v_groups_ok then
    -- Media that's gone from the library is dropped, not an error.
    select jsonb_agg(jsonb_build_object(
             'name', g->>'name', 'color', g->>'color', 'emoji', g->'emoji',
             'reveal_media_id',
               case when v_media_ok and exists (
                 select 1 from public.media_assets m
                 where m.id = (g->>'reveal_media_id')::uuid and m.host_id = v_room.host_id)
               then g->>'reveal_media_id' end)
           order by t.ord)
    into v_groups
    from jsonb_array_elements(v_config->'groups') with ordinality as t(g, ord);
    perform public.save_groups(p_room_id, v_groups);
  end if;

  perform public.set_group_settings(
    p_room_id,
    case when v_groups_ok then v_config->>'groups_mode' else 'off' end,
    v_config->>'group_noun',
    v_config->>'group_noun_plural');
  perform public.set_sorting_text(
    p_room_id, case when v_groups_ok then v_config->>'sorting_text' end);

  perform public.set_points_settings(
    p_room_id,
    coalesce((v_config->>'points_enabled')::boolean, false)
      and public.room_has_feature(p_room_id, 'points'),
    -- An empty list would be invalid; null keeps the room's presets.
    nullif(array(select jsonb_array_elements_text(v_config->'point_presets')::int), '{}'::int[]));

  v_intro := (v_config->>'reveal_intro_media_id')::uuid;
  if not v_media_ok or not exists (
    select 1 from public.media_assets where id = v_intro and host_id = v_room.host_id
  ) then
    v_intro := null;
  end if;
  perform public.set_room_intro_media(p_room_id, v_intro);

  -- Templates saved before backgrounds existed have no key: no background.
  v_bg := (v_config->>'display_background_media_id')::uuid;
  if not v_media_ok or not exists (
    select 1 from public.media_assets where id = v_bg and host_id = v_room.host_id
  ) then
    v_bg := null;
  end if;
  perform public.set_display_background(p_room_id, v_bg);

  return public.set_display_options(
    p_room_id,
    coalesce((v_config->>'display_scores')::boolean, false),
    coalesce((v_config->>'display_qr')::boolean, false));
end $$;


drop trigger rooms_sync_template on public.rooms;
create trigger rooms_sync_template
  after update of title, groups_mode, group_noun, group_noun_plural, sorting_text,
                  reveal_intro_media_id, points_enabled, point_presets,
                  display_scores, display_qr, display_background_media_id
  on public.rooms
  for each row when (new.template_id is not null)
  execute function public.sync_room_template();


revoke execute on function
  public.set_display_background(uuid, uuid),
  public.get_display_background(uuid)
from public, anon;
grant execute on function
  public.set_display_background(uuid, uuid),
  public.get_display_background(uuid)
to authenticated;

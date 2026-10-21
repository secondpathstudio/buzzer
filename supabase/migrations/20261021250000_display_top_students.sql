-- =====================================================================
-- Whether the scoreboard lists the top students under the group bars.
-- (With groups off, the list is the whole scoreboard, so it always shows.)
-- A display option like the others, saved in templates.
-- =====================================================================

alter table public.rooms
  add column display_top_students boolean not null default true;


-- set_display_options gains p_top_students. null leaves a setting as is.
drop function public.set_display_options(uuid, boolean, boolean);

create or replace function public.set_display_options(
  p_room_id uuid, p_scores boolean default null, p_qr boolean default null,
  p_top_students boolean default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  perform public.lock_hosted_room(p_room_id);
  update public.rooms
  set display_scores       = coalesce(p_scores, display_scores),
      display_qr           = coalesce(p_qr, display_qr),
      display_top_students = coalesce(p_top_students, display_top_students)
  where id = p_room_id returning * into v_room;
  return v_room;
end $$;

revoke execute on function public.set_display_options(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_display_options(uuid, boolean, boolean, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- Templates: same as before, plus top students.
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
    'display_top_students',        r.display_top_students,
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


-- Older templates have no key: shown, the default.
create or replace function public.apply_room_template_settings(p_room_id uuid, p_template_id uuid)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_config jsonb;
begin
  perform public.apply_room_template_settings_base(p_room_id, p_template_id);
  select config into v_config from public.room_templates where id = p_template_id;
  perform public.set_display_background_dim(
    p_room_id, least(greatest(coalesce((v_config->>'display_background_dim')::int, 55), 0), 90));
  return public.set_display_options(
    p_room_id, p_top_students => coalesce((v_config->>'display_top_students')::boolean, true));
end $$;


drop trigger rooms_sync_template on public.rooms;
create trigger rooms_sync_template
  after update of title, groups_mode, group_noun, group_noun_plural, sorting_text,
                  reveal_intro_media_id, points_enabled, point_presets,
                  display_scores, display_qr, display_top_students,
                  display_background_media_id, display_background_dim
  on public.rooms
  for each row when (new.template_id is not null)
  execute function public.sync_room_template();

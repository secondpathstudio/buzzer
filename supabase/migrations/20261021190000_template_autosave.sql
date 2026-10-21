-- =====================================================================
-- Template auto-save. A room is linked to the template it was created
-- from, loaded from, or saved as; while linked, every change to the
-- room's setup is written back to that template by triggers, so it
-- catches all paths (host panel, media deleted from the library, ...).
-- The host can unlink a room to make one-off changes.
-- =====================================================================

alter table public.rooms
  add column template_id uuid references public.room_templates(id) on delete set null;


-- The room's setup as stored in room_templates.config (internal).
create or replace function public.room_template_config(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title',                 r.title,
    'groups_mode',           r.groups_mode,
    'group_noun',            r.group_noun,
    'group_noun_plural',     r.group_noun_plural,
    'sorting_text',          r.sorting_text,
    'reveal_intro_media_id', r.reveal_intro_media_id,
    'points_enabled',        r.points_enabled,
    'point_presets',         to_jsonb(r.point_presets),
    'display_scores',        r.display_scores,
    'display_qr',            r.display_qr,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', g.name, 'color', g.color, 'emoji', g.emoji,
               'reveal_media_id', g.reveal_media_id)
             order by g.sort_order)
      from public.groups g where g.room_id = r.id), '[]'::jsonb))
  from public.rooms r where r.id = p_room_id;
$$;


-- Same as before, but uses room_template_config() and links the room.
create or replace function public.save_room_template(p_room_id uuid, p_name text)
returns public.room_templates language plpgsql security definer set search_path = '' as $$
declare
  v_room     public.rooms;
  v_name     text := trim(p_name);
  v_template public.room_templates;
begin
  v_room := public.lock_hosted_room(p_room_id);
  if v_name is null or char_length(v_name) not between 1 and 60 then
    raise exception 'invalid_template_name';
  end if;
  if not exists (select 1 from public.room_templates
                 where host_id = v_room.host_id and name = v_name)
     and (select count(*) from public.room_templates where host_id = v_room.host_id) >= 50 then
    raise exception 'too_many_templates' using hint = 'limit 50';
  end if;

  insert into public.room_templates (host_id, name, config)
  values (v_room.host_id, v_name, public.room_template_config(p_room_id))
  on conflict (host_id, name) do update
    set config = excluded.config, updated_at = now()
  returning * into v_template;

  update public.rooms set template_id = v_template.id where id = p_room_id;
  return v_template;
end $$;


-- Loading unlinks the room first, so the half-applied steps aren't
-- written into the old (or new) template, then links it at the end.
alter function public.apply_room_template(uuid, uuid) rename to apply_room_template_settings;
revoke execute on function public.apply_room_template_settings(uuid, uuid) from public, anon, authenticated;

create or replace function public.apply_room_template(p_room_id uuid, p_template_id uuid)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  perform public.lock_hosted_room(p_room_id);
  update public.rooms set template_id = null where id = p_room_id;
  perform public.apply_room_template_settings(p_room_id, p_template_id);
  update public.rooms set template_id = p_template_id
  where id = p_room_id returning * into v_room;
  return v_room;
end $$;


-- Stop auto-saving this room's changes to its template.
create or replace function public.unlink_room_template(p_room_id uuid)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  perform public.lock_hosted_room(p_room_id);
  update public.rooms set template_id = null
  where id = p_room_id returning * into v_room;
  return v_room;
end $$;


-- Trigger: re-save the linked template after a room or group change.
-- Rows deleted along with their room find no room and do nothing.
create or replace function public.sync_room_template()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_room_id uuid;
begin
  if tg_table_name = 'rooms' then
    v_room_id := new.id;
  elsif tg_op = 'DELETE' then
    v_room_id := old.room_id;
  else
    v_room_id := new.room_id;
  end if;

  update public.room_templates t
  set config = public.room_template_config(r.id), updated_at = now()
  from public.rooms r
  where r.id = v_room_id and t.id = r.template_id;
  return null;
end $$;

-- Only setup columns: rounds, expiry and template_id itself don't count.
create trigger rooms_sync_template
  after update of title, groups_mode, group_noun, group_noun_plural, sorting_text,
                  reveal_intro_media_id, points_enabled, point_presets,
                  display_scores, display_qr
  on public.rooms
  for each row when (new.template_id is not null)
  execute function public.sync_room_template();

create trigger groups_sync_template
  after insert or update or delete on public.groups
  for each row execute function public.sync_room_template();


revoke execute on function
  public.room_template_config(uuid),
  public.sync_room_template(),
  public.apply_room_template(uuid, uuid),
  public.unlink_room_template(uuid)
from public, anon;
revoke execute on function
  public.room_template_config(uuid),
  public.sync_room_template()
from authenticated;
grant execute on function
  public.apply_room_template(uuid, uuid),
  public.unlink_room_template(uuid)
to authenticated;

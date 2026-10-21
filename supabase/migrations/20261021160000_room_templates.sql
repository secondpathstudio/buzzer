-- =====================================================================
-- Room templates: a host saves a room's setup (groups, reveal media,
-- points, display options) under a name, then starts new rooms from it
-- or loads it into an existing room.
--
-- The config is always a snapshot taken on the server by
-- save_room_template(), never JSON sent by the client. Applying it goes
-- through the same functions the host panel uses, so entitlement and
-- media ownership checks still run. Media deleted since the template was
-- saved, or features the host no longer has, are skipped rather than
-- failing the whole room.
-- =====================================================================

create table public.room_templates (
  id         uuid primary key default gen_random_uuid(),
  host_id    uuid not null references public.hosts(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  config     jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_templates_host_name_key unique (host_id, name)
);

alter table public.room_templates enable row level security;

create policy "host reads own templates"
  on public.room_templates for select to authenticated using (host_id = auth.uid());

-- No insert/update/delete policies on purpose.


-- ---------------------------------------------------------------------
-- Save the room's current setup as a template. Saving under an existing
-- name replaces that template.
-- ---------------------------------------------------------------------
create or replace function public.save_room_template(p_room_id uuid, p_name text)
returns public.room_templates language plpgsql security definer set search_path = '' as $$
declare
  v_room     public.rooms;
  v_name     text := trim(p_name);
  v_config   jsonb;
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

  v_config := jsonb_build_object(
    'title',                 v_room.title,
    'groups_mode',           v_room.groups_mode,
    'group_noun',            v_room.group_noun,
    'group_noun_plural',     v_room.group_noun_plural,
    'sorting_text',          v_room.sorting_text,
    'reveal_intro_media_id', v_room.reveal_intro_media_id,
    'points_enabled',        v_room.points_enabled,
    'point_presets',         to_jsonb(v_room.point_presets),
    'display_scores',        v_room.display_scores,
    'display_qr',            v_room.display_qr,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', g.name, 'color', g.color, 'emoji', g.emoji,
               'reveal_media_id', g.reveal_media_id)
             order by g.sort_order)
      from public.groups g where g.room_id = p_room_id), '[]'::jsonb)
  );

  insert into public.room_templates (host_id, name, config)
  values (v_room.host_id, v_name, v_config)
  on conflict (host_id, name) do update
    set config = excluded.config, updated_at = now()
  returning * into v_template;
  return v_template;
end $$;


-- ---------------------------------------------------------------------
-- Load a template into a room the caller hosts. Replaces the room's
-- groups (members of removed groups become unassigned, or are reassigned
-- in random mode). Leaves the room title alone.
-- ---------------------------------------------------------------------
create or replace function public.apply_room_template(p_room_id uuid, p_template_id uuid)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  v_room      public.rooms;
  v_config    jsonb;
  v_media_ok  boolean;
  v_groups_ok boolean;
  v_groups    jsonb;
  v_intro     uuid;
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

  return public.set_display_options(
    p_room_id,
    coalesce((v_config->>'display_scores')::boolean, false),
    coalesce((v_config->>'display_qr')::boolean, false));
end $$;


-- ---------------------------------------------------------------------
-- create_room gains an optional template. The old body is kept as an
-- internal function rather than copied.
-- ---------------------------------------------------------------------
alter function public.create_room(text) rename to create_blank_room;
revoke execute on function public.create_blank_room(text) from public, anon, authenticated;

create or replace function public.create_room(p_title text default null, p_template_id uuid default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  v_room := public.create_blank_room(p_title);
  if p_template_id is not null then
    v_room := public.apply_room_template(v_room.id, p_template_id);
  end if;
  return v_room;
end $$;


create or replace function public.rename_room_template(p_template_id uuid, p_name text)
returns public.room_templates language plpgsql security definer set search_path = '' as $$
declare
  v_name     text := trim(p_name);
  v_template public.room_templates;
begin
  if v_name is null or char_length(v_name) not between 1 and 60 then
    raise exception 'invalid_template_name';
  end if;
  update public.room_templates set name = v_name, updated_at = now()
  where id = p_template_id and host_id = auth.uid()
  returning * into v_template;
  if not found then raise exception 'template_not_found'; end if;
  return v_template;
exception when unique_violation then
  raise exception 'duplicate_template_name';
end $$;


create or replace function public.delete_room_template(p_template_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.room_templates where id = p_template_id and host_id = auth.uid();
  if not found then raise exception 'template_not_found'; end if;
end $$;


revoke execute on function
  public.save_room_template(uuid, text),
  public.apply_room_template(uuid, uuid),
  public.create_room(text, uuid),
  public.rename_room_template(uuid, text),
  public.delete_room_template(uuid)
from public, anon;

grant execute on function
  public.save_room_template(uuid, text),
  public.apply_room_template(uuid, uuid),
  public.create_room(text, uuid),
  public.rename_room_template(uuid, text),
  public.delete_room_template(uuid)
to authenticated;


-- ---------------------------------------------------------------------
-- Cleanup: also keep anonymous hosts who saved a template, so their
-- setup (and media) isn't purged between terms. Same job name, so this
-- replaces it.
-- ---------------------------------------------------------------------
select cron.schedule(
  'purge-old-anon-users',
  '30 4 * * *',
  $$ delete from auth.users u
     where u.is_anonymous
       and u.created_at < now() - interval '30 days'
       and not exists (select 1 from public.hosts h
                       where h.id = u.id and h.plan <> 'free')
       and not exists (select 1 from public.rooms r
                       where r.host_id = u.id and r.created_at > now() - interval '30 days')
       and not exists (select 1 from public.screens s
                       where s.user_id = u.id and s.host_id is not null)
       and not exists (select 1 from public.room_templates t
                       where t.host_id = u.id) $$
);

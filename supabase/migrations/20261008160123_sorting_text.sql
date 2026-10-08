-- =====================================================================
-- Editable sorting message: the text on students' phones while they're
-- being sorted into a group. null = the app's default
-- ("Assigning your {group_noun}…").
-- =====================================================================

alter table public.rooms
  add column sorting_text text check (char_length(sorting_text) between 1 and 80);


-- Host: set the message, or clear it (null / blank) to use the default.
create or replace function public.set_sorting_text(p_room_id uuid, p_text text default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_text text := nullif(trim(p_text), '');
begin
  v_room := public.lock_hosted_room(p_room_id);
  if v_text is not null then
    perform public.require_room_feature(p_room_id, 'groups');
    if char_length(v_text) > 80 then raise exception 'invalid_sorting_text'; end if;
  end if;

  update public.rooms set sorting_text = v_text
  where id = p_room_id returning * into v_room;
  return v_room;
end $$;

revoke execute on function public.set_sorting_text(uuid, text) from public, anon;
grant execute on function public.set_sorting_text(uuid, text) to authenticated;


-- Same as before, plus sorting_text.
create or replace function public.get_join_info(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_room   public.rooms;
  v_on     boolean;
  v_bucket constant text := 'buzzer-bucket';
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_room from public.rooms
  where code = upper(trim(p_code)) and expires_at > now();
  if not found then raise exception 'room_not_found'; end if;

  v_on := v_room.groups_mode <> 'off';

  return jsonb_build_object(
    'room_id', v_room.id,
    'title', v_room.title,
    'groups_mode', v_room.groups_mode,
    'group_noun', v_room.group_noun,
    'group_noun_plural', v_room.group_noun_plural,
    'sorting_text', v_room.sorting_text,
    'groups', case when v_on then coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', g.id, 'name', g.name, 'color', g.color, 'emoji', g.emoji,
          'reveal_media', case when m.id is not null
            then jsonb_build_object('path', m.storage_path, 'kind', m.kind) end)
        order by g.sort_order, g.created_at)
      from public.groups g
      left join public.media_assets m on m.id = g.reveal_media_id
      where g.room_id = v_room.id), '[]'::jsonb)
      else '[]'::jsonb end,
    'intro_media', case when v_on then (
      select jsonb_build_object('path', m.storage_path, 'kind', m.kind)
      from public.media_assets m where m.id = v_room.reveal_intro_media_id) end,
    'media_bucket', v_bucket,
    'is_full', (select count(*) from public.participants where room_id = v_room.id)
               >= v_room.max_participants
  );
end $$;

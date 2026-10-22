-- =====================================================================
-- Free rooms hold 50 people, and creating a room needs a captcha.
--
-- Students and hosts both sign in anonymously, so Supabase's own captcha
-- (which covers every sign-in) would make students solve one too. Instead
-- the app's server verifies a Turnstile token and signs a ticket:
--   <user id>.<expiry, unix seconds>.<nonce>.<hex HMAC-SHA256 of the rest>
-- create_room checks it against the secret in Vault and burns the nonce.
--
-- Turn it on with the same random value in Vault and ROOM_TICKET_SECRET:
--   select vault.create_secret('<random>', 'room_ticket_secret');
-- Without the Vault secret, rooms need no ticket (self-hosting default).
-- =====================================================================

update public.plans set max_participants = 50 where id = 'free';

create table public.used_room_tickets (
  nonce   text        primary key,
  used_at timestamptz not null default now()
);
alter table public.used_room_tickets enable row level security;  -- no policies: functions only

drop function public.create_room(text, uuid, boolean);

create function public.create_room(
  p_title       text    default null,
  p_template_id uuid    default null,
  p_replace     boolean default false,
  p_ticket      text    default null
)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  v_room   public.rooms;
  v_secret text;
  v_parts  text[];
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'room_ticket_secret';

  if v_secret is not null then
    v_parts := string_to_array(coalesce(p_ticket, ''), '.');
    if cardinality(v_parts) <> 4
       or v_parts[1] is distinct from auth.uid()::text
       or v_parts[2] !~ '^\d{1,12}$'
       or to_timestamp(v_parts[2]::bigint) < now()
       or v_parts[4] is distinct from encode(
            extensions.hmac(v_parts[1] || '.' || v_parts[2] || '.' || v_parts[3], v_secret, 'sha256'), 'hex')
    then
      raise exception 'captcha_required';
    end if;

    -- Tickets last 5 minutes, so older nonces can't be replayed anyway.
    delete from public.used_room_tickets where used_at < now() - interval '1 hour';
    begin
      insert into public.used_room_tickets (nonce) values (v_parts[3]);
    exception when unique_violation then
      raise exception 'captcha_required';
    end;
  end if;

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

revoke execute on function public.create_room(text, uuid, boolean, text) from public, anon;
grant execute on function public.create_room(text, uuid, boolean, text) to authenticated;

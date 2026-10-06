-- =====================================================================
-- Cleanup jobs (PLAN.md Phase 3). Enables pg_cron and schedules the two
-- jobs described at the bottom of 20261005_buzzer_schema.sql.
--
-- cron.schedule() replaces a job with the same name, so re-running this
-- file is safe. To see runs:
--   select * from cron.job_run_details order by start_time desc limit 20;
-- To turn a job off:
--   select cron.unschedule('purge-expired-rooms');
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;

-- Daily at 04:00 UTC: delete rooms that expired more than 7 days ago.
-- Participants, rounds and buzzes cascade.
select cron.schedule(
  'purge-expired-rooms',
  '0 4 * * *',
  $$ delete from public.rooms where expires_at < now() - interval '7 days' $$
);

-- Daily at 04:30 UTC: Supabase doesn't delete anonymous users, so remove
-- ones older than 30 days unless they're paying hosts. Their rooms and
-- participant rows cascade. A browser whose stored session belonged to a
-- deleted user signs in again automatically (see ensureSession()).
select cron.schedule(
  'purge-old-anon-users',
  '30 4 * * *',
  $$ delete from auth.users u
     where u.is_anonymous
       and u.created_at < now() - interval '30 days'
       and not exists (select 1 from public.hosts h
                       where h.id = u.id and h.plan <> 'free') $$
);

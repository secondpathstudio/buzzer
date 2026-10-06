# Buzzer

An open-source, real-time buzzer for live lectures. The host shows a QR code, students scan it and join with no login, and the host sees who buzzed first.

Built with Next.js, Tailwind and Supabase (Postgres, Anonymous Sign-ins, Realtime). Free to self-host on Supabase Free + Vercel Hobby.

## Local development

No Docker needed: development runs against a hosted Supabase project.

1. Create a free project at [supabase.com](https://supabase.com).
2. Install dependencies and configure environment variables:
   ```sh
   npm install
   cp .env.example .env.local   # fill in the URL and publishable key
   ```
3. Apply the schema:
   ```sh
   npx supabase login
   npm run db:link    # pick your project
   npm run db:push    # applies supabase/migrations/
   npm run db:types   # regenerates src/lib/database.types.ts
   ```
   Alternatively, paste `supabase/migrations/20261005_buzzer_schema.sql` into the Supabase SQL Editor.
4. In the dashboard, under **Authentication → Sign In / Providers**, enable **Anonymous Sign-ins**.
5. `npm run dev` and open http://localhost:3000.

To test with phones on the same wifi, set `NEXT_PUBLIC_SITE_URL` to your machine's LAN address (e.g. `http://192.168.1.20:3000`) so the QR code points somewhere reachable. `next.config.ts` allows this machine's LAN addresses as dev origins automatically; Next.js blocks other non-localhost origins in development, and the page hangs.

## Self-hosting

1. Create a free Supabase project.
2. Apply the migration (`npm run db:link && npm run db:push`, or paste it into the SQL Editor).
3. **Authentication → Sign In / Providers:** enable **Anonymous Sign-ins**.
4. **Authentication → Rate Limits:** raise the anonymous sign-in limit. The default is 30 per hour *per IP*, and a lecture hall on campus wifi often shares one public IP. Set it to several hundred per hour before your first class.
5. Deploy to Vercel Hobby with the variables from `.env.example`. Set `NEXT_PUBLIC_SITE_URL` to the deployed URL, and use the same URL as the **Site URL** in Supabase Auth settings.
6. Free-tier limits:
   - About 190 students per room (Supabase Free allows 200 realtime connections per project).
   - Free projects pause after 7 days of inactivity. Restore yours from the dashboard before class.
7. Optional: enable `pg_cron` and turn on the cleanup jobs at the bottom of the migration. Supabase does not delete anonymous users automatically.

### Changing the participant cap

```sql
update public.plans set max_participants = 100 where id = 'free';
```

Existing rooms keep the cap they were created with.

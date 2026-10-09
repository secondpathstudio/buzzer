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
   Alternatively, paste each file in `supabase/migrations/` into the Supabase SQL Editor, in filename order.
4. In the dashboard, under **Authentication → Sign In / Providers**, enable **Anonymous Sign-ins**.
5. `npm run dev` and open http://localhost:3000.

To test with phones on the same wifi, set `NEXT_PUBLIC_SITE_URL` to your machine's LAN address (e.g. `http://192.168.1.20:3000`) so the QR code points somewhere reachable. `next.config.ts` allows this machine's LAN addresses as dev origins automatically; Next.js blocks other non-localhost origins in development, and the page hangs.

## Self-hosting

1. Create a free Supabase project.
2. Apply the migrations (`npm run db:link && npm run db:push`, or paste each file in `supabase/migrations/` into the SQL Editor, in filename order).
3. **Authentication → Sign In / Providers:** enable **Anonymous Sign-ins**.
4. **Authentication → Rate Limits:** raise the anonymous sign-in limit. The default is 30 per hour *per IP*, and a lecture hall on campus wifi often shares one public IP. Set it to several hundred per hour before your first class.
5. Deploy to Vercel Hobby with the variables from `.env.example`. Set `NEXT_PUBLIC_SITE_URL` to the deployed URL, and use the same URL as the **Site URL** in Supabase Auth settings.
6. Free-tier limits:
   - About 190 students per room (Supabase Free allows 200 realtime connections per project).
   - Free projects pause after 7 days of inactivity. Restore yours from the dashboard before class.
7. Cleanup runs automatically: the second migration enables `pg_cron` and schedules two daily jobs (04:00 and 04:30 UTC). One deletes rooms 7 days after they expire. The other deletes anonymous users older than 30 days, since Supabase doesn't do this itself. Check runs with `select * from cron.job_run_details order by start_time desc limit 20;`.

### Changing the participant cap

```sql
update public.plans set max_participants = 100 where id = 'free';
```

Existing rooms keep the cap they were created with.

## Groups & Points

Both are optional and off by default. Turn them on under **Room options** at the bottom of the host panel. Set up groups **before** showing the QR code.

### Groups

- **Random & even:** each student is sorted into a group as they join, keeping group sizes within one of each other. Their phone plays a short reveal ("Assigning your group…", then the group name), or your own clip (see [Custom reveal media](#custom-reveal-media)).
- **Students choose:** students pick a group on the join screen.
- **Called (one / many)** renames "Group / Groups" everywhere, e.g. "House / Houses" or "Table / Tables". You can also change the message shown while students are sorted.
- Edit each group's name, colour and optional emoji; reorder or delete groups. You need 2–12 groups.
- **Apply a preset** loads a built-in set (2 Teams, 4 Teams) or one of yours. **Save as my preset** stores the current setup, including any reveal clips, in this browser for your next room.
- Once students have joined, the participant list is grouped by colour. Use **Move to…** on a student to change their group, or **🔀 Shuffle** to re-sort everyone at random. Deleting a group in random mode re-sorts its members into the others.
- Students see their group chip and colour on the buzzer screen. The display shows group counts under the QR code and the winner's group next to their name.

### Points

- Set the **Quick-award amounts** (e.g. 1 / 5 / 10). Each buzz in the live ranking gets one-tap buttons for each amount, both as awards and deductions (−10 −5 −1 +1 +5 +10).
- Points go to the student **and** to the group they're in at that moment. Moving a student later doesn't move their past points.
- **↶ Undo last** removes the most recent award. **Reset points** (in Room options) sets every score in the room back to zero and can't be undone.
- The host sees the full scoreboard. The display shows group totals and the top students (or the top 10 students when groups are off). Each student sees only their own total and their group's.

### Display keys

| Key | Action |
|---|---|
| `Space` / `→` / `PageDown` | Open, lock, then start the next round (works with a presentation clicker) |
| `R` | Reset (new round) |
| `L` | Lock the round |
| `Q` | Show or hide the QR code |
| `F` | Fullscreen |
| `M` | Mute or unmute the buzz sound |
| `S` | Toggle the scoreboard (points on) |
| `A` / `D` | Award / deduct the first quick-award amount for this round's winner (points on) |
| `Z` | Undo the last points (points on) |

### Feature gating (for hosted deployments)

Groups, points and custom reveal media are gated in the database, so a hosted service could charge for them. Self-hosted installs have everything enabled: the migration gives every plan every feature.

To restrict them on the free plan:

```sql
delete from public.plan_features where plan_id = 'free'
  and feature_key in ('groups', 'points', 'custom_media');
```

A row in `room_feature_grants` unlocks a feature for a single room, e.g. after a one-off purchase. The host panel shows locked features as unavailable. With `NEXT_PUBLIC_BILLING_ENABLED=true` it says they're on paid plans; there is no checkout yet.

## Custom reveal media

With **Groups** on in random mode, each phone can play your own clip for the group it was sorted into (e.g. a character deliberating, then announcing "Red!"). The clip *is* the sorting moment: the phone shows "Assigning your group…" only while the clip loads, then plays it. Set it up under **Room options → Groups → Custom reveal (optional)**: choose or upload a clip for each group, and use **Preview reveal** to check it in a phone-sized frame. Any empty slot falls back to the built-in text reveal. **Save as my preset** remembers the chosen clips for your next room. In choose mode, the clip plays as a confirmation of the student's pick.

Files go into the `buzzer-bucket` storage bucket (created by the `groups_points` migration; public read, upload limit 8 MB). Each phone downloads only its own group's clip.

**Making clips**
- Short **MP4 (H.264)**, about 5–8 seconds, 720p portrait (720×1280) or square (720×720), no audio needed: usually **1–2 MB**. Images (PNG, JPG, WebP, GIF) work too.
- Bake the background into the video. Transparent video isn't consistent across phone browsers.
- Phones play the clips muted (browsers only autoplay muted video). Students can tap 🔊 to turn sound on.
- Convert GIFs to MP4, which is often 5–10× smaller:
  ```sh
  ffmpeg -i in.gif -movflags +faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" out.mp4
  ```
- Shrink any video (`+faststart` lets playback begin before the whole file downloads):
  ```sh
  ffmpeg -i in.mov -vf "scale=720:-2" -c:v libx264 -crf 28 -preset slow -an -movflags +faststart out.mp4
  ```

**Bandwidth:** at about 2 MB per student, 150 students is about 300 MB per session, well within Supabase Free's monthly egress for one instructor.

**Fallbacks:** if a group clip hasn't loaded within 6 seconds, or the phone has reduced motion or data saver on, the student gets the built-in text reveal instead. A join never waits on media.

**To change the size limit**, update the bucket (Storage → `buzzer-bucket` → settings) and set `NEXT_PUBLIC_MEDIA_MAX_MB` to match.

Upload third-party or franchise media only to your own instance. **Never commit it to the repo.**

**Known limitations:** the media library belongs to the host's browser session (anonymous), so clearing browser data loses access to it. When the cleanup job deletes old anonymous hosts, their library entries go but the files stay in the bucket.

## License

[MIT](LICENSE)

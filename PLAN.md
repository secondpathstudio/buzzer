# Buzzer — Project Plan

An open-source, real-time buzzer for live lectures. The host shows a QR code, students scan it and join with no login, and the host sees who buzzed first, then resets for the next round.

> **For Claude Code:** this file is the source of truth for scope and architecture. The database schema is in `supabase/migrations/20261005_buzzer_schema.sql`. It has been tested and should not be redesigned without a reason.
>
> **Current scope: Phases 0–3 only.** The goal right now is a working, self-hosted buzzer the author can use in their own lectures and share on GitHub. Phase 4 (hosted platform and payments) and Phase 5 (ideas) are documented for later. **Do not build them unless asked.** Work through the phases in order and check off acceptance criteria as you go.

---

## 1. Goals and non-goals

**Goals (now)**
- Host creates a room in one tap, with no account required.
- Students join by scanning a QR code and typing a display name, with no login.
- The server determines buzz order (never client clocks).
- The host sees the ranked buzz list live and can reset to reopen.
- A projector-friendly display mode shows the winner.
- Anyone can deploy their own copy for free from the GitHub repo (Supabase Free + Vercel Hobby).

**Non-goals (now)**
- Payments, plans, or a public hosted service (see Phase 4)
- Saved history across sessions
- Q&A, quizzes, scoring, teams
- Student accounts, native apps

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Realtime pages are client components |
| Styling | Tailwind CSS | Large touch targets, high-contrast display mode |
| Backend | Supabase | Postgres, Anonymous Sign-ins, Realtime, RLS |
| Supabase client | `@supabase/supabase-js` + `@supabase/ssr` | |
| QR codes | `qrcode.react` | |
| Bot protection (Phase 3) | Cloudflare Turnstile | Passed as `captchaToken` to anonymous sign-in |
| Hosting | Vercel Hobby (personal use) | Fine for self-hosting; a paid/public service would need Vercel Pro or Cloudflare |
| Dev database | Hosted Supabase project (no Docker) | Supabase CLI via `npx`: `supabase link` + `supabase db push` |

---

## 3. Routes

| Route | Who | Purpose |
|---|---|---|
| `/` | Anyone | Landing page with a **Create room** button |
| `/host/[code]` | Host only | Control panel: QR code, participants, Open / Lock / Reset, live ranking |
| `/display/[code]` | Host only (same browser session) | Full-screen projector view with keyboard and clicker controls |
| `/r/[code]` | Students | Join form, then the buzzer button |

The **database** enforces host-only access, not the URL. Host functions check `auth.uid() = rooms.host_id`. A student who opens `/host/CODE` should see a "You're not the host of this room" screen. Any host action they attempt fails with `not_host`.

---

## 4. User flows

**Host**
1. Visits `/`, taps **Create room**.
2. The client calls `ensureSession()` (anonymous sign-in if no session), then `rpc('create_room', { p_title })`.
3. Redirect to `/host/[code]`. Show the QR code for `${NEXT_PUBLIC_SITE_URL}/r/${code}` and the code in large text.
4. Optionally open `/display/[code]` on the projector screen.
5. **Open:** `rpc('open_round', { p_room_id })`
6. Watch buzzes arrive live, ranked 1, 2, 3 with time gaps.
7. **Reset:** `rpc('reset_round', { p_room_id })` locks the current round and opens a new one.
8. **Lock** (optional): `rpc('lock_round', { p_room_id })` stops buzzes without resetting.

**Student**
1. Scans the QR code and lands on `/r/[code]`.
2. `ensureSession()` signs them in anonymously in the background.
3. Enters a display name, then `rpc('join_room', { p_code, p_display_name })`.
4. Sees the buzzer button in one of four states:
   - **Waiting:** grey, "Get ready…"
   - **Open:** bright and pulsing, tap to buzz
   - **Buzzed:** "You were #2"
   - **Locked:** "Round closed"
5. Tapping calls `rpc('buzz', { p_round_id })`, which returns their position. Disable the button immediately to prevent spam taps. Double taps are harmless server-side anyway. Use `navigator.vibrate(50)` where supported.

---

## 5. Data model (summary)

The full SQL is in `supabase/migrations/20261005_buzzer_schema.sql`.

| Table | Key columns | Notes |
|---|---|---|
| `plans` | `id`, `max_participants`, `max_active_rooms` | Self-hosted default: `free` = 190 participants (Supabase Free allows 200 realtime connections). Change with one `UPDATE`. |
| `hosts` | `id → auth.users`, `plan`, `plan_expires_at`, `payment_customer_id` | Created automatically on first `create_room`. Payment columns stay unused until Phase 4. |
| `rooms` | `code` (6 chars), `host_id`, `title`, `max_participants`, `current_round_id`, `expires_at` (24h) | Cap copied from plan at creation |
| `participants` | `room_id`, `user_id`, `display_name` | `unique(room_id, user_id)`, so refreshes don't use a slot |
| `rounds` | `room_id`, `number`, `status` (`waiting`/`open`/`locked`), `winner_id` | Reset creates a new round |
| `buzzes` | `round_id`, `participant_id`, `position`, `buzzed_at` | `position` is assigned under a row lock; one buzz per student per round |
| `purchases` | | Unused until Phase 4 |

### Database rules (don't break these)
- **Clients only read tables.** There are no insert, update or delete RLS policies. Every write goes through a `SECURITY DEFINER` function.
- **Anonymous users have the `authenticated` role.** Policies must check room membership or host ownership, never just "is logged in".
- **Fairness:** `buzz()` locks the round row *before* timestamping, so `position` order equals `buzzed_at` order. Order is server arrival order. Wifi jitter of tens of milliseconds is acceptable for now (see Phase 5 for delay correction).
- **Caps:** `join_room()` locks the room row before counting, so concurrent joins can't exceed `max_participants`.

### RPC contract

| Function | Caller | Args | Returns |
|---|---|---|---|
| `create_room` | Host | `p_title?: string` | `rooms` row |
| `join_room` | Student | `p_code: string, p_display_name: string` | `participants` row |
| `buzz` | Student | `p_round_id: uuid` | `int` position (1 = first) |
| `open_round` | Host | `p_room_id: uuid` | `rounds` row |
| `lock_round` | Host | `p_room_id: uuid` | `rounds` row |
| `reset_round` | Host | `p_room_id: uuid, p_open?: boolean = true` | new `rounds` row |
| `remove_participant` | Host | `p_participant_id: uuid` | void |

### Error codes → UI messages

| Error | Message |
|---|---|
| `room_full` | "This room is full (limit: N)." The limit is in the error hint. |
| `room_not_found` | "Room not found or expired. Check the code." |
| `round_not_open` | Show "Round closed". Usually a race; just refresh state. |
| `not_host` | "Only the host can do that." |
| `not_a_participant` | Send the student back to the join form |
| `too_many_active_rooms` | "You already have an active room…" Hosts get one active room (`plans.max_active_rooms`); creating a new one from `/` ends the current one (`create_room(p_replace => true)`). |
| `invalid_name` | "Name must be 1–40 characters." |

Generate types with `npm run db:types` (`supabase gen types typescript --linked`).

---

## 6. Realtime

Use **Postgres Changes**, which respects RLS. The migration adds `rooms`, `rounds`, `buzzes` and `participants` to the `supabase_realtime` publication.

| Page | Subscribes to |
|---|---|
| Host and Display | `rooms` (id = room) for `current_round_id` changes; `rounds` (room_id = room); `buzzes` (round_id = current round); `participants` (room_id = room) |
| Student | `rooms` (id = room); `rounds` (room_id = room) |

Implementation notes:
- Postgres Changes allows one filter per subscription. When `current_round_id` changes, unsubscribe from the old `buzzes` channel and subscribe with the new `round_id`.
- **Always refetch full state** on subscribe, on reconnect, and on `visibilitychange`, because phones sleep. Treat realtime events as "something changed" hints, not the only source of truth.
- Compute time gaps on the display from server `buzzed_at` values (e.g. "+0.14s"), never from client time.

---

## 7. Display mode (`/display/[code]`)

This is a full-screen, dark, high-contrast page with very large type, designed to be readable from the back of a lecture hall.

| State | Shows |
|---|---|
| Waiting | QR code, room code, live join count ("23 joined") |
| Open | "BUZZERS OPEN" with a strong visual pulse |
| Result | Winner's name in giant text; 2nd and 3rd smaller with time gaps; total buzz count |

**Controls (keyboard and presentation clicker)**

| Key | Action |
|---|---|
| `Space`, `→`, `PageDown` | Advance: waiting → open → locked → new round (open) |
| `R` | Reset (new open round) |
| `L` | Lock |
| `F` | Toggle fullscreen |
| `Q` | Toggle the QR code overlay (for latecomers) |

Most clickers send `PageDown` or arrow keys, so the presenter can run the buzzer from the clicker.

Optional: a short sound when the first buzz arrives, with a mute toggle.

---

## 8. Self-hosting setup (also goes in the README)

1. Create a free Supabase project.
2. Apply the migration: paste it into the SQL Editor, or run `supabase link` then `supabase db push`.
3. **Auth → Providers:** enable **Anonymous Sign-ins**.
4. **Auth → Rate Limits:** raise the anonymous sign-in limit. The default is 30 per hour *per IP*. A lecture hall on campus wifi often shares one public IP, so set this to several hundred per hour before the first real class.
5. Deploy the Next.js app to Vercel Hobby with the environment variables below. Set `NEXT_PUBLIC_SITE_URL` to the deployed URL, and set the same URL as the Site URL in Supabase Auth settings.
6. **Free-tier limits to know:**
   - About 190 students per room (200 realtime connections per project).
   - Free projects pause after 7 days of inactivity. If a project is paused, restore it from the Supabase dashboard before class.
7. Cleanup: the `cleanup_cron` migration enables `pg_cron` and schedules the purge jobs. Supabase does not auto-delete anonymous users.

### Environment variables (`.env.example`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # or anon key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Phase 3
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

---

## 9. Phases and acceptance criteria

### Phase 0: Setup  ← start here
- [x] Next.js (App Router, TS, Tailwind) scaffolded
- [x] Supabase CLI initialised; migration in `supabase/migrations/`; `npm run db:push` applies it cleanly to the hosted dev project
- [x] Types generated; `src/lib/supabase/` with browser and server clients
- [x] `ensureSession()` helper: returns the existing session or calls `signInAnonymously()`
- [x] `.env.example`, README with local setup and the self-hosting steps from section 8

### Phase 1: Core buzzer
- [x] `/`: Create room → redirects to `/host/[code]`
- [x] `/host/[code]`: QR code, code, participant list, Open / Lock / Reset, live ranked buzz list
- [x] `/r/[code]`: join form → buzzer with the four states
- [x] Non-host visiting `/host/[code]` sees a friendly "not the host" screen
- **Done when:** with one host browser and three student browsers (incognito windows), the host opens a round, students buzz, the host sees the correct order within about 1 second, Reset re-arms every student button, and refreshing a student tab keeps them in the room.

### Phase 2: Display mode
- [x] `/display/[code]` with the three states and keyboard/clicker controls
- [x] "Open display mode" link from the host panel
- **Done when:** the whole round cycle can be run from the keyboard alone, and the winner is readable at full screen from across a room.

### Phase 3: Hardening and first real class
- [ ] Turnstile on anonymous sign-in
- [x] Error states for every error code in section 5
- [x] Reconnect and refetch on `visibilitychange`; offline banner
- [x] Host can remove a participant
- [x] Cleanup cron jobs enabled (`supabase/migrations/20261006050325_cleanup_cron.sql`)
- [ ] Tests: SQL function tests (pgTAP or a SQL script); a Playwright test with 1 host and N student browser contexts
- [ ] Deployed to Vercel + Supabase Free following section 8
- **Done when:** the app has been used in a real lecture, a 30+ student run works reliably, and someone else could deploy their own copy from the README alone.

---

## 10. LATER — Phase 4: Hosted platform and payments (do not build yet)

Only relevant if the app is offered as a public hosted service. Self-hosters never need this.

### Pricing model
Avoid single $0.99–$1.99 charges: fixed payment fees take a large share, and cheap checkouts attract card-testing fraud. Instead:

| Product | Example price (placeholder) | What it does |
|---|---|---|
| Free | $0 | Rooms capped at 30–50 participants (set via `plans`) |
| Credit pack | $4.99 for 5 credits | 1 credit = upgrade one room to a large cap (e.g. 300) |
| Semester pass | $9.99 per semester | Large rooms + saved history until the pass expires (~6 months) |
| Event pass | $4.99–$9.99 | One large room for a conference or guest lecture |
| Department license | Invoiced annually | Later, if there is demand |
| Tip jar / GitHub Sponsors | Any amount | For the open-source side |

**What you keep per sale** (Stripe: 2.9% + 30¢; merchant of record such as Paddle, Lemon Squeezy or Polar: about 5% + 50¢, but they handle sales tax and VAT):

| Price | Stripe | Merchant of record |
|---|---|---|
| $0.99 | $0.66 | $0.44 |
| $1.99 | $1.63 | $1.39 |
| $4.99 | $4.54 | $4.24 |
| $9.99 | $9.40 | $8.99 |

Other things to know:
- A chargeback costs $15, and Stripe keeps its fee when you refund.
- Break-even on about $45/month of hosting (Supabase Pro + Vercel Pro) is about 10 sales/month at $4.99.

### Schema additions (future migration, not in the current file)
```
credit_ledger
  id           uuid pk
  host_id      uuid → hosts
  delta        int            -- +5 purchase, -1 room upgrade, -n refund
  reason       text           -- 'purchase' | 'room_upgrade' | 'refund' | 'grant'
  purchase_id  uuid → purchases (nullable)
  room_id      uuid → rooms (nullable)
  created_at   timestamptz
  -- balance = sum(delta) per host; never store a mutable balance

rooms (+ columns)
  upgraded_at    timestamptz   -- set when a credit/pass raised the cap
  retain_until   timestamptz   -- saved history: keep rounds/buzzes until this date

New functions
  upgrade_room(p_room_id)  -- host-only; locks host's ledger, checks balance >= 1,
                           -- inserts -1, sets rooms.max_participants to the large cap
  export_room(p_room_id)   -- host-only; returns rounds + buzzes for CSV download
```
- **Semester pass:** reuses `hosts.plan = 'pro'` with `plan_expires_at` set to about 6 months out.
- **Webhook route** (`/api/webhooks/payments`): server only, uses the service role key, verifies the signature, and is idempotent via `purchases.provider_ref`.

### Phase 4 checklist
- [ ] Host links an email (convert anonymous user to permanent) before checkout
- [ ] Pricing page; checkout for credit packs, semester pass, event pass
- [ ] Webhook writes `purchases` + `credit_ledger` / `hosts.plan`
- [ ] "Upgrade this room" button on the host panel when a room is full
- [ ] Saved history + CSV export for paid rooms
- [ ] Set the hosted free cap: `update plans set max_participants = 30 where id = 'free'`
- [ ] Move hosting off Vercel Hobby (commercial use)
- [ ] Privacy policy (see below)

### Privacy (before launching saved history)
Storing student names tied to performance over time may make the data education records (FERPA, US) or personal data (GDPR, EU). To reduce risk:
- Keep display names only.
- Auto-delete after `retain_until`.
- Let hosts delete their data.
- Publish a short privacy policy.
- Get proper advice before launch.

---

## 11. LATER — Phase 5: Ideas

- **Delay correction:** estimate each client's network delay (ping round-trips) and adjust buzz order, so students on weak cell signal aren't disadvantaged. BuzzIn.live does this.
- Broadcast-from-database instead of Postgres Changes (cheaper fan-out at scale)
- Token-based student join (no Supabase Auth for students), which removes per-user costs and the IP rate limit
- Persistent rooms for recurring courses
- Phone as remote control (pairing link)
- Teams, sounds and themes

---

## 12. Prior art

Buzzers exist, mostly for trivia and quiz bowl. This project's niche is lectures: QR join, large rooms, a clicker-driven projector view, and being free to self-host.

| Project | Notes |
|---|---|
| BuzzIn.live | Hosted; quiz bowl standard; network-delay correction |
| Crowd Buzzer, Cosmobuzz | Hosted; simple classroom/game buzzers |
| TriviaMaker Buzz Mode, QuizWhizzer | Buzzers inside quiz platforms; free tiers around 20–30 players |
| bufferapp/buzzer | Open source (MIT), Node + websockets, archived 2024 |
| Multibuzzer | Open source, React + boardgame.io |

---

## 13. Costs

**Self-hosted (current plan):** $0 on Supabase Free + Vercel Hobby, within the limits in section 8.

**Hosted platform (Phase 4, later):** about $45/month baseline (Supabase Pro $25 + Vercel Pro $20). Prices were checked in October 2026; verify on supabase.com/pricing and vercel.com/pricing.

| Supabase Pro | Included | Overage |
|---|---|---|
| Peak realtime connections | 500 | $10 per 1,000 |
| Realtime messages | 5M / month | $2.50 per million |
| Monthly active users (anonymous students count) | 100K | $0.00325 each |

**Hosted free-cap comparison.** This is worst case: every room full, weekly classes, 5% of rooms live at the busiest hour.

| Weekly free rooms | Cap 30 | Cap 50 |
|---|---|---|
| 100 | ~$45 | ~$45 |
| 1,000 | ~$74 | ~$104 |
| 10,000 | ~$1,140 | ~$2,090 |

---

## 14. Open questions

- [x] License: MIT (anything goes) or AGPL (hosted forks must share changes) → **MIT**
- [ ] Should the host be allowed to join their own room as a student? (Currently allowed, which is handy for testing.)
- [ ] Room lifetime: 24h default; is that right for lectures?
- [ ] Later: whether to offer a hosted version at all, the free cap (30 vs 50), prices, payment provider

---

## 15. Conventions for implementation

- TypeScript strict mode; generated Supabase types for every query and RPC.
- All mutations go through RPC functions; never write to tables from the client.
- Keep realtime logic in hooks (`useRoom`, `useCurrentRound`, `useBuzzes`, `useParticipants`) that refetch on reconnect.
- Mobile-first student page: one giant button, works one-handed, readable in bright rooms.
- No secrets in client code.
- Any schema change is a new migration file, not an edit to the existing one once deployed.

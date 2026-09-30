# WordBridge

Get from one word to another, one related word at a time.

You get a **start** word and a distant **target** word. Type a chain of words where each one is at least **70% related** to the previous word (an AI rates it). Reach the target — or any word 70%+ related to it — to complete the bridge. Fewer steps, stronger links, and fewer misses score higher.

Live: https://wordbridge-game.vercel.app

## Modes

- **Daily puzzle** — the same pair for everyone, new at 00:00 UTC. Signed-in players get one ranked attempt per day, a streak, and a spot on the leaderboard. Moves are validated and scored on the server.
- **Practice** — unlimited random puzzles (pairs are chosen to be under 30% related).
- **Race** — 1v1 on the same pair. Find a random opponent or create a room for a friend. You see your opponent's progress (link strengths, closeness to target, typing, misses) but not their words until the end. Rematch, "Race again" invites, and race history included.

## Stack

| Piece | Used for |
|---|---|
| [Next.js 16](https://nextjs.org) (App Router), React 19, Tailwind 4, TypeScript | App and API routes |
| [Supabase](https://supabase.com) (free tier) | Google sign-in, Postgres (profiles, daily runs, leaderboard, race history, matchmaking queue, rate limits) |
| [Ably](https://ably.com) (free tier) | Realtime race rooms and private per-player inboxes |
| [Typesafe AI](https://typesafe.ai) (`jev-latest`) | Word relatedness scoring |
| [Datamuse](https://www.datamuse.com/api/) | Word definitions |
| [Vercel](https://vercel.com) | Hosting (functions run in `hnd1`, next to the Supabase project in Tokyo) |

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` (never commit it):

   ```bash
   TYPESAFE_API_KEY=            # server only
   ABLY_API_KEY=                # server only; also signs guest cookies
   NEXT_PUBLIC_SUPABASE_URL=    # https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # sb_publishable_... (safe in the browser)
   SUPABASE_SECRET_KEY=         # sb_secret_... server only, bypasses RLS
   ```

3. Set up Supabase:
   - Run the SQL files in [`supabase/migrations/`](supabase/migrations) in order (`0001` → `0004`) in the Supabase SQL Editor.
   - **Authentication → URL Configuration:** add `http://localhost:3000/auth/callback` (and your production `/auth/callback`) to Redirect URLs.
   - **Authentication → Providers → Google:** enable it with a Google OAuth client (Web application) whose redirect URI is the Supabase callback URL shown there.

4. Run it:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

The app degrades gracefully: without Supabase keys it runs guest-only (no sign-in, leaderboard, or matchmaking); without a Typesafe key, random pairs fall back to a fixed pair and scoring fails.

## Deploying (Vercel)

- Add the five environment variables above in **Vercel → Settings → Environment Variables**. `NEXT_PUBLIC_*` values are type **Config** (public by design); the other three are **Secret**. Redeploy after changing them — `NEXT_PUBLIC_*` values are baked in at build time.
- Add the production domain to Supabase Redirect URLs and to the Google OAuth client's Authorized JavaScript origins.
- [`vercel.json`](vercel.json) pins functions to `hnd1` (Tokyo). If you move the Supabase project, move this region with it.

## Project layout

```
app/
  page.tsx                 Game UI (home, lobby, leaderboard, game views)
  components/              BridgePath, ClosenessGauge, RulesSheet, DailyLeaderboard, StatsCard, ...
  lib/                     Scoring, share text, link tiers, Supabase clients, identity, rate limits, daily logic
  api/
    compare/               Score one step (practice / race)
    daily/                 Ranked daily: puzzle, moves, give up, leaderboard
    pair/                  Random puzzle pair
    matchmaking/           Random opponent queue
    invite/                "Race again" invites
    ably/token/            Realtime tokens with a server-assigned identity
    me/stats/              Streak and totals
  auth/callback/           Google OAuth return
supabase/migrations/       Database schema (run in order)
proxy.ts                   Refreshes the Supabase session cookie (Next 16 "proxy", formerly middleware)
```

## Notes

- Paid API calls are rate limited per player (or per IP for guests) via a Postgres function.
- Realtime identity is issued by the server (Supabase user id or a signed guest cookie) and Ably stamps it on every message, so players can't impersonate each other. Race results are still reported by each client.
- API responses from `compare`, `daily`, and `daily/leaderboard` include `Server-Timing` headers for latency debugging.

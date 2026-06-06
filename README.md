# Codenames Tracker

A stat tracker for recurring [Codenames](https://czechgames.com/en/codenames/) groups. Log games, track wins and losses per player and role, and watch the leaderboard update in real time.

Built for groups that play regularly and want to settle arguments about who the best spymaster actually is.

---

## Features

- **Leaderboard** — win/loss record, win %, spymaster W-L, and current streak for every player
- **Game logging** — record who played, which side, which role (spymaster or operative), and who won
- **Recent games** — last 5 games shown with player breakdown and optional notes
- **Teams** — multi-tenant; each team is isolated behind its own invite code
- **Google sign-in** — one-click OAuth, no passwords
- **Ghost members** — add historical players who predate the tracker as "angel" profiles; enter their stats manually
- **Seed stats** — admins can enter pre-tracker win/loss records that merge into the leaderboard totals
- **Email backup** — admins can trigger a formatted stats snapshot sent to their email (rate-limited to once per hour)
- **Admin panel** — manage members, toggle active/emeritus status, manage ghost profiles

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, react-router-dom v6 |
| Backend | Supabase (Postgres + PostgREST + GoTrue Auth) |
| Auth | Google OAuth via Supabase |
| Email | Resend via a Supabase Edge Function (Deno) |
| Hosting | Vercel (frontend) + Supabase cloud (backend) |
| Local dev | Docker + Supabase CLI |

---

## Project structure

```
src/
  App.js                   # Route guard — auth and team membership gating
  App.css                  # All styles (single-file, design token driven)
  components/
    AuthProvider.js        # Session state, Google OAuth, profile fetch
  pages/
    Login.js               # Google sign-in screen
    Onboarding.js          # Create a new team or join with an invite code
    Dashboard.js           # Leaderboard + recent games
    LogGame.js             # Log a game (players, roles, winner)
    Admin.js               # Member management, seed stats, email backup
  lib/
    supabase.js            # Supabase client (reads env vars)
    stats.js               # computeStats() — pure leaderboard calculation

supabase/
  config.toml              # Local dev configuration (Supabase CLI)
  migrations/
    20260606000000_initial.sql   # Full schema — applied on db reset
  seed.sql                 # Local test data (empty by default)
  functions/
    email-stats/
      index.ts             # Edge function: compile stats and send via Resend

supabase_schema.sql        # Reference copy of the full schema
```

---

## How it works

### Data model

```
teams
  └── profiles (one per user; ghost profiles have no auth.users row)
        └── games (one per match, belongs to a team)
              └── game_players (one row per player per game)
stat_seeds (admin-entered historical totals, merged at read time)
function_rate_limits (one row per admin, tracks last email send)
```

Key design decisions:

- **`profiles.id` has no FK to `auth.users`** — ghost (angel) members are inserted with a random UUID that has no corresponding auth row, so the FK would fail.
- **RLS everywhere** — all data access is scoped to the user's team via helper functions `my_team_id()` and `i_am_admin()` (both `security definer` to avoid recursive policy evaluation).
- **`stat_seeds` merges at read time** — historical stats are not mixed into `game_players`; `computeStats()` in `src/lib/stats.js` adds seed totals to logged totals before sorting.

### Auth flow

1. User clicks "Continue with Google"
2. Supabase GoTrue redirects to Google
3. Google redirects back to `{supabase_url}/auth/v1/callback`
4. GoTrue creates an `auth.users` row and fires the `on_auth_user_created` trigger
5. Trigger inserts a `profiles` row using the Google display name
6. `AuthProvider` fetches the profile and routes the user to onboarding (if no team) or dashboard

### Leaderboard calculation

`computeStats(gamePlayers, seeds, allMembers)` in `src/lib/stats.js`:

1. Groups `game_players` rows by profile
2. Counts W/L and spymaster W/L from game entries
3. Adds seed totals on top
4. Calculates streak from the most recent consecutive results (seed streak only shown if zero real games logged)
5. Sorts: active members first by win %, then by games played; inactive members (emeritus) always at the bottom

### Email backup (edge function)

The `email-stats` Supabase Edge Function:

1. Verifies the caller is an admin (via their JWT)
2. Checks a 60-minute rate limit in `function_rate_limits` (using the service role to bypass RLS)
3. Fetches all game data and seeds, runs the same stat computation as the frontend
4. Builds an HTML email and sends it via the Resend API

---

## Local development

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [Supabase CLI](https://supabase.com/docs/guides/cli): `brew install supabase`
- Logged in: `supabase login`
- Google OAuth credentials with `http://localhost:54321/auth/v1/callback` as an authorized redirect URI

### Quick start

```bash
make setup    # copy env file templates
              # → fill in Google credentials in .env
              # → fill in anon key in .env.local after the next step

make dev      # start Supabase + React dev server
              # run `make status` in another tab to get the anon key
```

Open [http://localhost:3000](http://localhost:3000).

### All make commands

| Command | What it does |
|---|---|
| `make setup` | Copy `.env.example` files to their real locations |
| `make dev` | Start Supabase stack + React dev server (foreground) |
| `make dev-bg` | Same but detached |
| `make stop` | Stop React container + Supabase stack |
| `make reset` | Wipe local DB and re-run migrations + seed |
| `make status` | Print local URLs and JWT keys |
| `make logs` | Stream React dev server logs |
| `make functions` | Run edge functions locally with hot reload |
| `make build` | Rebuild the React Docker image from scratch |

### Getting the anon key

After `supabase start`, run:

```bash
make status
# or: supabase status --output env
```

Copy the `ANON_KEY` value into `.env.local` as `REACT_APP_SUPABASE_ANON_KEY`.

### Resetting to a clean slate

```bash
make reset   # drops all tables, re-runs migrations, runs seed.sql
```

---

## Cloud deployment

See [SETUP.md](SETUP.md) for full step-by-step instructions covering:

- Creating a Supabase project and running the schema
- Configuring Google OAuth
- Deploying the edge function and setting secrets
- Deploying to Vercel

---

## Troubleshooting

**`redirect_uri_mismatch` on Google sign-in (local)**
Make sure `http://localhost:54321/auth/v1/callback` is in your Google OAuth client's **Authorized redirect URIs**. Also ensure `http://localhost:3000` is in **Authorized JavaScript origins**.

**Blank screen / "Missing Supabase environment variables"**
Check that `.env.local` exists with both `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` filled in.

**Supabase won't start**
Docker Desktop must be running. Check with `docker info`.

**Hot reload not working**
The `CHOKIDAR_USEPOLLING=true` env var in `docker-compose.yml` handles macOS file watching. If changes still don't appear, try `make build` then `make dev`.

**Members can't see each other's stats**
They must have joined the same team (same invite code). Check Supabase Studio → Table Editor → profiles to confirm `team_id` is set.

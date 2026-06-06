# Brush Pass — Setup Guide

Two paths: **local dev** (Docker, everything on your machine) or **cloud deploy** (Supabase + Vercel).

---

## Local Development (Docker)

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`brew install supabase`)
- Logged in: `supabase login`

### Step 1 — Google OAuth credentials

The app uses Google sign-in. You need credentials even for local dev.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Add these **Authorized redirect URIs**:
   ```
   http://localhost:54321/auth/v1/callback
   ```
4. Copy the **Client ID** and **Client Secret**

### Step 2 — Create your env files

```bash
# Supabase CLI reads this on `supabase start` to configure Google OAuth
cp .env.example .env
# fill in SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID and SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET

# React app reads this at dev-server start
cp .env.local.example .env.local
# leave it as-is for now — you'll fill in the anon key in Step 4

# Edge function secrets (only needed to test email sending locally)
cp supabase/functions/.env.example supabase/functions/.env
# optionally fill in RESEND_API_KEY
```

### Step 3 — Start the local Supabase stack

```bash
supabase start
```

This pulls and starts all Supabase services in Docker (Postgres, Auth, PostgREST, Studio, etc.) and applies the migration in `supabase/migrations/`. Takes ~2 minutes the first time.

When it finishes, run this to get the JWT keys (the default output no longer shows them):

```bash
supabase status --output env
```

### Step 4 — Fill in the anon key

Copy the `ANON_KEY` value and paste it into `.env.local`:

```
REACT_APP_SUPABASE_URL=http://localhost:54321
REACT_APP_SUPABASE_ANON_KEY=eyJ...
```

### Step 5 — Start the React app

```bash
docker compose up
```

This builds the app container and starts the dev server with hot reload.
Open [http://localhost:3000](http://localhost:3000).

### Useful commands

| Command | What it does |
|---|---|
| `supabase start` | Start the local Supabase stack |
| `supabase stop` | Stop the local Supabase stack |
| `supabase db reset` | Wipe the local DB and re-run migrations + seed |
| `supabase status` | Print local URLs and keys |
| `supabase studio` | Open Supabase Studio in browser |
| `docker compose up` | Start the React dev server |
| `docker compose down` | Stop the React dev server |
| `supabase functions serve` | Run edge functions locally (hot reload) |

### Local edge function testing

To test the `email-stats` function locally:

```bash
supabase functions serve
```

The function is then available at `http://localhost:54321/functions/v1/email-stats`. Without a `RESEND_API_KEY` in `supabase/functions/.env`, it will fail at the email-send step but you can verify auth and rate-limit logic.

### Resetting to a clean slate

```bash
supabase db reset   # drops everything, re-runs migrations, runs seed.sql
```

---

## Cloud Deployment (Supabase + Vercel)

### Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Give it a name, pick a region, set a DB password

### Step 2 — Run the database schema

1. In your Supabase dashboard → **SQL Editor → New query**
2. Paste the contents of `supabase_schema.sql`
3. Click **Run**

### Step 3 — Enable Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Add this **Authorized redirect URI**:
   ```
   https://<your-project-id>.supabase.co/auth/v1/callback
   ```
4. Copy the **Client ID** and **Client Secret**
5. In Supabase → **Authentication → Providers → Google** → toggle on, paste credentials

### Step 4 — Deploy the edge function

```bash
supabase link --project-ref <your-project-ref>
supabase secrets set RESEND_API_KEY=re_...
supabase functions deploy email-stats
```

### Step 5 — Get your API keys

In Supabase → **Settings → API**, copy:
- **Project URL** (e.g. `https://abcdefgh.supabase.co`)
- **anon / public key**

### Step 6 — Deploy to Vercel

1. Push to GitHub
2. Import at [vercel.com](https://vercel.com) → **Add New → Project**
3. Add environment variables:

   | Name | Value |
   |---|---|
   | `REACT_APP_SUPABASE_URL` | your Project URL |
   | `REACT_APP_SUPABASE_ANON_KEY` | your anon key |

4. Deploy

### Step 7 — Update allowed redirect URLs

Once you have your Vercel URL (e.g. `https://brushpass.vercel.app`):

1. Supabase → **Authentication → URL Configuration**
   - Set **Site URL** to your Vercel URL
   - Add it to **Redirect URLs**
2. Google Cloud Console → add the Vercel URL to **Authorized JavaScript Origins**

---

## Troubleshooting

**`supabase start` fails** → Make sure Docker Desktop is running.

**Google login redirects to wrong URL** → Check that `http://localhost:54321/auth/v1/callback` is in your Google OAuth redirect URIs for local dev, or `https://<project>.supabase.co/auth/v1/callback` for production.

**"Missing Supabase environment variables"** → Check `.env.local` exists and has both vars filled in.

**Hot reload not working in Docker** → The `CHOKIDAR_USEPOLLING=true` env var in `docker-compose.yml` handles macOS file-watch. If it still doesn't work, try `docker compose down && docker compose up --build`.

**Members can't see each other's stats** → Verify they joined the same team (same invite code). Check Supabase Studio → Table Editor → team_members to confirm a row exists for their profile and the correct team.

**`supabase db reset` fails** → Usually a migration syntax error. Check the error output and fix `supabase/migrations/20260606000000_initial.sql`.

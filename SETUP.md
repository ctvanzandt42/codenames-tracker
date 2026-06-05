# Codenames Tracker — Setup Guide

Estimated time: **15–20 minutes**. No paid services required.

---

## Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New project**, give it a name (e.g. `codenames-tracker`), pick a region close to you, set a DB password
3. Wait ~2 minutes for it to provision

---

## Step 2 — Run the database schema

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New query**
3. Open `supabase_schema.sql` from this project and paste the entire contents
4. Click **Run** — you should see "Success" with no errors

---

## Step 3 — Enable Google OAuth (+ magic link is already on by default)

Magic link email login is enabled in Supabase by default — nothing to do.

For Google OAuth:
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
4. Application type: **Web application**
5. Under **Authorized redirect URIs**, add:
   ```
   https://<your-project-id>.supabase.co/auth/v1/callback
   ```
6. Copy the **Client ID** and **Client Secret**
7. Back in Supabase: go to **Authentication → Providers → Google**
8. Toggle it **on**, paste in your Client ID and Client Secret, save

---

## Step 4 — Get your Supabase API keys

1. In Supabase, go to **Settings → API**
2. Copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon / public key** (the long `eyJ...` string)

---

## Step 5 — Deploy to Vercel

1. Push this project to a GitHub repo (create one at github.com)
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/codenames-tracker.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com), sign up/log in with GitHub
3. Click **Add New → Project** and import your repo
4. Vercel will auto-detect it as a Create React App project
5. Before deploying, add **Environment Variables**:
   | Name | Value |
   |---|---|
   | `REACT_APP_SUPABASE_URL` | your Project URL |
   | `REACT_APP_SUPABASE_ANON_KEY` | your anon key |
6. Click **Deploy** — takes ~1 minute
7. Vercel gives you a `.vercel.app` URL

---

## Step 6 — Update allowed redirect URLs

Once you have your Vercel URL:

1. In Supabase → **Authentication → URL Configuration**
2. Set **Site URL** to your Vercel URL (e.g. `https://codenames-tracker.vercel.app`)
3. Add it to **Redirect URLs** too
4. If you set up Google OAuth: add the same URL to your Google OAuth app's **Authorized JavaScript Origins**

---

## Step 7 — First run

1. Open your `.vercel.app` URL
2. Sign in via Google or magic link
3. You'll be prompted to either **create a team** (you become admin) or **join** one with an invite code
4. As admin, go to **Admin** in the nav to see your team's invite code and share it with teammates
5. Start logging games!

---

## How it works

- **Magic link**: User enters email → gets a one-click login link (no password)
- **Google**: One-click OAuth sign-in
- **Teams**: Each team has a unique 8-character invite code; the admin shares it
- **Admin**: Can add/remove admins, remove members; any member can log games
- **Stats**: W-L, spymaster W-L, current streak, and win % — auto-calculated from game logs
- **Streaks**: Based on most recent consecutive results (e.g. W3 = won last 3 games)

---

## Local development

```bash
cp .env.example .env
# fill in your Supabase values in .env

npm install
npm start
```

---

## Troubleshooting

**"Missing Supabase environment variables"** → Make sure `.env` exists locally, or env vars are set in Vercel dashboard.

**Magic link goes to localhost instead of prod** → Update Site URL in Supabase Auth settings to your Vercel URL.

**Google login not working** → Double-check the redirect URI in Google Cloud Console matches exactly: `https://<project-id>.supabase.co/auth/v1/callback`

**Members can't see each other's stats** → Make sure they joined the same team (same invite code). Check Supabase → Table Editor → profiles to verify team_id is set.

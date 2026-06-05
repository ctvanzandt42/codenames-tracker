-- ============================================================
-- CODENAMES TRACKER — Supabase Schema (v3, fully patched)
-- Safe to run fresh. If re-running on an existing project,
-- use the DROP section at the top to clear old state first.
-- ============================================================

-- ============================================================
-- OPTIONAL CLEAN SLATE (uncomment if re-running on existing DB)
-- ============================================================
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop function if exists public.my_team_id();
-- drop function if exists public.i_am_admin();
-- drop table if exists public.game_players;
-- drop table if exists public.games;
-- drop table if exists public.profiles;
-- drop table if exists public.teams;

-- ============================================================
-- TABLES
-- ============================================================

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default upper(substring(gen_random_uuid()::text, 1, 8)),
  created_at timestamptz default now()
);

-- Extends Supabase auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  display_name text,
  is_admin boolean default false,
  created_at timestamptz default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  played_at timestamptz default now(),
  notes text,
  created_by uuid references public.profiles(id)
);

-- role: 'spymaster' | 'operative'
-- side: 'red' | 'blue'
-- won: whether this player's side won
create table public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('spymaster', 'operative')),
  side text not null check (side in ('red', 'blue')),
  won boolean not null
);

-- ============================================================
-- SECURITY DEFINER HELPERS
-- These bypass RLS when called, which prevents infinite
-- recursion in policies that need to look up the current
-- user's profile row.
-- ============================================================

create or replace function public.my_team_id()
returns uuid
language sql
stable
security definer
as $$
  select team_id from public.profiles where id = auth.uid() limit 1;
$$;

create or replace function public.i_am_admin()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(is_admin, false) from public.profiles where id = auth.uid() limit 1;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;

-- ------------------------------------------------------------
-- TEAMS
-- ------------------------------------------------------------

-- Any signed-in user can create a team (needed for onboarding)
create policy "Authenticated users can create a team"
  on public.teams for insert
  with check (auth.uid() is not null);

-- Anyone can read teams (needed to look up invite codes when joining)
create policy "Anyone can look up a team"
  on public.teams for select
  using (true);

-- Only admins can update their own team
create policy "Admins can update their team"
  on public.teams for update
  using (id = public.my_team_id() and public.i_am_admin());

-- ------------------------------------------------------------
-- PROFILES
-- ------------------------------------------------------------

-- Users can always read their own profile, plus teammates
create policy "Team members can view each other"
  on public.profiles for select
  using (
    id = auth.uid()
    or team_id = public.my_team_id()
  );

-- Auto-created by trigger on signup
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (id = auth.uid());

-- Users update their own profile; admins can update teammates
create policy "Users can update their own profile"
  on public.profiles for update
  using (
    id = auth.uid()
    or (team_id = public.my_team_id() and public.i_am_admin())
  );

-- ------------------------------------------------------------
-- GAMES
-- ------------------------------------------------------------

create policy "Team members can view games"
  on public.games for select
  using (team_id = public.my_team_id());

create policy "Team members can insert games"
  on public.games for insert
  with check (team_id = public.my_team_id());

create policy "Game creator or admin can delete games"
  on public.games for delete
  using (
    created_by = auth.uid()
    or (team_id = public.my_team_id() and public.i_am_admin())
  );

-- ------------------------------------------------------------
-- GAME PLAYERS
-- ------------------------------------------------------------

create policy "Team members can view game players"
  on public.game_players for select
  using (
    game_id in (
      select id from public.games where team_id = public.my_team_id()
    )
  );

create policy "Team members can insert game players"
  on public.game_players for insert
  with check (
    game_id in (
      select id from public.games where team_id = public.my_team_id()
    )
  );

-- ============================================================
-- TRIGGER: auto-create profile row on signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
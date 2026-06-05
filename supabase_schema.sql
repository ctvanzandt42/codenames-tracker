-- ============================================================
-- CODENAMES TRACKER — Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- TEAMS
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default upper(substring(gen_random_uuid()::text, 1, 8)),
  created_at timestamptz default now()
);

-- PROFILES (extends Supabase auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  display_name text,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- GAMES
create table public.games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  played_at timestamptz default now(),
  notes text,
  created_by uuid references public.profiles(id)
);

-- GAME PLAYERS
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
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;

-- TEAMS: members can read their own team; admins can update
create policy "Team members can view their team"
  on public.teams for select
  using (
    id in (select team_id from public.profiles where id = auth.uid())
  );

create policy "Admins can update their team"
  on public.teams for update
  using (
    id in (select team_id from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Allow anyone to read teams by invite code (for joining)
create policy "Anyone can look up a team by invite code"
  on public.teams for select
  using (true);

-- PROFILES: users can read profiles in their team
create policy "Team members can view each other"
  on public.profiles for select
  using (
    team_id in (select team_id from public.profiles where id = auth.uid())
    or id = auth.uid()
  );

create policy "Users can update their own profile"
  on public.profiles for update
  using (id = auth.uid());

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (id = auth.uid());

-- GAMES: team members can read/write games
create policy "Team members can view games"
  on public.games for select
  using (
    team_id in (select team_id from public.profiles where id = auth.uid())
  );

create policy "Team members can insert games"
  on public.games for insert
  with check (
    team_id in (select team_id from public.profiles where id = auth.uid())
  );

create policy "Game creator or admin can delete games"
  on public.games for delete
  using (
    created_by = auth.uid()
    or team_id in (select team_id from public.profiles where id = auth.uid() and is_admin = true)
  );

-- GAME_PLAYERS: readable/writable by team members
create policy "Team members can view game players"
  on public.game_players for select
  using (
    game_id in (
      select g.id from public.games g
      join public.profiles p on p.team_id = g.team_id
      where p.id = auth.uid()
    )
  );

create policy "Team members can insert game players"
  on public.game_players for insert
  with check (
    game_id in (
      select g.id from public.games g
      join public.profiles p on p.team_id = g.team_id
      where p.id = auth.uid()
    )
  );

-- ============================================================
-- HELPER FUNCTION: auto-create profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- CODENAMES TRACKER — Supabase Schema
-- Reflects the live database as of 2026-06-06.
-- Safe to run on a fresh project. Re-running on an existing
-- project requires the DROP section below.
-- ============================================================

-- ============================================================
-- OPTIONAL CLEAN SLATE (uncomment if re-running on existing DB)
-- ============================================================
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop function if exists public.my_team_ids();
-- drop function if exists public.i_am_admin_of(uuid);
-- drop table if exists public.function_rate_limits;
-- drop table if exists public.game_players;
-- drop table if exists public.stat_seeds;
-- drop table if exists public.games;
-- drop table if exists public.team_members;
-- drop table if exists public.profiles;
-- drop table if exists public.teams;

-- ============================================================
-- TABLES
-- ============================================================

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  invite_code text not null unique default upper(substring(gen_random_uuid()::text, 1, 8)),
  created_at timestamptz default now()
);

-- Note: id has no FK to auth.users — ghost (angel) members use
-- randomly generated UUIDs that have no corresponding auth row.
create table public.profiles (
  id           uuid primary key,
  display_name text,
  is_angel     boolean not null default false,
  created_at   timestamptz default now()
);

-- A user can belong to multiple teams; role (is_admin, is_active) is per-team.
create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_admin   boolean not null default false,
  is_active  boolean not null default true,
  joined_at  timestamptz default now(),
  unique (team_id, profile_id)
);

create table public.games (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  played_at  timestamptz default now(),
  notes      text,
  created_by uuid references public.profiles(id)
);

-- role: 'spymaster' | 'operative'
-- side: 'red' | 'blue'
-- won: whether this player's side won
create table public.game_players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('spymaster', 'operative')),
  side       text not null check (side in ('red', 'blue')),
  won        boolean not null
);

-- Historical stat seeds entered by an admin before game logging began.
-- Merged into leaderboard totals in the application layer.
create table public.stat_seeds (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  w            integer not null default 0,
  l            integer not null default 0,
  sm_w         integer not null default 0,
  sm_l         integer not null default 0,
  streak_type  text check (streak_type in ('W', 'L')),
  streak_count integer not null default 0,
  updated_at   timestamptz default now(),
  unique (team_id, profile_id)
);

-- Tracks the last time each admin triggered the email-stats edge function.
create table public.function_rate_limits (
  profile_id    uuid primary key references public.profiles(id) on delete cascade,
  last_called_at timestamptz not null default now()
);

-- ============================================================
-- SECURITY DEFINER HELPERS
-- ============================================================

create or replace function public.my_team_ids()
returns setof uuid
language sql stable security definer as $$
  select team_id from public.team_members where profile_id = auth.uid();
$$;

create or replace function public.i_am_admin_of(check_team_id uuid)
returns boolean
language sql stable security definer as $$
  select coalesce(
    (select is_admin from public.team_members
     where profile_id = auth.uid() and team_id = check_team_id limit 1),
    false
  );
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.teams              enable row level security;
alter table public.profiles           enable row level security;
alter table public.team_members       enable row level security;
alter table public.games              enable row level security;
alter table public.game_players       enable row level security;
alter table public.stat_seeds         enable row level security;
alter table public.function_rate_limits enable row level security;

-- TEAMS

create policy "Authenticated users can create a team"
  on public.teams for insert
  with check (auth.uid() is not null);

create policy "Anyone can look up a team by invite code"
  on public.teams for select
  using (true);

create policy "Members can view their teams"
  on public.teams for select
  using (id in (select public.my_team_ids()));

create policy "Admins can update their team"
  on public.teams for update
  using (public.i_am_admin_of(id));

-- PROFILES

create policy "Members can view teammates"
  on public.profiles for select
  using (
    id = auth.uid()
    or id in (
      select tm.profile_id from public.team_members tm
      where tm.team_id in (select public.my_team_ids())
    )
  );

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (
    (id = auth.uid() and not is_angel)
    or (
      is_angel = true
      and exists (
        select 1 from public.team_members
        where profile_id = auth.uid() and is_admin = true
      )
    )
  );

create policy "Users can update their own profile or admins can update teammates"
  on public.profiles for update
  using (
    id = auth.uid()
    or exists (
      select 1 from public.team_members tm1
      join public.team_members tm2 on tm1.team_id = tm2.team_id
      where tm1.profile_id = auth.uid() and tm1.is_admin = true
        and tm2.profile_id = profiles.id
    )
  );

create policy "Admins can delete ghost profiles"
  on public.profiles for delete
  using (
    is_angel = true
    and exists (
      select 1 from public.team_members tm1
      join public.team_members tm2 on tm1.team_id = tm2.team_id
      where tm1.profile_id = auth.uid() and tm1.is_admin = true
        and tm2.profile_id = profiles.id
    )
  );

-- TEAM_MEMBERS

create policy "Members can view their team rosters"
  on public.team_members for select
  using (team_id in (select public.my_team_ids()));

create policy "Users can join a team themselves or admins can add members"
  on public.team_members for insert
  with check (
    profile_id = auth.uid()
    or public.i_am_admin_of(team_id)
  );

create policy "Admins can update team memberships"
  on public.team_members for update
  using (public.i_am_admin_of(team_id));

create policy "Members can leave or admins can remove"
  on public.team_members for delete
  using (
    profile_id = auth.uid()
    or public.i_am_admin_of(team_id)
  );

-- GAMES

create policy "Team members can view games"
  on public.games for select
  using (team_id in (select public.my_team_ids()));

create policy "Team members can insert games"
  on public.games for insert
  with check (team_id in (select public.my_team_ids()));

create policy "Game creator or admin can delete games"
  on public.games for delete
  using (
    created_by = auth.uid()
    or public.i_am_admin_of(team_id)
  );

-- GAME_PLAYERS

create policy "Team members can view game players"
  on public.game_players for select
  using (
    game_id in (
      select id from public.games where team_id in (select public.my_team_ids())
    )
  );

create policy "Team members can insert game players"
  on public.game_players for insert
  with check (
    game_id in (
      select id from public.games where team_id in (select public.my_team_ids())
    )
  );

-- STAT_SEEDS

create policy "Team members can view seeds"
  on public.stat_seeds for select
  using (team_id in (select public.my_team_ids()));

create policy "Admins can insert seeds"
  on public.stat_seeds for insert
  with check (team_id in (select public.my_team_ids()) and public.i_am_admin_of(team_id));

create policy "Admins can update seeds"
  on public.stat_seeds for update
  using (team_id in (select public.my_team_ids()) and public.i_am_admin_of(team_id));

create policy "Admins can delete seeds"
  on public.stat_seeds for delete
  using (team_id in (select public.my_team_ids()) and public.i_am_admin_of(team_id));

-- FUNCTION RATE LIMITS

create policy "Users can manage their own rate limit row"
  on public.function_rate_limits
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

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

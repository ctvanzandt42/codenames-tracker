-- ============================================================
-- Multi-team support
-- Moves team membership + role (is_admin, is_active) off profiles
-- into a new team_members join table.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New join table
-- ------------------------------------------------------------

create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_admin   boolean not null default false,
  is_active  boolean not null default true,
  joined_at  timestamptz default now(),
  unique (team_id, profile_id)
);

-- ------------------------------------------------------------
-- 2. Migrate existing memberships
-- ------------------------------------------------------------

insert into public.team_members (team_id, profile_id, is_admin, is_active, joined_at)
select team_id, id, coalesce(is_admin, false), coalesce(is_active, true), created_at
from public.profiles
where team_id is not null;

-- ------------------------------------------------------------
-- 3. Drop now-redundant columns from profiles
-- ------------------------------------------------------------

alter table public.profiles drop column team_id;
alter table public.profiles drop column is_admin;
alter table public.profiles drop column is_active;

-- ------------------------------------------------------------
-- 4. Replace helper functions
-- ------------------------------------------------------------

drop function if exists public.my_team_id();
drop function if exists public.i_am_admin();

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

-- ------------------------------------------------------------
-- 5. Enable RLS on new table
-- ------------------------------------------------------------

alter table public.team_members enable row level security;

-- ------------------------------------------------------------
-- 6. Drop all old RLS policies
-- ------------------------------------------------------------

drop policy if exists "Authenticated users can create a team"      on public.teams;
drop policy if exists "Anyone can look up a team by invite code"   on public.teams;
drop policy if exists "Team members can view their team"           on public.teams;
drop policy if exists "Admins can update their team"               on public.teams;

drop policy if exists "Team members can view each other"           on public.profiles;
drop policy if exists "Users can insert their own profile"         on public.profiles;
drop policy if exists "Users can update their own profile"         on public.profiles;
drop policy if exists "Admins can delete ghost profiles"           on public.profiles;

drop policy if exists "Team members can view games"                on public.games;
drop policy if exists "Team members can insert games"              on public.games;
drop policy if exists "Game creator or admin can delete games"     on public.games;

drop policy if exists "Team members can view game players"         on public.game_players;
drop policy if exists "Team members can insert game players"       on public.game_players;

drop policy if exists "Team members can view seeds"                on public.stat_seeds;
drop policy if exists "Admins can insert seeds"                    on public.stat_seeds;
drop policy if exists "Admins can update seeds"                    on public.stat_seeds;
drop policy if exists "Admins can delete seeds"                    on public.stat_seeds;

-- ------------------------------------------------------------
-- 7. New RLS policies
-- ------------------------------------------------------------

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

-- Initial schema for Codenames Tracker

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique default upper(substring(gen_random_uuid()::text, 1, 8)),
  created_at  timestamptz default now()
);

-- No FK to auth.users — ghost (angel) members use randomly generated UUIDs
-- that have no corresponding auth row.
create table public.profiles (
  id           uuid primary key,
  team_id      uuid references public.teams(id) on delete set null,
  display_name text,
  is_admin     boolean default false,
  is_active    boolean not null default true,
  is_angel     boolean not null default false,
  created_at   timestamptz default now()
);

create table public.games (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  played_at  timestamptz default now(),
  notes      text,
  created_by uuid references public.profiles(id)
);

create table public.game_players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('spymaster', 'operative')),
  side       text not null check (side in ('red', 'blue')),
  won        boolean not null
);

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

create table public.function_rate_limits (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  last_called_at timestamptz not null default now()
);

-- ============================================================
-- SECURITY DEFINER HELPERS
-- ============================================================

create or replace function public.my_team_id()
returns uuid language sql stable security definer as $$
  select team_id from public.profiles where id = auth.uid() limit 1;
$$;

create or replace function public.i_am_admin()
returns boolean language sql stable security definer as $$
  select coalesce(is_admin, false) from public.profiles where id = auth.uid() limit 1;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.teams               enable row level security;
alter table public.profiles            enable row level security;
alter table public.games               enable row level security;
alter table public.game_players        enable row level security;
alter table public.stat_seeds          enable row level security;
alter table public.function_rate_limits enable row level security;

-- TEAMS
create policy "Authenticated users can create a team"
  on public.teams for insert with check (auth.uid() is not null);

create policy "Anyone can look up a team by invite code"
  on public.teams for select using (true);

create policy "Team members can view their team"
  on public.teams for select using (id = public.my_team_id());

create policy "Admins can update their team"
  on public.teams for update using (id = public.my_team_id() and public.i_am_admin());

-- PROFILES
create policy "Team members can view each other"
  on public.profiles for select
  using (team_id = public.my_team_id() or id = auth.uid());

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (
    (id = auth.uid() and not is_angel)
    or (is_angel = true and public.i_am_admin())
  );

create policy "Users can update their own profile"
  on public.profiles for update
  using (
    id = auth.uid()
    or (team_id = public.my_team_id() and public.i_am_admin())
  );

create policy "Admins can delete ghost profiles"
  on public.profiles for delete
  using (is_angel = true and team_id = public.my_team_id() and public.i_am_admin());

-- GAMES
create policy "Team members can view games"
  on public.games for select
  using (team_id in (select team_id from public.profiles where id = auth.uid()));

create policy "Team members can insert games"
  on public.games for insert
  with check (team_id in (select team_id from public.profiles where id = auth.uid()));

create policy "Game creator or admin can delete games"
  on public.games for delete
  using (
    created_by = auth.uid()
    or team_id in (
      select team_id from public.profiles where id = auth.uid() and is_admin = true
    )
  );

-- GAME PLAYERS
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

-- STAT SEEDS
create policy "Team members can view seeds"
  on public.stat_seeds for select using (team_id = public.my_team_id());

create policy "Admins can insert seeds"
  on public.stat_seeds for insert
  with check (team_id = public.my_team_id() and public.i_am_admin());

create policy "Admins can update seeds"
  on public.stat_seeds for update
  using (team_id = public.my_team_id() and public.i_am_admin());

create policy "Admins can delete seeds"
  on public.stat_seeds for delete
  using (team_id = public.my_team_id() and public.i_am_admin());

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

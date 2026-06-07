-- ============================================================
-- BRUSH PASS — Supabase Schema
-- Reflects the live database as of 2026-06-07.
-- Safe to run on a fresh project. Re-running on an existing
-- project requires the DROP section below.
--
-- After running this file, also seed the global word pool —
-- see the note at the bottom of the LIVE GAMES section.
-- ============================================================

-- ============================================================
-- OPTIONAL CLEAN SLATE (uncomment if re-running on existing DB)
-- ============================================================
-- drop function if exists public.cancel_live_game(uuid);
-- drop function if exists public.reveal_card(uuid, int);
-- drop function if exists public.finish_live_game(uuid, text);
-- drop function if exists public.start_live_game(uuid);
-- drop table if exists public.live_game_events;
-- drop table if exists public.live_game_key;
-- drop table if exists public.live_game_players;
-- drop table if exists public.live_games;
-- drop table if exists public.words;
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

-- ============================================================
-- LIVE GAMES — real-time multiplayer rounds
-- ============================================================
--
-- Tables: words (pool), live_games (session), live_game_players,
-- live_game_key (secret — spymaster-only), live_game_events (log + stats source).
--
-- The secret word→color key lives in its own table with its own RLS so a
-- realtime subscription to live_games can never surface it to operatives.
-- All state transitions that need to read the key (starting a game, revealing
-- a card, finishing a game) go through security-definer functions below —
-- clients never write live_games.grid/revealed/status/current_turn directly.

-- ── Word pool ────────────────────────────────────────────────────────────────
-- team_id null = global default pool (seed from supabase/wordlists/default_words.txt,
-- or run supabase/migrations/20260607000002_seed_default_words.sql)
-- team_id set  = a team's custom words, mixed into their random draws

create table public.words (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  team_id    uuid references public.teams(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index words_global_text_uniq on public.words (lower(text)) where team_id is null;
create unique index words_team_text_uniq on public.words (team_id, lower(text)) where team_id is not null;

alter table public.words enable row level security;

create policy "words_select" on public.words
  for select using (
    team_id is null or team_id in (select my_team_ids())
  );

create policy "words_insert_own_team" on public.words
  for insert with check (
    team_id is not null and i_am_admin_of(team_id)
  );

create policy "words_delete_own_team" on public.words
  for delete using (
    team_id is not null and i_am_admin_of(team_id)
  );


-- ── Live games ───────────────────────────────────────────────────────────────

create table public.live_games (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  status        text not null default 'lobby' check (status in ('lobby', 'active', 'finished', 'cancelled')),
  grid          text[] not null default '{}',   -- 25 words, public
  revealed      text[] not null default '{}',   -- index-aligned; null until tapped, then 'red'/'blue'/'neutral'/'assassin'
  starting_side text check (starting_side in ('red', 'blue')),
  current_turn  text check (current_turn in ('red', 'blue')),
  winner        text check (winner in ('red', 'blue')),
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

alter table public.live_games enable row level security;

create policy "live_games_select" on public.live_games
  for select using (team_id in (select my_team_ids()));

create policy "live_games_insert" on public.live_games
  for insert with check (
    team_id in (select my_team_ids()) and created_by = auth.uid()
  );

-- No update/delete policies — status, grid, revealed, and current_turn all
-- transition through start_live_game()/reveal_card()/finish_live_game() below.


-- ── Players ──────────────────────────────────────────────────────────────────
-- Created before live_game_key since that table's RLS policy checks membership here.

create table public.live_game_players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.live_games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  side       text not null check (side in ('red', 'blue')),
  role       text not null check (role in ('spymaster', 'operative')),
  joined_at  timestamptz not null default now(),
  unique (game_id, profile_id)
);

-- Only one spymaster per side per game
create unique index live_game_players_one_spymaster_per_side
  on public.live_game_players (game_id, side)
  where role = 'spymaster';

alter table public.live_game_players enable row level security;

create policy "live_game_players_select" on public.live_game_players
  for select using (
    game_id in (select id from public.live_games where team_id in (select my_team_ids()))
  );

-- Anyone on the team can join a lobby in any role; once a game is active,
-- latecomers can only join as operatives (spymasters are locked in at start).
create policy "live_game_players_insert_self" on public.live_game_players
  for insert with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.live_games g
      where g.id = live_game_players.game_id
        and g.team_id in (select my_team_ids())
        and (
          g.status = 'lobby'
          or (g.status = 'active' and live_game_players.role = 'operative')
        )
    )
  );

create policy "live_game_players_update_self" on public.live_game_players
  for update using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and game_id in (select id from public.live_games where status = 'lobby')
  );

create policy "live_game_players_delete_self" on public.live_game_players
  for delete using (profile_id = auth.uid());


-- ── Secret key (spymaster-only) ──────────────────────────────────────────────

create table public.live_game_key (
  game_id uuid primary key references public.live_games(id) on delete cascade,
  key     text[] not null   -- index-aligned with live_games.grid: 'red'/'blue'/'neutral'/'assassin'
);

alter table public.live_game_key enable row level security;

create policy "live_game_key_select_spymasters" on public.live_game_key
  for select using (
    exists (
      select 1 from public.live_game_players p
      where p.game_id = live_game_key.game_id
        and p.profile_id = auth.uid()
        and p.role = 'spymaster'
    )
  );

-- No insert/update/delete policies — only start_live_game() writes here.


-- ── Event log (clues, reveals, turn changes — also the stats source) ─────────

create table public.live_game_events (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.live_games(id) on delete cascade,
  type       text not null check (type in ('clue', 'reveal', 'turn_end', 'game_over')),
  side       text check (side in ('red', 'blue')),
  profile_id uuid references public.profiles(id),
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.live_game_events enable row level security;

create policy "live_game_events_select" on public.live_game_events
  for select using (
    game_id in (select id from public.live_games where team_id in (select my_team_ids()))
  );

-- Clue events are the one type clients insert directly — only the active
-- spymaster, on their own turn, in their own voice.
create policy "live_game_events_insert_clue" on public.live_game_events
  for insert with check (
    type = 'clue'
    and profile_id = auth.uid()
    and exists (
      select 1
      from public.live_games g
      join public.live_game_players p on p.game_id = g.id
      where g.id = live_game_events.game_id
        and g.status = 'active'
        and g.current_turn = live_game_events.side
        and p.profile_id = auth.uid()
        and p.side = live_game_events.side
        and p.role = 'spymaster'
    )
  );

-- 'reveal', 'turn_end', and 'game_over' events are inserted only by
-- reveal_card()/finish_live_game() (security definer) — never by clients.


-- ── start_live_game(): build the grid + secret key, lobby → active ───────────

create or replace function public.start_live_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id   uuid;
  v_status    text;
  v_host      uuid;
  v_words     text[];
  v_first     text;
  v_key       text[];
begin
  select team_id, status, created_by into v_team_id, v_status, v_host
  from public.live_games where id = p_game_id
  for update;

  if v_status is distinct from 'lobby' then
    raise exception 'Game already started';
  end if;

  if auth.uid() is distinct from v_host and not i_am_admin_of(v_team_id) then
    raise exception 'Only the host or a team admin can start the game';
  end if;

  select array_agg(w.text) into v_words
  from (
    select text from public.words
    where team_id is null or team_id = v_team_id
    order by random()
    limit 25
  ) w;

  if coalesce(array_length(v_words, 1), 0) < 25 then
    raise exception 'Not enough words available to start a game (need 25)';
  end if;

  -- Coin flip for who goes first — that side gets 9 cards, the other 8,
  -- then 7 neutral and 1 assassin, all shuffled across the 25 positions.
  v_first := (array['red', 'blue'])[floor(random() * 2)::int + 1];

  with shuffled as (
    select i, row_number() over (order by random()) as rn
    from generate_series(1, 25) as i
  )
  select array_agg(
    case
      when rn <= 9  then v_first
      when rn <= 17 then (case when v_first = 'red' then 'blue' else 'red' end)
      when rn <= 24 then 'neutral'
      else 'assassin'
    end order by i
  )
  into v_key
  from shuffled;

  insert into public.live_game_key (game_id, key) values (p_game_id, v_key);

  update public.live_games
  set grid          = v_words,
      revealed      = array_fill(null::text, array[25]),
      starting_side = v_first,
      current_turn  = v_first,
      status        = 'active',
      started_at    = now()
  where id = p_game_id;
end;
$$;

revoke all on function public.start_live_game(uuid) from public;
grant execute on function public.start_live_game(uuid) to authenticated;


-- ── finish_live_game(): close the game and mirror the result into stats ──────

create or replace function public.finish_live_game(p_game_id uuid, p_winner text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id     uuid;
  v_created_by  uuid;
  v_new_game_id uuid;
  v_player      record;
begin
  select team_id, created_by into v_team_id, v_created_by
  from public.live_games where id = p_game_id;

  update public.live_games
  set status = 'finished', winner = p_winner, finished_at = now()
  where id = p_game_id;

  insert into public.live_game_events (game_id, type, side, payload)
  values (p_game_id, 'game_over', p_winner, jsonb_build_object('winner', p_winner));

  -- Mirror into games/game_players so the result flows into the normal
  -- leaderboard and history exactly like a manually logged game.
  insert into public.games (team_id, played_at, created_by, notes)
  values (v_team_id, now(), v_created_by, 'Live game')
  returning id into v_new_game_id;

  for v_player in
    select profile_id, side, role from public.live_game_players where game_id = p_game_id
  loop
    insert into public.game_players (game_id, profile_id, role, side, won)
    values (v_new_game_id, v_player.profile_id, v_player.role, v_player.side, v_player.side = p_winner);
  end loop;
end;
$$;

revoke all on function public.finish_live_game(uuid, text) from public;
-- Not granted to authenticated — only reveal_card() calls this internally.


-- ── reveal_card(): the only path that may read the secret key ────────────────

create or replace function public.reveal_card(p_game_id uuid, p_index int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game         record;
  v_color        text;
  v_caller_side  text;
  v_caller_role  text;
  v_revealed     text[];
  v_key          text[];
  v_red_total    int;
  v_blue_total   int;
  v_red_found    int;
  v_blue_found   int;
  v_next_turn    text;
begin
  select * into v_game from public.live_games where id = p_game_id for update;

  if v_game.status is distinct from 'active' then
    raise exception 'Game is not active';
  end if;
  if p_index < 0 or p_index > 24 then
    raise exception 'Index out of range';
  end if;
  if v_game.revealed[p_index + 1] is not null then
    raise exception 'Card already revealed';
  end if;

  select side, role into v_caller_side, v_caller_role
  from public.live_game_players
  where game_id = p_game_id and profile_id = auth.uid();

  if v_caller_role is distinct from 'operative' or v_caller_side is distinct from v_game.current_turn then
    raise exception 'Only an active-turn operative can reveal a card';
  end if;

  select key into v_key from public.live_game_key where game_id = p_game_id;
  v_color := v_key[p_index + 1];

  v_revealed := v_game.revealed;
  v_revealed[p_index + 1] := v_color;
  update public.live_games set revealed = v_revealed where id = p_game_id;

  insert into public.live_game_events (game_id, type, side, profile_id, payload)
  values (
    p_game_id, 'reveal', v_caller_side, auth.uid(),
    jsonb_build_object('index', p_index, 'word', v_game.grid[p_index + 1], 'color', v_color)
  );

  -- Assassin → instant loss for the side that tapped it
  if v_color = 'assassin' then
    perform public.finish_live_game(p_game_id, case when v_caller_side = 'red' then 'blue' else 'red' end);
    return;
  end if;

  -- Check whether either side has now revealed all of their cards
  select
    count(*) filter (where k.color = 'red'),
    count(*) filter (where k.color = 'blue'),
    count(*) filter (where k.color = 'red'  and v_revealed[k.idx] is not null),
    count(*) filter (where k.color = 'blue' and v_revealed[k.idx] is not null)
  into v_red_total, v_blue_total, v_red_found, v_blue_found
  from unnest(v_key) with ordinality as k(color, idx);

  if v_red_found = v_red_total then
    perform public.finish_live_game(p_game_id, 'red');
    return;
  elsif v_blue_found = v_blue_total then
    perform public.finish_live_game(p_game_id, 'blue');
    return;
  end if;

  -- Wrong-color or neutral card ends the turn; matching the active side keeps it going
  if v_color is distinct from v_caller_side then
    v_next_turn := case when v_caller_side = 'red' then 'blue' else 'red' end;

    update public.live_games set current_turn = v_next_turn where id = p_game_id;

    insert into public.live_game_events (game_id, type, side)
    values (p_game_id, 'turn_end', v_next_turn);
  end if;
end;
$$;

revoke all on function public.reveal_card(uuid, int) from public;
grant execute on function public.reveal_card(uuid, int) to authenticated;


-- ── cancel_live_game(): host/admin can drop a lobby or in-progress game ──────
-- Cancelled games record no winner and mirror nothing into games/game_players —
-- they have zero effect on stats. Players closing their browser does NOT
-- cancel a game; live_game_players rows persist until someone explicitly leaves.

create or replace function public.cancel_live_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_status  text;
  v_host    uuid;
begin
  select team_id, status, created_by into v_team_id, v_status, v_host
  from public.live_games where id = p_game_id
  for update;

  if v_status not in ('lobby', 'active') then
    raise exception 'Only an open lobby or in-progress game can be cancelled';
  end if;

  if auth.uid() is distinct from v_host and not i_am_admin_of(v_team_id) then
    raise exception 'Only the host or a team admin can cancel the game';
  end if;

  update public.live_games
  set status = 'cancelled', finished_at = now()
  where id = p_game_id;

  if v_status = 'active' then
    insert into public.live_game_events (game_id, type, payload)
    values (p_game_id, 'game_over', jsonb_build_object('cancelled', true));
  end if;
end;
$$;

revoke all on function public.cancel_live_game(uuid) from public;
grant execute on function public.cancel_live_game(uuid) to authenticated;


-- ── Realtime ─────────────────────────────────────────────────────────────────
-- live_game_key is intentionally NOT published — it's static after game start
-- (spymasters fetch it once) and has no business going out over a broadcast channel.

alter publication supabase_realtime add table public.live_games;
alter publication supabase_realtime add table public.live_game_players;
alter publication supabase_realtime add table public.live_game_events;

-- ============================================================
-- SEEDING THE WORD POOL
-- ============================================================
-- start_live_game() needs at least 25 words (team_id is null or matches
-- the team) to draw a board. After running this file, seed the global
-- pool by running the contents of:
--
--   supabase/migrations/20260607000002_seed_default_words.sql
--
-- which inserts the 417-word original list from
-- supabase/wordlists/default_words.txt with team_id = null.

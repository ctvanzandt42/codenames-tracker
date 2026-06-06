-- RLS policy tests for codenames-tracker (multi-team schema).
-- Run locally: supabase test db
-- All test data is inserted inside a transaction that is rolled back at the end.

begin;

select plan(16);

-- ── Test data (inserted as postgres superuser, bypassing RLS) ────────────────

insert into public.teams (id, name, invite_code) values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Team A', 'test-code-a'),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'Team B', 'test-code-b');

-- Member A  — Team A, not admin
-- Admin A   — Team A, admin
-- Member B  — Team B, not admin
-- Ghost A   — Team A, angel (no auth.users row needed — profiles has no FK)
insert into public.profiles (id, display_name, is_angel) values
  ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'Member A', false),
  ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'Admin A',  false),
  ('bbbbbbbb-0000-0000-0000-000000000003'::uuid, 'Member B', false),
  ('cccccccc-0000-0000-0000-000000000001'::uuid, 'Ghost A',  true);

insert into public.team_members (team_id, profile_id, is_admin, is_active) values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'bbbbbbbb-0000-0000-0000-000000000001'::uuid, false, true),
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, true,  true),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'bbbbbbbb-0000-0000-0000-000000000003'::uuid, false, true),
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'cccccccc-0000-0000-0000-000000000001'::uuid, false, true);

-- One game per team
insert into public.games (id, team_id, played_at, created_by) values
  ('dddddddd-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', now(), 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000002'::uuid, 'aaaaaaaa-0000-0000-0000-000000000002', now(), 'bbbbbbbb-0000-0000-0000-000000000003');

-- One seed for Member A (used in seed visibility tests)
insert into public.stat_seeds (team_id, profile_id, w, l, sm_w, sm_l) values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'bbbbbbbb-0000-0000-0000-000000000001'::uuid, 5, 3, 2, 1);


-- ── profiles: visibility ─────────────────────────────────────────────────────

-- 1. Member A can see all 3 profiles on Team A (including the ghost)
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.profiles),
  3,
  'Member sees all profiles on their team including ghost'
);

-- 2. Member A cannot see Member B (different team)
select is(
  (select count(*)::int from public.profiles
    where id = 'bbbbbbbb-0000-0000-0000-000000000003'::uuid),
  0,
  'Member cannot see a profile from another team'
);

reset role;


-- ── profiles: user updates own profile ───────────────────────────────────────

-- 3
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000001", "role": "authenticated"}';

update public.profiles
  set display_name = 'Member A Updated'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001'::uuid;

reset role;

select is(
  (select display_name from public.profiles
    where id = 'bbbbbbbb-0000-0000-0000-000000000001'::uuid),
  'Member A Updated',
  'User can update their own profile'
);


-- ── profiles: non-admin cannot update another user ───────────────────────────

-- 4
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000001", "role": "authenticated"}';

update public.profiles
  set display_name = 'Hacked'
  where id = 'bbbbbbbb-0000-0000-0000-000000000002'::uuid;

reset role;

select is(
  (select display_name from public.profiles
    where id = 'bbbbbbbb-0000-0000-0000-000000000002'::uuid),
  'Admin A',
  'Non-admin cannot update another user profile'
);


-- ── profiles: admin can update a teammate ────────────────────────────────────

-- 5
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

update public.profiles
  set display_name = 'Member A (admin edit)'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001'::uuid;

reset role;

select is(
  (select display_name from public.profiles
    where id = 'bbbbbbbb-0000-0000-0000-000000000001'::uuid),
  'Member A (admin edit)',
  'Admin can update a teammate profile'
);


-- ── profiles: admin cannot update a profile from another team ────────────────

-- 6
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

update public.profiles
  set display_name = 'Hacked by Admin'
  where id = 'bbbbbbbb-0000-0000-0000-000000000003'::uuid;

reset role;

select is(
  (select display_name from public.profiles
    where id = 'bbbbbbbb-0000-0000-0000-000000000003'::uuid),
  'Member B',
  'Admin cannot update a profile from another team'
);


-- ── profiles: non-admin cannot delete a ghost ────────────────────────────────

-- 7
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000001", "role": "authenticated"}';

delete from public.profiles
  where id = 'cccccccc-0000-0000-0000-000000000001'::uuid;

reset role;

select is(
  (select count(*)::int from public.profiles
    where id = 'cccccccc-0000-0000-0000-000000000001'::uuid),
  1,
  'Non-admin cannot delete a ghost profile'
);


-- ── profiles: admin can delete a ghost on their team ─────────────────────────

-- 8
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

delete from public.profiles
  where id = 'cccccccc-0000-0000-0000-000000000001'::uuid;

reset role;

select is(
  (select count(*)::int from public.profiles
    where id = 'cccccccc-0000-0000-0000-000000000001'::uuid),
  0,
  'Admin can delete a ghost profile on their team'
);


-- ── games: visibility ────────────────────────────────────────────────────────

-- 9. Member A sees only Team A's game
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.games),
  1,
  'Member sees only their team games'
);

-- 10. The explicit Team B filter returns nothing (RLS already excludes it)
select is(
  (select count(*)::int from public.games
    where team_id = 'aaaaaaaa-0000-0000-0000-000000000002'::uuid),
  0,
  'Member cannot see games from another team'
);


-- ── games: member can insert for their own team ──────────────────────────────

-- 11
insert into public.games (team_id, created_by)
  values (
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid
  );

select is(
  (select count(*)::int from public.games),
  2,
  'Member can insert a game for their own team'
);


-- ── games: member cannot insert for another team ─────────────────────────────

-- 12
select throws_ok(
  $$insert into public.games (team_id, created_by) values (
    'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid
  )$$,
  '42501',
  null,
  'Member cannot insert a game for another team'
);

reset role;


-- ── stat_seeds: non-admin cannot insert ──────────────────────────────────────

-- 13
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$insert into public.stat_seeds (team_id, profile_id, w, l, sm_w, sm_l) values (
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
    99, 0, 0, 0
  )$$,
  '42501',
  null,
  'Non-admin cannot insert a stat seed'
);


-- ── stat_seeds: member can read seeds for their team ─────────────────────────

-- 14
select is(
  (select count(*)::int from public.stat_seeds),
  1,
  'Team member can read seeds for their team'
);

reset role;


-- ── stat_seeds: admin can insert ─────────────────────────────────────────────

-- 15
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

insert into public.stat_seeds (team_id, profile_id, w, l, sm_w, sm_l) values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, 10, 5, 3, 2);

select is(
  (select count(*)::int from public.stat_seeds),
  2,
  'Admin can insert a stat seed'
);

reset role;


-- ── stat_seeds: another team's seeds are invisible ───────────────────────────

-- 16
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-0000-0000-0000-000000000003", "role": "authenticated"}';

select is(
  (select count(*)::int from public.stat_seeds),
  0,
  'Member cannot read seeds from another team'
);

reset role;


-- ── Done ──────────────────────────────────────────────────────────────────────

select * from finish();
rollback;

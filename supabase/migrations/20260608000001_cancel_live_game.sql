-- Allow a host or team admin to cancel a live game — either while it's
-- still an open lobby or mid-round. Cancelled games are dropped entirely:
-- no winner, no mirrored games/game_players rows, no stats impact.
--
-- Players simply closing their browser must NOT cancel or otherwise affect
-- a game — live_game_players rows persist until someone explicitly leaves,
-- and nothing here (or elsewhere) reacts to a dropped realtime connection.

alter table public.live_games drop constraint live_games_status_check;
alter table public.live_games add constraint live_games_status_check
  check (status in ('lobby', 'active', 'finished', 'cancelled'));

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

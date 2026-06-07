import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import AppHeader from '../components/AppHeader'

export default function PlayLobby() {
  const { profile, memberships } = useAuth()
  const navigate = useNavigate()
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (memberships?.length && !selectedTeamId) {
      setSelectedTeamId(memberships[0].team_id)
    }
  }, [memberships, selectedTeamId])

  const loadGames = useCallback(async (teamId) => {
    const { data } = await supabase
      .from('live_games')
      .select('id, status, winner, created_at, started_at, finished_at, live_game_players(id, side, role, profiles(display_name))')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(30)
    return data || []
  }, [])

  useEffect(() => {
    if (!selectedTeamId) return
    let cancelled = false
    setLoading(true)
    loadGames(selectedTeamId).then(data => {
      if (!cancelled) { setGames(data); setLoading(false) }
    })

    const channel = supabase
      .channel(`live_games_lobby:${selectedTeamId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_games', filter: `team_id=eq.${selectedTeamId}` },
        () => loadGames(selectedTeamId).then(data => !cancelled && setGames(data)))
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [selectedTeamId, loadGames])

  async function createGame() {
    setCreating(true)
    const { data, error } = await supabase
      .from('live_games')
      .insert({ team_id: selectedTeamId, created_by: profile.id })
      .select().single()
    setCreating(false)
    if (!error && data) navigate(`/play/${data.id}`)
  }

  const multiTeam = memberships?.length > 1
  const selectedTeamName = memberships?.find(m => m.team_id === selectedTeamId)?.teams?.name

  const lobbyGames = games.filter(g => g.status === 'lobby')
  const activeGames = games.filter(g => g.status === 'active')
  const finishedGames = games.filter(g => g.status === 'finished' || g.status === 'cancelled')

  return (
    <div className="app-shell">
      <AppHeader title="Play">
        <button className="nav-link sign-out-btn" onClick={() => navigate('/')}>← Back</button>
      </AppHeader>

      <main className="main-content">

        {multiTeam && (
          <div>
            <select
              className="player-select"
              style={{ width: '100%' }}
              value={selectedTeamId}
              onChange={e => setSelectedTeamId(e.target.value)}
            >
              {memberships.map(m => (
                <option key={m.team_id} value={m.team_id}>{m.teams?.name}</option>
              ))}
            </select>
          </div>
        )}

        <section className="log-section">
          {multiTeam && selectedTeamName && <h2 className="section-title">{selectedTeamName}</h2>}
          <p className="muted" style={{ marginBottom: 16 }}>
            Play a live round with your team. Spymasters give one-word clues; operatives guess which cards belong to them.
          </p>
          <button className="btn-magic" style={{ width: 'auto', padding: '11px 28px' }} onClick={createGame} disabled={creating}>
            {creating ? '🎲 Creating…' : '🎲 New Game'}
          </button>
        </section>

        {loading ? (
          <div className="loading-state">Loading games…</div>
        ) : (<>

          {lobbyGames.length > 0 && (
            <section className="recent-section">
              <h2 className="section-title">Open Lobbies</h2>
              <div className="play-game-list">
                {lobbyGames.map(g => <PlayGameRow key={g.id} game={g} onClick={() => navigate(`/play/${g.id}`)} />)}
              </div>
            </section>
          )}

          {activeGames.length > 0 && (
            <section className="recent-section">
              <h2 className="section-title">In Progress</h2>
              <div className="play-game-list">
                {activeGames.map(g => <PlayGameRow key={g.id} game={g} onClick={() => navigate(`/play/${g.id}`)} />)}
              </div>
            </section>
          )}

          {finishedGames.length > 0 && (
            <section className="recent-section">
              <h2 className="section-title">Recently Finished</h2>
              <div className="play-game-list">
                {finishedGames.slice(0, 8).map(g => <PlayGameRow key={g.id} game={g} onClick={() => navigate(`/play/${g.id}`)} />)}
              </div>
            </section>
          )}

          {games.length === 0 && (
            <p className="muted">No games yet — start one above to get the lobby going.</p>
          )}
        </>)}
      </main>
    </div>
  )
}

function PlayGameRow({ game, onClick }) {
  const players = game.live_game_players || []
  const redCount = players.filter(p => p.side === 'red').length
  const blueCount = players.filter(p => p.side === 'blue').length

  const statusLabel = {
    lobby: 'Waiting for players',
    active: 'In progress',
    finished: game.winner ? `${game.winner.toUpperCase()} won` : 'Finished',
    cancelled: 'Cancelled',
  }[game.status]

  return (
    <button className="play-game-row" onClick={onClick}>
      <div className="play-game-row-main">
        <span className={`play-status-dot ${game.status}`} />
        <span className="play-game-row-status">{statusLabel}</span>
      </div>
      <div className="play-game-row-counts">
        <span className="play-side-count red">🔴 {redCount}</span>
        <span className="play-side-count blue">🔵 {blueCount}</span>
      </div>
      <span className="play-game-row-time">
        {new Date(game.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </span>
    </button>
  )
}

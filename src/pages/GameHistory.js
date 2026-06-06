import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import AppHeader from '../components/AppHeader'

const PAGE_SIZE = 20

export default function GameHistory() {
  const { memberships, isAdminOf } = useAuth()
  const navigate = useNavigate()
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [deletingGame, setDeletingGame] = useState(null)

  useEffect(() => {
    if (memberships?.length && !selectedTeamId) {
      setSelectedTeamId(memberships[0].team_id)
    }
  }, [memberships])

  const loadGames = useCallback(async (teamId, offset = 0) => {
    const { data } = await supabase
      .from('games')
      .select('*, game_players(*, profiles(display_name))')
      .eq('team_id', teamId)
      .order('played_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    return data || []
  }, [])

  useEffect(() => {
    if (!selectedTeamId) return
    async function init() {
      setLoading(true)
      setGames([])
      const data = await loadGames(selectedTeamId, 0)
      setGames(data)
      setHasMore(data.length === PAGE_SIZE)
      setLoading(false)
    }
    init()
  }, [selectedTeamId, loadGames])

  async function loadMore() {
    setLoadingMore(true)
    const data = await loadGames(selectedTeamId, games.length)
    setGames(prev => [...prev, ...data])
    setHasMore(data.length === PAGE_SIZE)
    setLoadingMore(false)
  }

  async function deleteGame(gameId) {
    if (!window.confirm('Delete this game? Stats will update automatically.')) return
    setDeletingGame(gameId)
    await supabase.from('games').delete().eq('id', gameId)
    setGames(prev => prev.filter(g => g.id !== gameId))
    setDeletingGame(null)
  }

  const multiTeam = memberships?.length > 1
  const selectedTeamName = memberships?.find(m => m.team_id === selectedTeamId)?.teams?.name

  return (
    <div className="app-shell">
      <AppHeader title="Game History">
        <button className="nav-link sign-out-btn" onClick={() => navigate('/')}>← Back</button>
      </AppHeader>

      <main className="main-content">

        {/* Team switcher */}
        {multiTeam && (
          <div style={{ marginBottom: 20 }}>
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

        <section className="recent-section">
          {multiTeam && selectedTeamName && (
            <h2 className="section-title">{selectedTeamName}</h2>
          )}

          {loading ? (
            <div className="loading-state">Loading games…</div>
          ) : games.length === 0 ? (
            <p className="muted">No games logged yet.</p>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 16, fontSize: '0.85rem' }}>
                {games.length} game{games.length !== 1 ? 's' : ''} shown
              </p>
              <div className="game-cards">
                {games.map(game => {
                  const redPlayers = game.game_players?.filter(p => p.side === 'red') ?? []
                  const bluePlayers = game.game_players?.filter(p => p.side === 'blue') ?? []
                  const winner = game.game_players?.find(p => p.won)?.side
                  return (
                    <div key={game.id} className={`game-card ${deletingGame === game.id ? 'game-card-deleting' : ''}`}>
                      <div className="game-card-date">
                        {new Date(game.played_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {winner && <span className={`winner-tag ${winner}`}>{winner.toUpperCase()} wins</span>}
                        {isAdminOf(selectedTeamId) && (
                          <button
                            className="delete-game-btn"
                            onClick={() => deleteGame(game.id)}
                            disabled={deletingGame === game.id}
                            title="Delete game"
                          >{deletingGame === game.id ? '…' : '✕'}</button>
                        )}
                      </div>
                      <div className="game-sides">
                        <div className="game-side red-side">
                          {redPlayers.map(p => (
                            <span key={p.id} className="player-chip">
                              {p.profiles?.display_name}
                              {p.role === 'spymaster' && <span className="sm-badge" title="Spymaster">🕵️</span>}
                            </span>
                          ))}
                        </div>
                        <div className="vs-divider">vs</div>
                        <div className="game-side blue-side">
                          {bluePlayers.map(p => (
                            <span key={p.id} className="player-chip">
                              {p.profiles?.display_name}
                              {p.role === 'spymaster' && <span className="sm-badge" title="Spymaster">🕵️</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                      {game.notes && <p className="game-notes">"{game.notes}"</p>}
                    </div>
                  )
                })}
              </div>

              {hasMore && (
                <div style={{ textAlign: 'center', marginTop: 24 }}>
                  <button className="action-btn" onClick={loadMore} disabled={loadingMore}
                    style={{ padding: '10px 28px' }}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}

              {!hasMore && games.length > PAGE_SIZE && (
                <p className="muted" style={{ textAlign: 'center', marginTop: 20, fontSize: '0.85rem' }}>
                  All {games.length} games loaded
                </p>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}

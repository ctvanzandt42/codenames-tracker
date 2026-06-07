import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { computeStats } from '../lib/stats'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'

export default function Dashboard() {
  const { profile, memberships, isAdminOf, signOut } = useAuth()
  const [teamData, setTeamData] = useState({}) // keyed by team_id
  const [loading, setLoading] = useState(true)

  const isAnyAdmin = memberships?.some(m => m.is_admin)

  useEffect(() => {
    if (memberships?.length) loadAll()
  }, [memberships])

  async function loadAll() {
    setLoading(true)
    const results = await Promise.all(memberships.map(m => loadTeam(m.team_id)))
    const map = {}
    memberships.forEach((m, i) => { map[m.team_id] = results[i] })
    setTeamData(map)
    setLoading(false)
  }

  async function loadTeam(teamId) {
    const [{ data: gamePlayers }, { data: seeds }, { data: memberRows }, { data: games }] =
      await Promise.all([
        supabase
          .from('game_players')
          .select('*, profiles(display_name), games(played_at, team_id)')
          .eq('games.team_id', teamId)
          .order('games(played_at)', { ascending: false }),
        supabase
          .from('stat_seeds')
          .select('*, profiles(display_name)')
          .eq('team_id', teamId),
        supabase
          .from('team_members')
          .select('is_active, profile_id, profiles(id, display_name, is_angel)')
          .eq('team_id', teamId),
        supabase
          .from('games')
          .select('*, game_players(*, profiles(display_name))')
          .eq('team_id', teamId)
          .order('played_at', { ascending: false })
          .limit(5),
      ])

    // Merge is_active (team_members) with is_angel/display_name (profiles) for computeStats
    const allMembers = (memberRows || []).map(r => ({
      id: r.profile_id,
      display_name: r.profiles?.display_name,
      is_active: r.is_active,
      is_angel: r.profiles?.is_angel ?? false,
    }))

    const filtered = (gamePlayers || []).filter(gp => gp.games?.team_id === teamId)
    return {
      stats: computeStats(filtered, seeds || [], allMembers),
      recentGames: games || [],
    }
  }

  async function deleteGame(gameId, teamId) {
    if (!window.confirm('Delete this game? Stats will update automatically.')) return
    await supabase.from('games').delete().eq('id', gameId)
    const refreshed = await loadTeam(teamId)
    setTeamData(prev => ({ ...prev, [teamId]: refreshed }))
  }

  return (
    <div className="app-shell">
      <AppHeader title="Brush Pass">
        {isAnyAdmin && <Link to="/admin" className="nav-link">Admin</Link>}
        <Link to="/play" className="nav-link">Play</Link>
        <Link to="/history" className="nav-link">History</Link>
        <Link to="/log" className="nav-link btn-log">+ Log Game</Link>
        <button onClick={signOut} className="nav-link sign-out-btn">Sign out</button>
      </AppHeader>

      <main className="main-content">
        {loading ? (
          <div className="loading-state">Loading stats…</div>
        ) : (<>
          {memberships.map(membership => {
            const team = membership.teams
            const data = teamData[membership.team_id] || { stats: [], recentGames: [] }
            const inviteCode = team?.invite_code

            return (
              <div key={membership.team_id} className="team-section-block">
                <h2 className="team-section-heading">{team?.name}</h2>

                {/* Leaderboard */}
                <section className="leaderboard-section">
                  <h3 className="section-title">Leaderboard</h3>
                  {data.stats.length === 0 ? (
                    <div className="empty-state">
                      <p>No games logged yet.</p>
                      <Link to="/log" className="btn-magic inline-btn">Log your first game →</Link>
                    </div>
                  ) : (
                    <div className="leaderboard-table-wrap">
                      <table className="leaderboard-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Player</th>
                            <th>W-L</th>
                            <th>Win%</th>
                            <th>SM W-L</th>
                            <th>Streak</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.stats.map((s, i) => (
                            <tr key={s.profile_id} className={[i === 0 ? 'top-row' : '', !s.is_active ? 'inactive-row' : ''].filter(Boolean).join(' ')}>
                              <td className="rank-cell">
                                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                              </td>
                              <td className="name-cell">
                                {s.display_name}
                                {!s.is_active && <span className="emeritus-badge" title="No longer on team">emeritus</span>}
                                {s.is_angel && <span className="angel-badge" title="Manually added">😇</span>}
                              </td>
                              <td><span className="wl">{s.w}-{s.l}</span></td>
                              <td>
                                <span className="win-pct">{s.winPct}%</span>
                                <div className="pct-bar">
                                  <div className="pct-fill" style={{ width: `${s.winPct}%` }} />
                                </div>
                              </td>
                              <td className="sm-cell">{s.smW}-{s.smL}</td>
                              <td>
                                <span className={`streak-badge ${s.streak.startsWith('W') ? 'streak-w' : s.streak.startsWith('L') ? 'streak-l' : ''}`}>
                                  {s.streak}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Recent Games */}
                <section className="recent-section">
                  <h3 className="section-title">Recent Games</h3>
                  {data.recentGames.length === 0 ? (
                    <p className="muted">No games yet.</p>
                  ) : (
                    <div className="game-cards">
                      {data.recentGames.map(game => {
                        const redPlayers = game.game_players?.filter(p => p.side === 'red') ?? []
                        const bluePlayers = game.game_players?.filter(p => p.side === 'blue') ?? []
                        const winner = game.game_players?.find(p => p.won)?.side
                        return (
                          <div key={game.id} className="game-card">
                            <div className="game-card-date">
                              {new Date(game.played_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {winner && <span className={`winner-tag ${winner}`}>{winner.toUpperCase()} wins</span>}
                              {isAdminOf(membership.team_id) && (
                                <button
                                  className="delete-game-btn"
                                  onClick={() => deleteGame(game.id, membership.team_id)}
                                  title="Delete game"
                                >✕</button>
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
                  )}
                </section>

                {/* Invite code */}
                {inviteCode && (
                  <section className="invite-section">
                    <p className="invite-label">Team invite code</p>
                    <div className="invite-code-display"
                      onClick={() => navigator.clipboard.writeText(inviteCode)}
                      title="Click to copy">
                      {inviteCode} <span className="copy-hint">click to copy</span>
                    </div>
                  </section>
                )}
              </div>
            )
          })}
          <div style={{ textAlign: 'center', paddingTop: 8 }}>
            <Link to="/teams/new" className="nav-link" style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              + Join or create another team
            </Link>
          </div>
        </>)}
      </main>
    </div>
  )
}

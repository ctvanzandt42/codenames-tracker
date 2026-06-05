import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { computeStats } from '../lib/stats'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  const { profile, signOut } = useAuth()
  const [stats, setStats] = useState([])
  const [recentGames, setRecentGames] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (profile?.team_id) {
      loadData()
    }
  }, [profile])

  async function loadData() {
    setLoading(true)

    // Load all game players for this team, with nested game + profile data
    const { data: gamePlayers } = await supabase
      .from('game_players')
      .select('*, profiles(display_name), games(played_at, team_id)')
      .eq('games.team_id', profile.team_id)
      .order('games(played_at)', { ascending: false })

    // Filter out any nulls (cross-team noise from RLS)
    const filtered = (gamePlayers || []).filter(gp => gp.games?.team_id === profile.team_id)
    setStats(computeStats(filtered))

    // Load recent games with player breakdown
    const { data: games } = await supabase
      .from('games')
      .select('*, game_players(*, profiles(display_name))')
      .eq('team_id', profile.team_id)
      .order('played_at', { ascending: false })
      .limit(5)
    setRecentGames(games || [])

    setLoading(false)
  }

  const teamName = profile?.teams?.name ?? 'Your Team'
  const inviteCode = profile?.teams?.invite_code

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <span className="logo-icon-sm">🕵️</span>
          <span className="header-team">{teamName}</span>
        </div>
        <nav className="header-nav">
          {profile?.is_admin && (
            <Link to="/admin" className="nav-link">Admin</Link>
          )}
          <Link to="/log" className="nav-link btn-log">+ Log Game</Link>
          <button onClick={signOut} className="nav-link sign-out-btn">Sign out</button>
        </nav>
      </header>

      <main className="main-content">
        {loading ? (
          <div className="loading-state">Loading stats…</div>
        ) : (
          <>
            <section className="leaderboard-section">
              <h2 className="section-title">Leaderboard</h2>
              {stats.length === 0 ? (
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
                      {stats.map((s, i) => (
                        <tr key={s.profile_id} className={i === 0 ? 'top-row' : ''}>
                          <td className="rank-cell">
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                          </td>
                          <td className="name-cell">{s.display_name}</td>
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

            <section className="recent-section">
              <h2 className="section-title">Recent Games</h2>
              {recentGames.length === 0 ? (
                <p className="muted">No games yet.</p>
              ) : (
                <div className="game-cards">
                  {recentGames.map(game => {
                    const redPlayers = game.game_players?.filter(p => p.side === 'red') ?? []
                    const bluePlayers = game.game_players?.filter(p => p.side === 'blue') ?? []
                    const winner = game.game_players?.find(p => p.won)?.side
                    return (
                      <div key={game.id} className="game-card">
                        <div className="game-card-date">
                          {new Date(game.played_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {winner && <span className={`winner-tag ${winner}`}>{winner.toUpperCase()} wins</span>}
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

            {inviteCode && (
              <section className="invite-section">
                <p className="invite-label">Team invite code</p>
                <div className="invite-code-display" onClick={() => navigator.clipboard.writeText(inviteCode)} title="Click to copy">
                  {inviteCode} <span className="copy-hint">click to copy</span>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

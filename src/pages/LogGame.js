import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import AppHeader from '../components/AppHeader'

const EMPTY_PLAYER = { profile_id: '', role: 'operative', side: 'red' }

export default function LogGame() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [members, setMembers] = useState([])
  const [winner, setWinner] = useState('red') // 'red' | 'blue'
  const [players, setPlayers] = useState([
    { ...EMPTY_PLAYER, side: 'red' },
    { ...EMPTY_PLAYER, side: 'red' },
    { ...EMPTY_PLAYER, side: 'blue' },
    { ...EMPTY_PLAYER, side: 'blue' },
  ])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (profile?.team_id) loadMembers()
  }, [profile])

  async function loadMembers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('team_id', profile.team_id)
    setMembers(data || [])
  }

  function updatePlayer(index, field, value) {
    setPlayers(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p))
  }

  function addPlayer(side) {
    setPlayers(prev => [...prev, { ...EMPTY_PLAYER, side }])
  }

  function removePlayer(index) {
    setPlayers(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)

    // Validate: need at least 1 player per side, each side needs exactly 1 spymaster
    const redPlayers = players.filter(p => p.side === 'red' && p.profile_id)
    const bluePlayers = players.filter(p => p.side === 'blue' && p.profile_id)
    const redSM = redPlayers.filter(p => p.role === 'spymaster')
    const blueSM = bluePlayers.filter(p => p.role === 'spymaster')

    if (redPlayers.length === 0 || bluePlayers.length === 0) {
      setError('Both teams need at least one player.'); setLoading(false); return
    }
    if (redSM.length !== 1) {
      setError('Red team needs exactly one spymaster.'); setLoading(false); return
    }
    if (blueSM.length !== 1) {
      setError('Blue team needs exactly one spymaster.'); setLoading(false); return
    }

    try {
      // Insert game
      const { data: game, error: gameErr } = await supabase
        .from('games')
        .insert({ team_id: profile.team_id, notes: notes || null, created_by: profile.id })
        .select().single()
      if (gameErr) throw gameErr

      // Insert game_players
      const validPlayers = players.filter(p => p.profile_id)
      const gpRows = validPlayers.map(p => ({
        game_id: game.id,
        profile_id: p.profile_id,
        role: p.role,
        side: p.side,
        won: p.side === winner,
      }))

      const { error: gpErr } = await supabase.from('game_players').insert(gpRows)
      if (gpErr) throw gpErr

      navigate('/')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const redPlayers = players.map((p, i) => ({ ...p, index: i })).filter(p => p.side === 'red')
  const bluePlayers = players.map((p, i) => ({ ...p, index: i })).filter(p => p.side === 'blue')

  return (
    <div className="app-shell">
      <AppHeader title="Log a Game">
        <button className="nav-link sign-out-btn" onClick={() => navigate('/')}>← Back</button>
      </AppHeader>

      <main className="main-content log-game-main">
        <form onSubmit={handleSubmit} className="log-form">

          {/* Winner */}
          <section className="log-section">
            <h3 className="log-section-title">Who won?</h3>
            <div className="winner-toggle">
              <button
                type="button"
                className={`winner-btn red-btn ${winner === 'red' ? 'active' : ''}`}
                onClick={() => setWinner('red')}
              >🔴 Red</button>
              <button
                type="button"
                className={`winner-btn blue-btn ${winner === 'blue' ? 'active' : ''}`}
                onClick={() => setWinner('blue')}
              >🔵 Blue</button>
            </div>
          </section>

          {/* Teams */}
          <div className="teams-grid">
            {[{ side: 'red', label: '🔴 Red Team', list: redPlayers },
              { side: 'blue', label: '🔵 Blue Team', list: bluePlayers }].map(({ side, label, list }) => (
              <section key={side} className={`log-section team-section ${side}-section`}>
                <h3 className="log-section-title">{label}</h3>
                {list.map(({ index, profile_id, role }) => (
                  <div key={index} className="player-row">
                    <select
                      className="player-select"
                      value={profile_id}
                      onChange={e => updatePlayer(index, 'profile_id', e.target.value)}
                    >
                      <option value="">— Select player —</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>{m.display_name || m.id}</option>
                      ))}
                    </select>
                    <select
                      className="role-select"
                      value={role}
                      onChange={e => updatePlayer(index, 'role', e.target.value)}
                    >
                      <option value="operative">Operative</option>
                      <option value="spymaster">🕵️ Spymaster</option>
                    </select>
                    <button type="button" className="remove-player-btn" onClick={() => removePlayer(index)}>✕</button>
                  </div>
                ))}
                <button type="button" className="add-player-btn" onClick={() => addPlayer(side)}>
                  + Add player
                </button>
              </section>
            ))}
          </div>

          {/* Notes */}
          <section className="log-section">
            <h3 className="log-section-title">Notes <span className="optional">(optional)</span></h3>
            <input
              className="email-input"
              placeholder="e.g. 9-clue massacre, comeback win…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </section>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" className="btn-magic submit-btn" disabled={loading}>
            {loading ? 'Saving…' : '✅ Save game'}
          </button>
        </form>
      </main>
    </div>
  )
}

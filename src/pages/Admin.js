import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

export default function Admin() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [members, setMembers] = useState([])
  const [seeds, setSeeds] = useState({}) // keyed by profile_id
  const [seedEdits, setSeedEdits] = useState({}) // in-progress edits
  const [loading, setLoading] = useState(true)
  const [seedSaving, setSeedSaving] = useState({}) // profile_id -> bool
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (profile) {
      if (!profile.is_admin) navigate('/')
      else loadAll()
    }
  }, [profile])

  async function loadAll() {
    await Promise.all([loadMembers(), loadSeeds()])
    setLoading(false)
  }

  async function loadMembers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, is_admin, created_at')
      .eq('team_id', profile.team_id)
      .order('created_at')
    setMembers(data || [])
  }

  async function loadSeeds() {
    const { data } = await supabase
      .from('stat_seeds')
      .select('*')
      .eq('team_id', profile.team_id)
    const map = {}
    for (const s of data || []) map[s.profile_id] = s
    setSeeds(map)
  }

  // ---- Member management ----

  async function toggleAdmin(memberId, currentVal) {
    await supabase.from('profiles').update({ is_admin: !currentVal }).eq('id', memberId)
    await loadMembers()
    flash('Updated!')
  }

  async function removeMember(memberId) {
    if (!window.confirm('Remove this member from the team?')) return
    await supabase.from('profiles').update({ team_id: null }).eq('id', memberId)
    await loadMembers()
  }

  // ---- Seed stats ----

  function getSeedField(profileId, field) {
    // edits take priority, then saved seed, then 0/null
    if (seedEdits[profileId]?.[field] !== undefined) return seedEdits[profileId][field]
    const s = seeds[profileId]
    if (!s) return field === 'streak_type' ? '' : 0
    return s[field] ?? (field === 'streak_type' ? '' : 0)
  }

  function setSeedField(profileId, field, value) {
    setSeedEdits(prev => ({
      ...prev,
      [profileId]: { ...(prev[profileId] || {}), [field]: value }
    }))
  }

  async function saveSeed(profileId) {
    setSeedSaving(prev => ({ ...prev, [profileId]: true }))

    const existing = seeds[profileId]
    const edits = seedEdits[profileId] || {}

    const payload = {
      team_id: profile.team_id,
      profile_id: profileId,
      w:            parseInt(edits.w            ?? existing?.w            ?? 0) || 0,
      l:            parseInt(edits.l            ?? existing?.l            ?? 0) || 0,
      sm_w:         parseInt(edits.sm_w         ?? existing?.sm_w         ?? 0) || 0,
      sm_l:         parseInt(edits.sm_l         ?? existing?.sm_l         ?? 0) || 0,
      streak_count: parseInt(edits.streak_count ?? existing?.streak_count ?? 0) || 0,
      streak_type:  (edits.streak_type ?? existing?.streak_type ?? '') || null,
      updated_at:   new Date().toISOString(),
    }

    if (existing) {
      await supabase.from('stat_seeds').update(payload).eq('id', existing.id)
    } else {
      await supabase.from('stat_seeds').insert(payload)
    }

    await loadSeeds()
    setSeedEdits(prev => { const n = { ...prev }; delete n[profileId]; return n })
    setSeedSaving(prev => ({ ...prev, [profileId]: false }))
    flash('Saved!')
  }

  function flash(text) {
    setMsg(text)
    setTimeout(() => setMsg(''), 2500)
  }

  async function copyInviteCode() {
    await navigator.clipboard.writeText(profile.teams.invite_code)
    flash('Invite code copied!')
  }

  const isDirty = (profileId) => !!seedEdits[profileId] && Object.keys(seedEdits[profileId]).length > 0

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <span className="logo-icon-sm">🕵️</span>
          <span className="header-team">Team Admin</span>
        </div>
        <nav className="header-nav">
          <button className="nav-link sign-out-btn" onClick={() => navigate('/')}>← Back</button>
        </nav>
      </header>

      <main className="main-content">

        {/* ---- Seed Stats ---- */}
        <section className="log-section">
          <h2 className="section-title">Seed Historical Stats</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            Enter prior stats for each member. These are added to logged game totals on the leaderboard.
            Streak only applies until a member logs their first real game.
          </p>

          {loading ? <p className="muted">Loading…</p> : (
            <div className="seed-table-wrap">
              <table className="seed-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th title="Total wins">W</th>
                    <th title="Total losses">L</th>
                    <th title="Spymaster wins">SM W</th>
                    <th title="Spymaster losses">SM L</th>
                    <th title="Current streak length">Streak #</th>
                    <th title="W or L">W/L</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} className={isDirty(m.id) ? 'seed-row dirty' : 'seed-row'}>
                      <td className="seed-name">
                        {m.display_name || '(no name)'}
                        {m.id === profile.id && <span className="you-badge">you</span>}
                      </td>
                      {['w','l','sm_w','sm_l','streak_count'].map(field => (
                        <td key={field}>
                          <input
                            type="number"
                            min="0"
                            className="seed-input"
                            value={getSeedField(m.id, field)}
                            onChange={e => setSeedField(m.id, field, e.target.value)}
                          />
                        </td>
                      ))}
                      <td>
                        <select
                          className="seed-select"
                          value={getSeedField(m.id, 'streak_type')}
                          onChange={e => setSeedField(m.id, 'streak_type', e.target.value)}
                        >
                          <option value="">—</option>
                          <option value="W">W</option>
                          <option value="L">L</option>
                        </select>
                      </td>
                      <td>
                        <button
                          className={`action-btn save-seed-btn ${isDirty(m.id) ? 'dirty-btn' : ''}`}
                          onClick={() => saveSeed(m.id)}
                          disabled={seedSaving[m.id]}
                        >
                          {seedSaving[m.id] ? '…' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {msg && <p className="success-msg" style={{ marginTop: 12 }}>{msg}</p>}
        </section>

        {/* ---- Invite Code ---- */}
        <section className="log-section">
          <h2 className="section-title">Invite Members</h2>
          <p className="muted">Share this code with anyone you want to join <strong>{profile?.teams?.name}</strong>.</p>
          <div className="invite-code-display large" onClick={copyInviteCode} title="Click to copy" style={{ marginTop: 12 }}>
            {profile?.teams?.invite_code}
            <span className="copy-hint">click to copy</span>
          </div>
        </section>

        {/* ---- Member Management ---- */}
        <section className="log-section">
          <h2 className="section-title">Team Members</h2>
          {loading ? <p>Loading…</p> : (
            <div className="members-list">
              {members.map(m => (
                <div key={m.id} className="member-row">
                  <span className="member-name">
                    {m.display_name || '(no name)'}
                    {m.is_admin && <span className="admin-badge">admin</span>}
                    {m.id === profile.id && <span className="you-badge">you</span>}
                  </span>
                  <div className="member-actions">
                    {m.id !== profile.id && (
                      <>
                        <button className="action-btn" onClick={() => toggleAdmin(m.id, m.is_admin)}>
                          {m.is_admin ? 'Remove admin' : 'Make admin'}
                        </button>
                        <button className="action-btn danger-btn" onClick={() => removeMember(m.id)}>
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  )
}
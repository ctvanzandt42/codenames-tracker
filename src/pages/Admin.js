import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

export default function Admin() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [members, setMembers] = useState([])
  const [seeds, setSeeds] = useState({})
  const [seedEdits, setSeedEdits] = useState({})
  const [loading, setLoading] = useState(true)
  const [seedSaving, setSeedSaving] = useState({})
  const [emailSending, setEmailSending] = useState(false)
  const [msg, setMsg] = useState('')

  // Ghost member form
  const [ghostName, setGhostName] = useState('')
  const [ghostAdding, setGhostAdding] = useState(false)

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
      .select('id, display_name, is_admin, is_active, is_angel, created_at')
      .eq('team_id', profile.team_id)
      .order('is_active', { ascending: false })
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

  async function toggleActive(memberId, currentVal) {
    await supabase.from('profiles').update({ is_active: !currentVal }).eq('id', memberId)
    await loadMembers()
    flash(currentVal ? 'Marked as emeritus.' : 'Marked as active.')
  }

  async function removeMember(memberId) {
    if (!window.confirm('Remove this member from the team? Their stats will be lost.')) return
    await supabase.from('profiles').update({ team_id: null }).eq('id', memberId)
    await loadMembers()
  }

  async function deleteGhost(memberId) {
    if (!window.confirm('Delete this ghost member and all their seeded stats?')) return
    await supabase.from('stat_seeds').delete().eq('profile_id', memberId)
    await supabase.from('profiles').delete().eq('id', memberId)
    await loadAll()
    flash('Member deleted.')
  }

  // ---- Ghost member creation ----

  async function addGhostMember(e) {
    e.preventDefault()
    if (!ghostName.trim()) return
    setGhostAdding(true)

    const newId = crypto.randomUUID()
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: newId,
        display_name: ghostName.trim(),
        team_id: profile.team_id,
        is_angel: true,
        is_active: false, // emeritus by default
        is_admin: false,
      })
      .select()
      .single()

    if (error) {
      flash(`❌ ${error.message}`)
    } else {
      setGhostName('')
      await loadAll()
      flash(`😇 "${data.display_name}" added. Set their stats in the Seed Stats table below.`)
    }
    setGhostAdding(false)
  }

  // ---- Seed stats ----

  function getSeedField(profileId, field) {
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

  const isDirty = (profileId) => !!seedEdits[profileId] && Object.keys(seedEdits[profileId]).length > 0

  // ---- Email backup ----

  async function sendBackup() {
    setEmailSending(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(
      `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/email-stats`,
      { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }
    )
    setEmailSending(false)
    if (res.ok) {
      const { sentTo } = await res.json()
      flash(`✅ Stats emailed to ${sentTo}`)
    } else if (res.status === 429) {
      const { error } = await res.json()
      flash(`⏳ ${error}`)
    } else {
      const txt = await res.text()
      flash(`❌ Failed: ${txt}`)
    }
  }

  function flash(text) {
    setMsg(text)
    setTimeout(() => setMsg(''), 3000)
  }

  function getJoinLink() {
    return `${window.location.origin}?invite=${profile?.teams?.invite_code}`
  }

  async function copyJoinLink() {
    await navigator.clipboard.writeText(getJoinLink())
    flash('Join link copied!')
  }

  const activeMembers = members.filter(m => m.is_active)
  const alumniMembers = members.filter(m => !m.is_active)

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

        {msg && <p className="flash-msg">{msg}</p>}

        {/* ---- Team Members ---- */}
        <section className="log-section">
          <h2 className="section-title">Team Members</h2>

          {loading ? <p className="muted">Loading…</p> : (<>

            {/* Active */}
            <div className="member-group-label">Active</div>
            <div className="members-list">
              {activeMembers.map(m => (
                <MemberRow key={m.id} m={m} currentId={profile.id}
                  onToggleAdmin={() => toggleAdmin(m.id, m.is_admin)}
                  onToggleActive={() => toggleActive(m.id, m.is_active)}
                  onRemove={() => removeMember(m.id)}
                  onDeleteGhost={() => deleteGhost(m.id)}
                />
              ))}
              {activeMembers.length === 0 && <p className="muted">None.</p>}
            </div>

            {/* Alumni */}
            {alumniMembers.length > 0 && (<>
              <div className="member-group-label" style={{ marginTop: 16 }}>Emeritus</div>
              <div className="members-list">
                {alumniMembers.map(m => (
                  <MemberRow key={m.id} m={m} currentId={profile.id}
                    onToggleAdmin={() => toggleAdmin(m.id, m.is_admin)}
                    onToggleActive={() => toggleActive(m.id, m.is_active)}
                    onRemove={() => removeMember(m.id)}
                    onDeleteGhost={() => deleteGhost(m.id)}
                  />
                ))}
              </div>
            </>)}

            {/* Add ghost member */}
            <div style={{ marginTop: 20 }}>
              <div className="member-group-label">Add a former member manually</div>
              <p className="muted" style={{ marginBottom: 10, fontSize: '0.82rem' }}>
                Creates a ghost profile with no login — use Seed Stats below to enter their historical numbers.
              </p>
              <form onSubmit={addGhostMember} style={{ display: 'flex', gap: 10 }}>
                <input
                  className="email-input"
                  style={{ flex: 1 }}
                  placeholder="Display name (e.g. Jordan)"
                  value={ghostName}
                  onChange={e => setGhostName(e.target.value)}
                  required
                />
                <button type="submit" className="action-btn" disabled={ghostAdding}
                  style={{ whiteSpace: 'nowrap' }}>
                  {ghostAdding ? '…' : '😇 Add member'}
                </button>
              </form>
            </div>

          </>)}
        </section>

        {/* ---- Seed Stats ---- */}
        <section className="log-section">
          <h2 className="section-title">Seed Historical Stats</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            Enter prior stats for any member. These are added to logged game totals on the leaderboard.
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
                        {m.is_angel && <span className="angel-badge">😇</span>}
                        {!m.is_active && !m.is_angel && <span className="alumni-badge">alumni</span>}
                        {m.id === profile.id && <span className="you-badge">you</span>}
                      </td>
                      {['w','l','sm_w','sm_l','streak_count'].map(field => (
                        <td key={field}>
                          <input type="number" min="0" className="seed-input"
                            value={getSeedField(m.id, field)}
                            onChange={e => setSeedField(m.id, field, e.target.value)}
                          />
                        </td>
                      ))}
                      <td>
                        <select className="seed-select"
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
                        >{seedSaving[m.id] ? '…' : 'Save'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---- Email Backup ---- */}
        <section className="log-section">
          <h2 className="section-title">Email Stats Backup</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            Sends a full stats snapshot — leaderboard and recent games — to your email address.
          </p>
          <button className="btn-magic" style={{ width: 'auto', padding: '11px 28px' }}
            onClick={sendBackup} disabled={emailSending}>
            {emailSending ? '📤 Sending…' : '📧 Email stats backup'}
          </button>
        </section>

        {/* ---- Invite Link ---- */}
        <section className="log-section">
          <h2 className="section-title">Invite Members</h2>
          <p className="muted" style={{ marginBottom: 14 }}>
            Send this link to anyone you want to join <strong>{profile?.teams?.name}</strong>.
            They'll sign in with Google and land straight on the join screen.
          </p>
          <div className="join-link-row">
            <code className="join-link-display">{getJoinLink()}</code>
            <button className="action-btn" onClick={copyJoinLink}>Copy link</button>
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: '0.8rem' }}>
            Invite code: <strong>{profile?.teams?.invite_code}</strong> (for manual entry)
          </p>
        </section>

      </main>
    </div>
  )
}

function MemberRow({ m, currentId, onToggleAdmin, onToggleActive, onRemove, onDeleteGhost }) {
  return (
    <div className="member-row">
      <span className="member-name">
        {m.display_name || '(no name)'}
        {m.is_angel && <span className="angel-badge">😇</span>}
        {m.is_admin && <span className="admin-badge">admin</span>}
        {m.id === currentId && <span className="you-badge">you</span>}
      </span>
      <div className="member-actions">
        {/* Active toggle — always available except for yourself */}
        {m.id !== currentId && (
          <button className="action-btn" onClick={onToggleActive}>
            {m.is_active ? 'Mark emeritus' : 'Restore'}
          </button>
        )}
        {/* Admin toggle — real users only, not yourself */}
        {!m.is_angel && m.id !== currentId && (
          <button className="action-btn" onClick={onToggleAdmin}>
            {m.is_admin ? 'Remove admin' : 'Make admin'}
          </button>
        )}
        {/* Ghost: delete entirely; Real: remove from team */}
        {m.id !== currentId && (
          m.is_angel
            ? <button className="action-btn danger-btn" onClick={onDeleteGhost}>Delete</button>
            : <button className="action-btn danger-btn" onClick={onRemove}>Remove</button>
        )}
      </div>
    </div>
  )
}
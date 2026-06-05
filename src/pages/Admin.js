import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

export default function Admin() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (profile) {
      if (!profile.is_admin) navigate('/')
      else loadMembers()
    }
  }, [profile])

  async function loadMembers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, is_admin, created_at')
      .eq('team_id', profile.team_id)
      .order('created_at')
    setMembers(data || [])
    setLoading(false)
  }

  async function toggleAdmin(memberId, currentVal) {
    await supabase.from('profiles').update({ is_admin: !currentVal }).eq('id', memberId)
    await loadMembers()
    setMsg('Updated!')
    setTimeout(() => setMsg(''), 2000)
  }

  async function removeMember(memberId) {
    if (!window.confirm('Remove this member from the team?')) return
    await supabase.from('profiles').update({ team_id: null }).eq('id', memberId)
    await loadMembers()
  }

  async function copyInviteCode() {
    await navigator.clipboard.writeText(profile.teams.invite_code)
    setMsg('Invite code copied!')
    setTimeout(() => setMsg(''), 2000)
  }

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
        <section className="log-section">
          <h2 className="section-title">Invite Members</h2>
          <p className="muted">Share this code with anyone you want to join <strong>{profile?.teams?.name}</strong>.</p>
          <div className="invite-code-display large" onClick={copyInviteCode} title="Click to copy">
            {profile?.teams?.invite_code}
            <span className="copy-hint">click to copy</span>
          </div>
          {msg && <p className="success-msg">{msg}</p>}
        </section>

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
                        <button
                          className="action-btn"
                          onClick={() => toggleAdmin(m.id, m.is_admin)}
                        >{m.is_admin ? 'Remove admin' : 'Make admin'}</button>
                        <button
                          className="action-btn danger-btn"
                          onClick={() => removeMember(m.id)}
                        >Remove</button>
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

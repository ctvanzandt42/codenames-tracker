import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

export default function Onboarding() {
  const { user, memberships, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const isAddingTeam = memberships?.length > 0 // already on at least one team
  const [mode, setMode] = useState(null) // 'create' | 'join'
  const [teamName, setTeamName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('invite') || localStorage.getItem('pendingInvite')
    if (code) {
      localStorage.removeItem('pendingInvite')
      setInviteCode(code.toUpperCase())
      setMode('join')
    }
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { data: team, error: teamErr } = await supabase
        .from('teams').insert({ name: teamName }).select().single()
      if (teamErr) throw teamErr

      if (displayName.trim()) {
        await supabase.from('profiles').update({ display_name: displayName.trim() }).eq('id', user.id)
      }

      const { error: memberErr } = await supabase
        .from('team_members')
        .insert({ team_id: team.id, profile_id: user.id, is_admin: true })
      if (memberErr) throw memberErr

      await refreshProfile()
      if (isAddingTeam) navigate('/')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function handleJoin(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { data: team, error: teamErr } = await supabase
        .from('teams').select('id').eq('invite_code', inviteCode.trim().toUpperCase()).single()
      if (teamErr || !team) throw new Error('Invalid invite code. Check with your team admin.')

      if (displayName.trim()) {
        await supabase.from('profiles').update({ display_name: displayName.trim() }).eq('id', user.id)
      }

      const { error: memberErr } = await supabase
        .from('team_members')
        .insert({ team_id: team.id, profile_id: user.id })
      if (memberErr) throw memberErr

      await refreshProfile()
      if (isAddingTeam) navigate('/')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="login-page">
      <div className="login-card onboarding-card">
        {isAddingTeam && (
          <button className="back-btn" onClick={() => navigate('/')} style={{ marginBottom: 16 }}>
            ← Back
          </button>
        )}
        <div className="login-logo">
          <span className="logo-icon">🕵️</span>
          <h1>{isAddingTeam ? 'Add a Team' : 'Welcome!'}</h1>
          <p className="logo-sub">{isAddingTeam ? 'Create or join another team' : 'Set up your team'}</p>
        </div>

        {!mode && (
          <div className="onboarding-choices">
            <button className="btn-choice" onClick={() => setMode('create')}>
              <span>🏗️</span>
              <strong>Create a new team</strong>
              <small>You'll be the admin</small>
            </button>
            <button className="btn-choice" onClick={() => setMode('join')}>
              <span>🤝</span>
              <strong>Join an existing team</strong>
              <small>You'll need an invite code or link</small>
            </button>
          </div>
        )}

        {mode && (
          <form onSubmit={mode === 'create' ? handleCreate : handleJoin}>
            <button type="button" className="back-btn" onClick={() => { setMode(null); setError('') }}>
              ← Back
            </button>

            {!isAddingTeam && (<>
              <label className="field-label">Your display name (optional)</label>
              <input
                className="email-input"
                placeholder="e.g. Alex"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
              />
            </>)}

            {mode === 'create' ? (
              <>
                <label className="field-label">Team name</label>
                <input
                  className="email-input"
                  placeholder="e.g. The Squid Squad"
                  value={teamName}
                  onChange={e => setTeamName(e.target.value)}
                  required
                />
              </>
            ) : (
              <>
                <label className="field-label">Invite code</label>
                <input
                  className="email-input"
                  placeholder="e.g. A3B9C2D1"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  required
                />
              </>
            )}

            {error && <p className="error-msg">{error}</p>}

            <button type="submit" className="btn-magic" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'create' ? '🚀 Create team' : '✅ Join team'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

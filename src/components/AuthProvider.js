import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [memberships, setMemberships] = useState(null) // null = not loaded yet
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setMemberships(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    let { data: profileData } = await supabase
      .from('profiles')
      .select('id, display_name, is_angel')
      .eq('id', userId)
      .maybeSingle()

    if (!profileData) {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('profiles').insert({
        id: userId,
        display_name: user?.user_metadata?.full_name
          || user?.user_metadata?.name
          || user?.email?.split('@')[0]
          || null
      })
      const { data: retried } = await supabase
        .from('profiles')
        .select('id, display_name, is_angel')
        .eq('id', userId)
        .maybeSingle()
      profileData = retried
    }

    const { data: membershipData } = await supabase
      .from('team_members')
      .select('*, teams(*)')
      .eq('profile_id', userId)

    setProfile(profileData)
    setMemberships(membershipData || [])
    setLoading(false)
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.id)
  }

  async function signInWithGoogle(redirectTo = window.location.origin) {
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  // Convenience helpers consumed by pages
  function isAdminOf(teamId) {
    return memberships?.some(m => m.team_id === teamId && m.is_admin) ?? false
  }

  return (
    <AuthContext.Provider value={{
      user, profile, memberships, loading,
      isAdminOf, signInWithGoogle, signOut, refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

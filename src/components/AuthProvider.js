import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, teams(*)')
      .eq('id', userId)
      .maybeSingle()

    // If no profile row exists (e.g. manually deleted), create one and retry
    if (!data && !error) {
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
        .select('*, teams(*)')
        .eq('id', userId)
        .maybeSingle()
      setProfile(retried)
    } else {
      setProfile(data)
    }
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

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './components/AuthProvider'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import LogGame from './pages/LogGame'
import Admin from './pages/Admin'
import GameHistory from './pages/GameHistory'
import './App.css'

function AppRoutes() {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="login-page">
        <div className="loading-spinner">🕵️</div>
      </div>
    )
  }

  if (!user) return <Login />
  if (!profile?.team_id) return <Onboarding />

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/log" element={<LogGame />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/history" element={<GameHistory />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

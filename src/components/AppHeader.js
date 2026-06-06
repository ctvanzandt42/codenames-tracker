import { useTheme } from '../lib/theme'

export default function AppHeader({ title, children }) {
  const { theme, toggle } = useTheme()

  return (
    <header className="app-header">
      <div className="header-left">
        <span className="logo-icon-sm">🕵️</span>
        <span className="header-team">{title}</span>
      </div>
      <nav className="header-nav">
        {children}
        <button
          onClick={toggle}
          className="nav-link theme-toggle"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀' : '🌙'}
        </button>
      </nav>
    </header>
  )
}

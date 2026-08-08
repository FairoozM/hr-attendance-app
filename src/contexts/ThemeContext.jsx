import { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useUserPreferences } from './UserPreferencesContext'
import { PREF_THEME } from '../constants/userPreferenceKeys'

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

const VALID_THEMES = new Set(['dark', 'comfort'])

const ThemeContext = createContext(null)

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light'
}

function applyThemeToDocument(theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  root.classList.toggle('dark', theme === 'dark')
}

export function ThemeProvider({ children }) {
  const location = useLocation()
  const { user } = useAuth()
  const { ready, getPref, setPref, prefsVersion } = useUserPreferences()
  const onLoginRoute = location.pathname === '/login'
  const [themePreference, setThemePreference] = useState('comfort')
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)
  const skipPrefWrite = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia(SYSTEM_THEME_QUERY)
    const update = () => setSystemTheme(query.matches ? 'dark' : 'light')

    update()
    if (query.addEventListener) query.addEventListener('change', update)
    else query.addListener(update)

    return () => {
      if (query.removeEventListener) query.removeEventListener('change', update)
      else query.removeListener(update)
    }
  }, [])

  useEffect(() => {
    if (!user || !ready) return
    const saved = getPref(PREF_THEME, null)
    const normalizedTheme = saved && VALID_THEMES.has(saved) ? saved : 'comfort'
    setThemePreference((current) => {
      skipPrefWrite.current = current !== normalizedTheme
      return normalizedTheme
    })
  }, [user, ready, prefsVersion, getPref])

  const resolvedTheme = onLoginRoute
    ? systemTheme
    : themePreference

  useEffect(() => {
    applyThemeToDocument(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    if (user && ready && !skipPrefWrite.current) {
      setPref(PREF_THEME, themePreference)
    }
    skipPrefWrite.current = false
  }, [themePreference, user, ready, setPref])

  const toggleTheme = useCallback(() => {
    setThemePreference((prev) => (prev === 'dark' ? 'comfort' : 'dark'))
  }, [])

  const setTheme = useCallback((nextTheme) => {
    setThemePreference(VALID_THEMES.has(nextTheme) ? nextTheme : 'comfort')
  }, [])

  const value = useMemo(
    () => ({
      themePreference,
      resolvedTheme,
      setTheme,
      setThemePreference: setTheme,
      toggleTheme,
    }),
    [themePreference, resolvedTheme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}

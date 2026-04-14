import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const THEME_STORAGE_KEY = 'hr-attendance-theme'
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

const VALID_THEMES = new Set(['light', 'dark', 'system'])

const ThemeContext = createContext(null)

function getStoredThemePreference() {
  if (typeof window === 'undefined') return 'system'
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
  return VALID_THEMES.has(saved) ? saved : 'system'
}

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light'
}

function applyThemeToDocument(theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  root.classList.toggle('dark', theme === 'dark')
}

export function ThemeProvider({ children }) {
  const [themePreference, setThemePreference] = useState(getStoredThemePreference)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)

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

  const resolvedTheme = themePreference === 'system' ? systemTheme : themePreference

  useEffect(() => {
    applyThemeToDocument(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference)
  }, [themePreference])

  const toggleTheme = useCallback(() => {
    setThemePreference((prev) => {
      const activeTheme = prev === 'system' ? systemTheme : prev
      return activeTheme === 'dark' ? 'light' : 'dark'
    })
  }, [systemTheme])

  const setTheme = useCallback((nextTheme) => {
    setThemePreference(VALID_THEMES.has(nextTheme) ? nextTheme : 'system')
  }, [])

  const value = useMemo(
    () => ({
      themePreference,
      resolvedTheme,
      isSystemTheme: themePreference === 'system',
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

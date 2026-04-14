import { MoonStar, SunMedium } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

export function ThemeToggle() {
  const { resolvedTheme, themePreference, toggleTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const nextTheme = isDark ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
      className="group relative inline-flex h-11 items-center gap-2 overflow-hidden rounded-full border border-[color:var(--theme-border)] bg-[color:var(--theme-glass-soft)] px-2.5 text-xs font-semibold tracking-[0.12em] text-[color:var(--theme-text-soft)] uppercase shadow-[var(--theme-shadow-sm)] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--theme-border-strong)] hover:bg-[color:var(--theme-glass-raised)] hover:text-[color:var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-soft)]"
    >
      <span className="relative inline-flex h-6 w-11 items-center rounded-full border border-[color:var(--theme-border-subtle)] bg-[color:var(--theme-surface-raised)] p-0.5 shadow-inner transition-colors duration-300">
        <span
          className={`absolute left-0.5 h-4 w-4 rounded-full bg-[color:var(--theme-accent)] shadow-[0_4px_14px_rgba(99,102,241,0.38)] transition-transform duration-300 ${isDark ? 'translate-x-5' : 'translate-x-0'}`}
        />
        <SunMedium
          size={12}
          className={`relative z-10 ml-0.5 transition-colors duration-300 ${isDark ? 'text-[color:var(--theme-text-dim)]' : 'text-[color:var(--theme-text)]'}`}
        />
        <MoonStar
          size={12}
          className={`relative z-10 ml-auto mr-0.5 transition-colors duration-300 ${isDark ? 'text-[color:var(--theme-text)]' : 'text-[color:var(--theme-text-dim)]'}`}
        />
      </span>

      <span className="hidden sm:inline">{isDark ? 'Dark' : 'Light'}</span>

      {themePreference === 'system' ? (
        <span className="rounded-full border border-[color:var(--theme-border-subtle)] bg-[color:var(--theme-surface)] px-1.5 py-0.5 text-[10px] leading-none tracking-[0.16em] text-[color:var(--theme-text-muted)]">
          Auto
        </span>
      ) : null}
    </button>
  )
}

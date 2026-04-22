import { useTheme } from '../contexts/ThemeContext'

const THEMES = [
  {
    id: 'light',
    label: 'Light',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    ),
  },
  {
    id: 'dark',
    label: 'Dark',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  },
  {
    id: 'comfort',
    label: 'Comfort',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
]

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label="Select theme"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        padding: '3px',
        borderRadius: '999px',
        border: '1px solid var(--theme-border)',
        background: 'var(--theme-surface)',
        boxShadow: 'var(--theme-shadow-sm)',
      }}
    >
      {THEMES.map(({ id, label, icon }) => {
        const active = resolvedTheme === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            aria-pressed={active}
            aria-label={`${label} theme`}
            title={`Switch to ${label} theme`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '999px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: active ? '600' : '500',
              letterSpacing: '0.04em',
              lineHeight: 1,
              transition: 'background 0.18s, color 0.18s, box-shadow 0.18s',
              background: active
                ? 'var(--theme-surface-raised)'
                : 'transparent',
              color: active
                ? 'var(--theme-text)'
                : 'var(--theme-text-muted)',
              boxShadow: active
                ? 'var(--theme-shadow-sm)'
                : 'none',
            }}
          >
            {icon}
            <span className="hidden sm:inline" style={{ display: 'inline' }}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

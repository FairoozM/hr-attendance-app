import { useAIPlanner } from '../../contexts/AIPlannerContext'

export function AIAssistPanel() {
  const { suggestions, tasks, setActiveTaskId } = useAIPlanner()

  const done  = tasks.filter((t) => t.status === 'done').length
  const total = tasks.length
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <aside className="aip-assist">
      <div className="aip-assist__head">
        <span>🤖</span> AI Assist
      </div>

      {/* Progress overview */}
      <div style={{ padding: '0.75rem', background: 'var(--theme-glass-soft)', border: '1px solid var(--theme-border-subtle)', borderRadius: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--theme-text-muted)', fontWeight: 600 }}>
          <span>Today's Progress</span>
          <span style={{ color: 'var(--theme-primary)' }}>{pct}%</span>
        </div>
        <div style={{ height: 5, background: 'var(--theme-surface-soft)', borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #8b5cf6, #6366f1)', borderRadius: 20, transition: 'width 0.5s ease' }} />
        </div>
        <div style={{ marginTop: '0.4rem', fontSize: '0.68rem', color: 'var(--theme-text-dim)' }}>
          {done} of {total} tasks complete
        </div>
      </div>

      {/* AI Suggestions */}
      {suggestions.length === 0 ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-dim)', textAlign: 'center', padding: '1rem 0' }}>
          All clear — no suggestions right now.
        </div>
      ) : (
        suggestions.map((s, i) => (
          <div
            key={i}
            className="aip-suggestion"
            onClick={() => s.taskId && setActiveTaskId(s.taskId)}
            style={{ cursor: s.taskId ? 'pointer' : 'default', borderLeftColor: s.color, borderLeftWidth: 3 }}
          >
            <div className="aip-suggestion__icon-row">
              <span className="aip-suggestion__icon">{s.icon}</span>
              <span className="aip-suggestion__label">{s.title}</span>
            </div>
            <div className="aip-suggestion__body">{s.body}</div>
          </div>
        ))
      )}

      {/* Footer tip */}
      <div style={{ marginTop: 'auto', fontSize: '0.68rem', color: 'var(--theme-text-dim)', lineHeight: 1.5, padding: '0.6rem 0.75rem', background: 'var(--theme-surface-dark)', borderRadius: 8 }}>
        💡 AI scoring runs automatically — no manual sorting needed.
      </div>
    </aside>
  )
}

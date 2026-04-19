import { Zap, AlertTriangle, Clock, Layers, ShieldOff, RefreshCw } from 'lucide-react'

const ICON_MAP = {
  zap:            <Zap size={15} />,
  'alert-triangle': <AlertTriangle size={15} />,
  clock:          <Clock size={15} />,
  layers:         <Layers size={15} />,
  'shield-off':   <ShieldOff size={15} />,
}

const TYPE_COLORS = {
  next:    'var(--theme-primary)',
  overdue: '#f87171',
  today:   '#fbbf24',
  batch:   '#60a5fa',
  blocked: '#fb923c',
}

export function AIAssistPanel({ suggestions = [], onTaskSelect, loading = false }) {
  return (
    <aside className="ai-assist-panel">
      <div className="ai-assist-panel__header">
        <span className="ai-assist-panel__title">
          <Zap size={14} aria-hidden /> AI Assistant
        </span>
        {loading && <RefreshCw size={12} className="ai-assist-panel__spin" aria-label="Loading" />}
      </div>

      {suggestions.length === 0 && !loading && (
        <div className="ai-assist-panel__empty">
          <p>All caught up!</p>
          <p>Add tasks to see AI suggestions.</p>
        </div>
      )}

      <div className="ai-assist-panel__list">
        {suggestions.map((s, i) => (
          <div
            key={i}
            className={`ai-assist-card ai-assist-card--${s.type}`}
            style={{ '--card-color': TYPE_COLORS[s.type] || 'var(--theme-primary)' }}
            onClick={() => s.taskId && onTaskSelect && onTaskSelect(s.taskId)}
            role={s.taskId ? 'button' : undefined}
            tabIndex={s.taskId ? 0 : undefined}
            onKeyDown={e => e.key === 'Enter' && s.taskId && onTaskSelect && onTaskSelect(s.taskId)}
          >
            <div className="ai-assist-card__icon">
              {ICON_MAP[s.icon] || <Zap size={15} />}
            </div>
            <div className="ai-assist-card__body">
              <span className="ai-assist-card__label">{s.title}</span>
              <span className="ai-assist-card__msg">{s.message}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="ai-assist-panel__footer">
        <span className="ai-assist-panel__footer-note">
          Rule-based · updates on task change
        </span>
        {/* Future: Google Calendar, Email, Slack stubs */}
        <div className="ai-assist-panel__integrations">
          <span className="ai-assist-panel__integration-stub" title="Google Calendar sync — coming soon">📅</span>
          <span className="ai-assist-panel__integration-stub" title="Email capture — coming soon">✉️</span>
          <span className="ai-assist-panel__integration-stub" title="Slack capture — coming soon">💬</span>
        </div>
      </div>
    </aside>
  )
}

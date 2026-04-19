/**
 * Today Plan — AI-generated daily schedule (replaces old ProjectDetailPage)
 * Shows time-blocked calendar view of today's tasks.
 */
import { useAIPlanner } from '../../contexts/AIPlannerContext'
import { AIAssistPanel } from '../../components/planner/AIAssistPanel'
import { TaskDrawer } from '../../components/planner/TaskDrawer'
import { formatTime, estimateDuration } from '../../lib/aiEngine'
import './planner.css'
import './projects.css'

const HOURS = Array.from({ length: 10 }, (_, i) => i + 9) // 9 AM – 6 PM

function EmptyHour({ hour }) {
  return (
    <div className="aip-time-slot">
      <div className="aip-time-label">
        {hour % 12 === 0 ? 12 : hour % 12}{hour < 12 ? 'AM' : 'PM'}
      </div>
      <div style={{ flex: 1, minHeight: '3.5rem' }} />
    </div>
  )
}

function TimeBlock({ task, onClick }) {
  const cat = task.category
  const duration = estimateDuration(task)

  return (
    <div
      className={`aip-time-block ${task.energyType} ${task.status === 'blocked' ? 'blocked' : ''}`}
      onClick={() => onClick(task.id)}
      style={{ borderLeftColor: cat?.color, borderLeftWidth: 3 }}
    >
      <div className="aip-time-block__title">
        {cat?.icon} {task.title}
        {task.status === 'done' && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', opacity: 0.6 }}>✓</span>}
        {task.status === 'blocked' && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: '#fb923c' }}>🚫</span>}
      </div>
      <div className="aip-time-block__range">
        {formatTime(task.scheduledStart)} – {formatTime(task.scheduledEnd)} · {duration} min
        {task.energyType === 'deep' && <span style={{ marginLeft: '0.5rem', color: '#22d3ee', fontSize: '0.65rem' }}>🧠 Deep Work</span>}
      </div>
    </div>
  )
}

export default function ProjectDetailPage() {
  const { tasks, setActiveTaskId } = useAIPlanner()

  const today = new Date().toDateString()
  const scheduled = tasks.filter(
    (t) => t.scheduledStart && new Date(t.scheduledStart).toDateString() === today
  )
  const overflow = tasks.filter(
    (t) => t.overflow && t.status !== 'done'
  )

  // Build hour → tasks map
  const byHour = {}
  scheduled.forEach((t) => {
    const h = new Date(t.scheduledStart).getHours()
    if (!byHour[h]) byHour[h] = []
    byHour[h].push(t)
  })

  const todayStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const totalMinutes = scheduled.reduce((acc, t) => acc + estimateDuration(t), 0)
  const doneCount = scheduled.filter((t) => t.status === 'done').length

  return (
    <div className="aip-layout">
      <div className="aip-main">
        {/* Header */}
        <div className="aip-page-header">
          <div>
            <h1 className="aip-page-title">Today's Plan</h1>
            <p className="aip-page-subtitle">
              {todayStr} · {scheduled.length} tasks · ~{Math.round(totalMinutes / 60 * 10) / 10}h scheduled · {doneCount} done
            </p>
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--theme-text-dim)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(6,182,212,0.3)' }} />
            🧠 Deep Work (morning)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--theme-text-dim)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--theme-glass-soft)', border: '1px solid var(--theme-border)' }} />
            ⚡ Shallow Work
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--theme-text-dim)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(249,115,22,0.2)' }} />
            🚫 Blocked (rescheduled)
          </div>
        </div>

        {/* Calendar */}
        {scheduled.length === 0 ? (
          <div className="aip-time-empty">
            <div style={{ fontSize: '2rem' }}>📅</div>
            <div style={{ fontWeight: 600, color: 'var(--theme-text-muted)' }}>No tasks scheduled for today</div>
            <div>Add tasks on the Planner page and they'll appear here</div>
          </div>
        ) : (
          <div style={{ padding: '0 0 0 5.25rem', position: 'relative' }}>
            <div className="aip-today-grid">
              {HOURS.map((hour) => (
                <div key={hour} className="aip-time-slot">
                  <div className="aip-time-label">
                    {hour % 12 === 0 ? 12 : hour % 12}{hour < 12 ? 'am' : 'pm'}
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem', paddingTop: '0.3rem', minHeight: '3.5rem' }}>
                    {(byHour[hour] || []).map((t) => (
                      <TimeBlock key={t.id} task={t} onClick={setActiveTaskId} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Overflow / unscheduled tasks */}
        {overflow.length > 0 && (
          <div>
            <div className="aip-section-head">
              <span className="aip-section-title">⚠️ Couldn't Schedule</span>
              <span className="aip-section-count">{overflow.length}</span>
            </div>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 12, fontSize: '0.82rem', color: 'var(--theme-text-muted)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {overflow.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => setActiveTaskId(t.id)}>
                  <span>{t.category?.icon}</span>
                  <span style={{ fontWeight: 600 }}>{t.title}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#fb923c' }}>
                    {t.status === 'blocked' ? '🚫 Blocked' : '⏭ Overflow'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <AIAssistPanel />
      <TaskDrawer />
    </div>
  )
}

/**
 * AI Planner Dashboard — overview, workload, category breakdown, energy split
 */
import { useMemo } from 'react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'
import { AIAssistPanel } from '../../components/planner/AIAssistPanel'
import { TaskDrawer } from '../../components/planner/TaskDrawer'
import { analyseWorkload, estimateDuration, getCategoryById } from '../../lib/aiEngine'
import './planner.css'
import './projects.css'

const CATEGORY_IDS = ['finance', 'operations', 'communication', 'marketing', 'admin', 'general']

export default function ProjectDashboardPage() {
  const { tasks, setActiveTaskId } = useAIPlanner()

  const todo    = tasks.filter((t) => t.status === 'todo')
  const blocked = tasks.filter((t) => t.status === 'blocked')
  const done    = tasks.filter((t) => t.status === 'done')
  const total   = tasks.length
  const pct     = total > 0 ? Math.round((done.length / total) * 100) : 0

  const overdue = todo.filter((t) => t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString()))
  const dueToday = todo.filter((t) => t.dueDate === new Date().toISOString().slice(0, 10))

  const totalMins = tasks.filter((t) => t.status !== 'done').reduce((acc, t) => acc + estimateDuration(t), 0)

  // Category breakdown
  const catBreakdown = useMemo(() => {
    const counts = {}
    tasks.forEach((t) => {
      const id = t.category?.id || 'general'
      counts[id] = (counts[id] || 0) + 1
    })
    return CATEGORY_IDS
      .map((id) => ({ id, count: counts[id] || 0, cat: getCategoryById(id) }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [tasks])

  const maxCat = catBreakdown[0]?.count || 1

  // Energy split
  const deepCount    = tasks.filter((t) => t.energyType === 'deep').length
  const shallowCount = tasks.filter((t) => t.energyType === 'shallow').length

  // Workload
  const workload = useMemo(() => analyseWorkload(tasks), [tasks])

  // Top 5 priority tasks
  const topTasks = [...todo]
    .filter((t) => t.status !== 'blocked')
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, 5)

  return (
    <div className="aip-layout">
      <div className="aip-main">
        {/* Header */}
        <div className="aip-page-header">
          <div>
            <h1 className="aip-page-title">AI Planner Dashboard</h1>
            <p className="aip-page-subtitle">Workload, category breakdown & energy analysis</p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="aip-dash-grid">
          <div className="aip-stat-card">
            <div className="aip-stat-value" style={{ color: 'var(--theme-primary)' }}>{total}</div>
            <div className="aip-stat-label">Total Tasks</div>
          </div>
          <div className="aip-stat-card">
            <div className="aip-stat-value" style={{ color: '#60a5fa' }}>{todo.length}</div>
            <div className="aip-stat-label">To Do</div>
          </div>
          <div className="aip-stat-card">
            <div className="aip-stat-value" style={{ color: '#4ade80' }}>{done.length}</div>
            <div className="aip-stat-label">Done</div>
          </div>
          <div className="aip-stat-card">
            <div className="aip-stat-value" style={{ color: blocked.length > 0 ? '#fb923c' : 'var(--theme-text-dim)' }}>{blocked.length}</div>
            <div className="aip-stat-label">Blocked</div>
          </div>
          <div className="aip-stat-card">
            <div className="aip-stat-value" style={{ color: overdue.length > 0 ? '#f87171' : 'var(--theme-text-dim)' }}>{overdue.length}</div>
            <div className="aip-stat-label">Overdue</div>
          </div>
          <div className="aip-stat-card">
            <div className="aip-stat-value" style={{ color: '#fbbf24' }}>{dueToday.length}</div>
            <div className="aip-stat-label">Due Today</div>
          </div>
          <div className="aip-stat-card">
            <div className="aip-stat-value" style={{ color: '#22d3ee', fontSize: '1.4rem' }}>
              {Math.round(totalMins / 60 * 10) / 10}h
            </div>
            <div className="aip-stat-label">Work Remaining</div>
          </div>
          <div className="aip-stat-card">
            <div className="aip-stat-value" style={{ color: '#a78bfa' }}>{pct}%</div>
            <div className="aip-stat-label">Complete</div>
          </div>
        </div>

        {/* Overall progress bar */}
        <div className="aip-dash-card">
          <div className="aip-dash-card-title">Overall Progress</div>
          <div style={{ height: 8, background: 'var(--theme-surface-soft)', borderRadius: 20, overflow: 'hidden', marginBottom: '0.5rem' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #8b5cf6, #6366f1)', borderRadius: 20, transition: 'width 0.6s ease' }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-dim)' }}>
            {done.length} of {total} tasks complete · {pct}%
          </div>
        </div>

        <div className="aip-dash-row">
          {/* Category breakdown */}
          <div className="aip-dash-card">
            <div className="aip-dash-card-title">By Category</div>
            {catBreakdown.map(({ id, count, cat }) => (
              <div key={id} className="aip-cat-row">
                <div className="aip-cat-label">
                  {cat.icon} {cat.label}
                </div>
                <div className="aip-cat-bar-wrap">
                  <div
                    className="aip-cat-bar-fill"
                    style={{ width: `${(count / maxCat) * 100}%`, background: cat.color }}
                  />
                </div>
                <div className="aip-cat-count">{count}</div>
              </div>
            ))}
          </div>

          {/* Energy split */}
          <div className="aip-dash-card">
            <div className="aip-dash-card-title">Energy Split</div>
            <div className="aip-energy-row">
              <svg width="80" height="80" viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
                <circle cx="18" cy="18" r="15.9" fill="transparent" stroke="var(--theme-surface-soft)" strokeWidth="3.5" />
                {deepCount + shallowCount > 0 && (
                  <>
                    <circle
                      cx="18" cy="18" r="15.9"
                      fill="transparent"
                      stroke="#22d3ee"
                      strokeWidth="3.5"
                      strokeDasharray={`${(deepCount / (deepCount + shallowCount)) * 100} 100`}
                      strokeDashoffset="25"
                      strokeLinecap="round"
                    />
                    <circle
                      cx="18" cy="18" r="15.9"
                      fill="transparent"
                      stroke="#8b5cf6"
                      strokeWidth="3.5"
                      strokeDasharray={`${(shallowCount / (deepCount + shallowCount)) * 100} 100`}
                      strokeDashoffset={`${25 - (deepCount / (deepCount + shallowCount)) * 100}`}
                      strokeLinecap="round"
                    />
                  </>
                )}
                <text x="18" y="21" textAnchor="middle" fontSize="7" fill="var(--theme-text-soft)" fontWeight="700">
                  {deepCount + shallowCount}
                </text>
              </svg>
              <div className="aip-energy-legend">
                <div className="aip-energy-item">
                  <div className="aip-energy-dot" style={{ background: '#22d3ee' }} />
                  🧠 Deep Work <strong style={{ marginLeft: 4 }}>{deepCount}</strong>
                </div>
                <div className="aip-energy-item">
                  <div className="aip-energy-dot" style={{ background: '#8b5cf6' }} />
                  ⚡ Shallow Work <strong style={{ marginLeft: 4 }}>{shallowCount}</strong>
                </div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--theme-text-dim)' }}>
                  Deep work auto-scheduled in AM
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Workload distribution */}
        {workload.length > 0 && (
          <div className="aip-dash-card">
            <div className="aip-dash-card-title">Workload Distribution</div>
            <div className="aip-workload-bar">
              {workload.map(({ day, minutes, overloaded }) => (
                <div key={day} className="aip-workload-row">
                  <div className="aip-workload-label">
                    {new Date(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </div>
                  <div className="aip-workload-track">
                    <div
                      className={`aip-workload-fill ${overloaded ? 'overloaded' : 'normal'}`}
                      style={{ width: `${Math.min((minutes / 480) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="aip-workload-val" style={{ color: overloaded ? '#f97316' : 'var(--theme-text-dim)' }}>
                    {Math.round(minutes / 60 * 10) / 10}h{overloaded ? ' ⚠️' : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top 5 priority tasks */}
        {topTasks.length > 0 && (
          <div className="aip-dash-card">
            <div className="aip-dash-card-title">🔥 Top Priority Tasks</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {topTasks.map((t, i) => (
                <div
                  key={t.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0.75rem', background: 'var(--theme-glass-soft)', border: '1px solid var(--theme-border-subtle)', borderRadius: 9, cursor: 'pointer', transition: 'background 0.12s' }}
                  onClick={() => setActiveTaskId(t.id)}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--theme-surface-soft)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--theme-glass-soft)'}
                >
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--theme-text-dim)', width: '1.2rem' }}>#{i + 1}</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, flex: 1, color: 'var(--theme-text-soft)' }}>{t.title}</span>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: t.category?.color }}>{t.category?.icon} {t.category?.label}</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '0.1rem 0.45rem', borderRadius: 20, background: `${t.priorityScore >= 65 ? '#ef4444' : '#f97316'}18`, color: t.priorityScore >= 65 ? '#f87171' : '#fb923c' }}>
                    {t.priorityScore}
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

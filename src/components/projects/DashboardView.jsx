import { useMemo } from 'react'
import { CheckCircle, AlertCircle, Clock, TrendingUp, List, Calendar } from 'lucide-react'
import {
  flattenTasks, getOverdueTasks, getBlockedTasks, getUpcomingTasks,
  TASK_STATUSES, TASK_PRIORITIES, STATUS_COLORS, PRIORITY_COLORS, formatDueDate,
} from '../../utils/projectUtils'

function StatCard({ label, value, icon, color, subtitle }) {
  return (
    <div className="pm-widget" style={{ '--widget-color': color }}>
      <div className="pm-widget-icon">{icon}</div>
      <div className="pm-widget-value" style={{ color }}>{value}</div>
      <div className="pm-widget-label">{label}</div>
      {subtitle && <div style={{ fontSize: '0.7rem', color: 'var(--theme-text-dim)', marginTop: '0.2rem' }}>{subtitle}</div>}
    </div>
  )
}

function ChartBar({ label, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="pm-chart-bar-row">
      <span className="pm-chart-bar-label">{label}</span>
      <div className="pm-chart-bar-track">
        <div className="pm-chart-bar-fill" style={{ width: `${pct}%`, '--bar-color': color }} />
      </div>
      <span className="pm-chart-bar-count">{count}</span>
    </div>
  )
}

export function DashboardView({ project, tasks }) {
  const flat = useMemo(() => flattenTasks(tasks), [tasks])
  const topLevel = useMemo(() => flat.filter((t) => !t.parent_task_id && !t.archived), [flat])
  const overdue = useMemo(() => getOverdueTasks(tasks), [tasks])
  const blocked = useMemo(() => getBlockedTasks(tasks), [tasks])
  const upcoming = useMemo(() => getUpcomingTasks(tasks, 7), [tasks])

  const total = topLevel.length
  const completed = topLevel.filter((t) => t.status === 'Completed').length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0

  const byStatus = useMemo(() =>
    TASK_STATUSES.map((s) => ({ label: s, count: topLevel.filter((t) => t.status === s).length })),
    [topLevel]
  )

  const byPriority = useMemo(() =>
    TASK_PRIORITIES.map((p) => ({ label: p, count: topLevel.filter((t) => t.priority === p).length })),
    [topLevel]
  )

  return (
    <div>
      {/* Summary widgets */}
      <div className="pm-dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        <StatCard
          label="Total Tasks"
          value={total}
          icon={<List size={20} />}
          color="var(--theme-primary)"
        />
        <StatCard
          label="Completed"
          value={completed}
          icon={<CheckCircle size={20} />}
          color="#4ade80"
          subtitle={`${progress}% done`}
        />
        <StatCard
          label="Overdue"
          value={overdue.length}
          icon={<Clock size={20} />}
          color={overdue.length > 0 ? '#f87171' : 'var(--theme-text-dim)'}
        />
        <StatCard
          label="Blocked"
          value={blocked.length}
          icon={<AlertCircle size={20} />}
          color={blocked.length > 0 ? '#fbbf24' : 'var(--theme-text-dim)'}
        />
        <StatCard
          label="Due This Week"
          value={upcoming.length}
          icon={<Calendar size={20} />}
          color="var(--theme-accent-blue)"
        />
        <div className="pm-widget" style={{ '--widget-color': project.color || 'var(--theme-primary)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--theme-text-dim)', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Progress</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <div className="pm-progress-bar-wrap" style={{ height: 10 }}>
                <div className="pm-progress-bar-fill" style={{ width: `${progress}%`, background: project.color || undefined }} />
              </div>
            </div>
            <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--theme-text)', flexShrink: 0 }}>{progress}%</span>
          </div>
        </div>
      </div>

      <div className="pm-dashboard-cols">
        {/* Tasks by Status */}
        <div className="pm-dashboard-card">
          <div className="pm-dashboard-card-title">Tasks by Status</div>
          {total === 0 ? (
            <div style={{ color: 'var(--theme-text-dim)', fontSize: '0.82rem' }}>No tasks yet</div>
          ) : (
            <div className="pm-chart-bar-group">
              {byStatus.map(({ label, count }) => (
                <ChartBar key={label} label={label} count={count} total={total} color={STATUS_COLORS[label]} />
              ))}
            </div>
          )}
        </div>

        {/* Tasks by Priority */}
        <div className="pm-dashboard-card">
          <div className="pm-dashboard-card-title">Tasks by Priority</div>
          {total === 0 ? (
            <div style={{ color: 'var(--theme-text-dim)', fontSize: '0.82rem' }}>No tasks yet</div>
          ) : (
            <div className="pm-chart-bar-group">
              {byPriority.map(({ label, count }) => (
                <ChartBar key={label} label={label} count={count} total={total} color={PRIORITY_COLORS[label]} />
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Tasks */}
        <div className="pm-dashboard-card">
          <div className="pm-dashboard-card-title">Due This Week</div>
          {upcoming.length === 0 ? (
            <div style={{ color: 'var(--theme-text-dim)', fontSize: '0.82rem' }}>Nothing due in the next 7 days</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {upcoming.slice(0, 8).map((t) => {
                const due = formatDueDate(t.due_date)
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.4rem 0', borderBottom: '1px solid var(--theme-border-subtle)' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_COLORS[t.priority] || '#64748b', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--theme-text-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                    <span style={{ fontSize: '0.72rem', color: due?.overdue ? '#f87171' : due?.today ? '#fbbf24' : 'var(--theme-text-dim)', flexShrink: 0 }}>{due?.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Blocked Tasks */}
        <div className="pm-dashboard-card">
          <div className="pm-dashboard-card-title">Blocked Tasks</div>
          {blocked.length === 0 ? (
            <div style={{ color: 'var(--theme-text-dim)', fontSize: '0.82rem' }}>No blocked tasks</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {blocked.slice(0, 8).map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--theme-border-subtle)' }}>
                  <AlertCircle size={12} style={{ color: '#f87171', marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--theme-text-soft)' }}>{t.title}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--theme-text-dim)' }}>
                      Waiting on: {t.dependencies?.filter((d) => d.depends_on_status !== 'Completed').map((d) => d.depends_on_title).join(', ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

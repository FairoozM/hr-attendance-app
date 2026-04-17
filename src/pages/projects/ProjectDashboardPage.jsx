import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderKanban, CheckCircle, Clock, AlertCircle, TrendingUp, List, ExternalLink } from 'lucide-react'
import { fetchDashboardStats } from '../../lib/projects'
import { useProjects } from '../../contexts/ProjectsContext'
import './projects.css'

function StatWidget({ label, value, color, icon }) {
  return (
    <div className="pm-widget" style={{ '--widget-color': color }}>
      <div className="pm-widget-icon">{icon}</div>
      <div className="pm-widget-value" style={{ color }}>{value || 0}</div>
      <div className="pm-widget-label">{label}</div>
    </div>
  )
}

export default function ProjectDashboardPage() {
  const navigate = useNavigate()
  const { projects } = useProjects()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchDashboardStats()
      setStats(data)
    } catch (e) {
      setError(e.message || 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return (
    <div className="pm-page">
      <div className="pm-loading"><span className="pm-spinner" /> Loading dashboard…</div>
    </div>
  )

  return (
    <div className="pm-page">
      <div className="pm-page-header">
        <div>
          <h1 className="pm-page-title">Projects Dashboard</h1>
          <p className="pm-page-subtitle">Overview across all projects</p>
        </div>
        <button className="pm-btn pm-btn-ghost" onClick={load}>Refresh</button>
      </div>

      {error && (
        <div style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.83rem' }}>
          {error}
        </div>
      )}

      {stats && (
        <>
          {/* Widgets */}
          <div className="pm-dashboard-grid">
            <StatWidget label="Total Projects" value={stats.total_projects} color="var(--theme-primary)" icon={<FolderKanban size={20} />} />
            <StatWidget label="Active" value={stats.active_projects} color="#60a5fa" icon={<TrendingUp size={20} />} />
            <StatWidget label="Completed" value={stats.completed_projects} color="#4ade80" icon={<CheckCircle size={20} />} />
            <StatWidget label="Total Tasks" value={stats.total_tasks} color="var(--theme-text-muted)" icon={<List size={20} />} />
            <StatWidget label="Done" value={stats.completed_tasks} color="#4ade80" icon={<CheckCircle size={20} />} />
            <StatWidget label="Overdue" value={stats.overdue_tasks} color={parseInt(stats.overdue_tasks) > 0 ? '#f87171' : 'var(--theme-text-dim)'} icon={<Clock size={20} />} />
            <StatWidget label="Blocked" value={stats.blocked_tasks} color={stats.blocked_tasks > 0 ? '#fbbf24' : 'var(--theme-text-dim)'} icon={<AlertCircle size={20} />} />
          </div>

          {/* Project Progress Table */}
          <div className="pm-dashboard-card" style={{ marginTop: '1rem' }}>
            <div className="pm-dashboard-card-title">Project Progress</div>
            {(!stats.projects || stats.projects.length === 0) ? (
              <div style={{ color: 'var(--theme-text-dim)', fontSize: '0.82rem' }}>No active projects</div>
            ) : (
              <table className="pm-projects-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Progress</th>
                    <th>Tasks</th>
                    <th>Due Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {stats.projects.map((p) => {
                    const total = parseInt(p.task_count || 0)
                    const done = parseInt(p.completed_count || 0)
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0
                    const statusKey = p.status?.toLowerCase().replace(/\s+/g, '-')
                    const priorityKey = p.priority?.toLowerCase()
                    return (
                      <tr
                        key={p.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/projects/${p.id}`)}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color || '#8b5cf6', flexShrink: 0 }} />
                            <span style={{ fontWeight: 500, color: 'var(--theme-text)' }}>{p.name}</span>
                          </div>
                        </td>
                        <td><span className={`pm-badge pm-badge-status-${statusKey}`}>{p.status}</span></td>
                        <td><span className={`pm-badge pm-badge-priority-${priorityKey}`}>{p.priority}</span></td>
                        <td style={{ minWidth: 140 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div style={{ flex: 1 }}>
                              <div className="pm-progress-bar-wrap" style={{ marginBottom: 0 }}>
                                <div className="pm-progress-bar-fill" style={{ width: `${pct}%`, background: p.color || undefined }} />
                              </div>
                            </div>
                            <span style={{ fontSize: '0.72rem', color: 'var(--theme-text-dim)', minWidth: 30 }}>{pct}%</span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--theme-text-dim)' }}>{done}/{total}</td>
                        <td style={{ color: 'var(--theme-text-dim)' }}>
                          {p.due_date ? new Date(p.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                        </td>
                        <td>
                          <ExternalLink size={13} style={{ color: 'var(--theme-text-dim)', opacity: 0.5 }} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

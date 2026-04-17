import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Settings, Edit2, Plus, List, BarChart2, Calendar, User } from 'lucide-react'
import { useProjects } from '../../contexts/ProjectsContext'
import { ListView } from '../../components/projects/ListView'
import { DashboardView } from '../../components/projects/DashboardView'
import { ProjectForm } from '../../components/projects/ProjectForm'
import { TaskForm } from '../../components/projects/TaskForm'
import './projects.css'

function StatusBadge({ status }) {
  const key = status?.toLowerCase().replace(/\s+/g, '-')
  return <span className={`pm-badge pm-badge-status-${key}`}>{status}</span>
}

function PriorityBadge({ priority }) {
  const key = priority?.toLowerCase()
  return <span className={`pm-badge pm-badge-priority-${key}`}>{priority}</span>
}

export default function ProjectDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    fetchProjectDetail, loadTasks,
    tasksByProject, tasksLoading,
    updateProject, createTask,
  } = useProjects()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('list')
  const [showEditForm, setShowEditForm] = useState(false)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const tasks = tasksByProject[id] || []
  const tasksAreLoading = tasksLoading[id]

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const proj = await fetchProjectDetail(id)
      if (!proj) { setError('Project not found'); return }
      setProject(proj)
      await loadTasks(id)
    } catch (e) {
      setError(e.message || 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id])

  async function handleSaveProject(data) {
    setSaving(true)
    try {
      const updated = await updateProject(id, data)
      setProject(updated)
      setShowEditForm(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateTask(data) {
    await createTask(id, data)
    setShowTaskForm(false)
    await loadTasks(id)
  }

  async function handleRefresh() {
    const proj = await fetchProjectDetail(id)
    if (proj) setProject(proj)
    await loadTasks(id)
  }

  if (loading) return (
    <div className="pm-page" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <span className="pm-spinner" /> Loading project…
    </div>
  )

  if (error) return (
    <div className="pm-page">
      <div style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: '1rem', fontSize: '0.85rem' }}>
        {error}
      </div>
      <button className="pm-btn pm-btn-ghost" style={{ marginTop: '1rem' }} onClick={() => navigate('/projects')}>
        <ArrowLeft size={14} /> Back to Projects
      </button>
    </div>
  )

  if (!project) return null

  const progress = project.progress || 0

  return (
    <div className="pm-page">
      {/* Project Header */}
      <div className="pm-detail-header">
        <div className="pm-detail-header-top">
          <button className="pm-btn-icon" onClick={() => navigate('/projects')} title="Back">
            <ArrowLeft size={15} />
          </button>

          <div style={{ width: 14, height: 14, borderRadius: '50%', background: project.color || '#8b5cf6', marginTop: 5, flexShrink: 0 }} />

          <div style={{ flex: 1 }}>
            <div className="pm-detail-title">{project.name}</div>
            {project.description && (
              <div className="pm-detail-desc">{project.description}</div>
            )}
          </div>

          <div className="pm-detail-actions">
            <StatusBadge status={project.status} />
            <PriorityBadge status={project.priority} />
            <button className="pm-btn pm-btn-primary pm-btn-sm" onClick={() => setShowTaskForm(true)}>
              <Plus size={13} /> New Task
            </button>
            <button className="pm-btn-icon" onClick={() => setShowEditForm(true)} title="Edit project">
              <Edit2 size={14} />
            </button>
          </div>
        </div>

        <div className="pm-detail-meta-row">
          {project.due_date && (
            <span className="pm-detail-meta-item">
              <Calendar size={12} />
              Due {new Date(project.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
          {project.owner_username && (
            <span className="pm-detail-meta-item">
              <User size={12} /> {project.owner_username}
            </span>
          )}
          <span className="pm-detail-meta-item" style={{ marginLeft: 'auto', gap: '0.75rem' }}>
            <span style={{ color: 'var(--theme-text-dim)', fontSize: '0.72rem' }}>{project.task_count || 0} tasks · {project.completed_count || 0} done · {project.overdue_count || 0} overdue</span>
          </span>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <div className="pm-progress-bar-wrap" style={{ height: 7 }}>
            <div className="pm-progress-bar-fill" style={{ width: `${progress}%`, background: project.color || undefined }} />
          </div>
          <div className="pm-progress-label">{progress}% complete</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="pm-tabs">
        <button className={`pm-tab${activeTab === 'list' ? ' active' : ''}`} onClick={() => setActiveTab('list')}>
          <List size={13} /> List View
        </button>
        <button className={`pm-tab${activeTab === 'dashboard' ? ' active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          <BarChart2 size={13} /> Dashboard
        </button>
      </div>

      {/* Tab Content */}
      {tasksAreLoading && tasks.length === 0 ? (
        <div className="pm-loading"><span className="pm-spinner" /> Loading tasks…</div>
      ) : activeTab === 'list' ? (
        <ListView
          project={project}
          tasks={tasks}
          onRefresh={handleRefresh}
        />
      ) : (
        <DashboardView
          project={project}
          tasks={tasks}
        />
      )}

      {/* Edit Project Modal */}
      {showEditForm && (
        <ProjectForm
          project={project}
          onSave={handleSaveProject}
          onClose={() => setShowEditForm(false)}
          loading={saving}
        />
      )}

      {/* New Task Modal */}
      {showTaskForm && (
        <TaskForm
          sections={project.sections || []}
          onSave={handleCreateTask}
          onClose={() => setShowTaskForm(false)}
        />
      )}
    </div>
  )
}

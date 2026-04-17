import { useState, useMemo } from 'react'
import { Plus, Search, FolderOpen } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useProjects } from '../../contexts/ProjectsContext'
import { ProjectCard } from '../../components/projects/ProjectCard'
import { ProjectForm } from '../../components/projects/ProjectForm'
import './projects.css'

export default function ProjectsIndexPage() {
  const navigate = useNavigate()
  const { projects, loading, error, createProject, updateProject, deleteProject, loadProjects } = useProjects()
  const [showForm, setShowForm] = useState(false)
  const [editingProject, setEditingProject] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (!showArchived && p.archived) return false
      if (filterStatus && p.status !== filterStatus) return false
      if (filterPriority && p.priority !== filterPriority) return false
      if (search) {
        const q = search.toLowerCase()
        return p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [projects, search, filterStatus, filterPriority, showArchived])

  async function handleSave(data) {
    setSaving(true)
    try {
      if (editingProject) {
        await updateProject(editingProject.id, data)
      } else {
        const project = await createProject(data)
        navigate(`/projects/${project.id}`)
      }
      setShowForm(false)
      setEditingProject(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(project) {
    if (!window.confirm(`Delete project "${project.name}"? All tasks will be deleted permanently.`)) return
    await deleteProject(project.id)
  }

  async function handleArchive(project) {
    await updateProject(project.id, { archived: !project.archived })
  }

  function handleEdit(project) {
    setEditingProject(project)
    setShowForm(true)
  }

  return (
    <div className="pm-page">
      <div className="pm-page-header">
        <div>
          <h1 className="pm-page-title">Projects</h1>
          <p className="pm-page-subtitle">{projects.filter((p) => !p.archived).length} active projects</p>
        </div>
        <button className="pm-btn pm-btn-primary" onClick={() => { setEditingProject(null); setShowForm(true) }}>
          <Plus size={14} /> New Project
        </button>
      </div>

      <div className="pm-toolbar">
        <div className="pm-search-wrap">
          <Search />
          <input
            className="pm-search-input"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="pm-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {['Planning', 'Active', 'On Hold', 'Completed'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select className="pm-select" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {['Low', 'Medium', 'High', 'Urgent'].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <button
          className={`pm-btn ${showArchived ? 'pm-btn-primary' : 'pm-btn-ghost'} pm-btn-sm`}
          onClick={() => { setShowArchived((v) => !v); loadProjects(!showArchived) }}
        >
          {showArchived ? 'Hide Archived' : 'Show Archived'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.83rem' }}>
          {error}
        </div>
      )}

      {loading && projects.length === 0 ? (
        <div className="pm-loading">
          <span className="pm-spinner" /> Loading projects…
        </div>
      ) : filtered.length === 0 ? (
        <div className="pm-empty">
          <div className="pm-empty-icon"><FolderOpen /></div>
          <div className="pm-empty-title">
            {search || filterStatus || filterPriority ? 'No matching projects' : 'No projects yet'}
          </div>
          <div className="pm-empty-desc">
            {search || filterStatus || filterPriority
              ? 'Try adjusting your filters.'
              : 'Create your first project to start organizing tasks and tracking progress.'
            }
          </div>
          {!search && !filterStatus && !filterPriority && (
            <button className="pm-btn pm-btn-primary" style={{ marginTop: '1.25rem' }} onClick={() => setShowForm(true)}>
              <Plus size={14} /> Create Project
            </button>
          )}
        </div>
      ) : (
        <div className="pm-projects-grid">
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={(p) => navigate(`/projects/${p.id}`)}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onArchive={handleArchive}
            />
          ))}
        </div>
      )}

      {showForm && (
        <ProjectForm
          project={editingProject}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingProject(null) }}
          loading={saving}
        />
      )}
    </div>
  )
}

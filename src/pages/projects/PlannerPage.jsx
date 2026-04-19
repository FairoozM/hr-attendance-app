import { useState, useMemo } from 'react'
import { Plus, Search, SlidersHorizontal, BrainCircuit } from 'lucide-react'
import { usePlanner } from '../../contexts/PlannerContext'
import { TaskCard } from '../../components/projects/TaskCard'
import { QuickCapture } from '../../components/projects/QuickCapture'
import { AIAssistPanel } from '../../components/projects/AIAssistPanel'
import { TaskForm } from '../../components/projects/TaskForm'
import { ProjectForm } from '../../components/projects/ProjectForm'
import { TaskDrawer } from '../../components/projects/TaskDrawer'
import './projects.css'

const STATUS_FILTERS = ['All', 'Not Started', 'In Progress', 'Blocked', 'Done']
const CATEGORY_FILTERS = ['All', 'Finance', 'Operations', 'Communication', 'Admin']
const ENERGY_FILTERS = ['All', 'Deep Work', 'Shallow Work']

export default function PlannerPage() {
  const {
    projects, allTasks, assistSuggestions,
    loading, tasksLoading,
    loadTasks, createTask, updateTask, deleteTask, markTaskDone,
    submitCapture, createProject,
    selectedProjectId, setSelectedProjectId,
  } = usePlanner()

  const [search,          setSearch]          = useState('')
  const [statusFilter,    setStatusFilter]    = useState('All')
  const [categoryFilter,  setCategoryFilter]  = useState('All')
  const [energyFilter,    setEnergyFilter]    = useState('All')
  const [showFilters,     setShowFilters]     = useState(false)
  const [showTaskForm,    setShowTaskForm]     = useState(false)
  const [showProjectForm, setShowProjectForm]  = useState(false)
  const [editingTask,     setEditingTask]      = useState(null)
  const [selectedTask,    setSelectedTask]     = useState(null)
  const [captureSaving,   setCaptureSaving]    = useState(false)
  const [projectSaving,   setProjectSaving]    = useState(false)

  // Active project for task creation
  const activeProject = useMemo(() => {
    if (selectedProjectId) return projects.find(p => p.id === selectedProjectId) || projects[0]
    return projects[0] || null
  }, [projects, selectedProjectId])

  // Load tasks when active project changes
  useMemo(() => {
    if (activeProject?.id) loadTasks(activeProject.id)
  }, [activeProject?.id])

  // Filter + sort tasks
  const filteredTasks = useMemo(() => {
    return allTasks
      .filter(t => {
        if (statusFilter !== 'All' && t.status !== statusFilter) return false
        if (categoryFilter !== 'All' && t.category !== categoryFilter) return false
        if (energyFilter !== 'All' && t.energyType !== energyFilter) return false
        if (search) {
          const q = search.toLowerCase()
          return t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)
        }
        return true
      })
      .sort((a, b) => b.priorityScore - a.priorityScore)
  }, [allTasks, statusFilter, categoryFilter, energyFilter, search])

  const isLoading = loading || (activeProject && tasksLoading[activeProject.id])

  async function handleCapture(text, projectId) {
    setCaptureSaving(true)
    try { await submitCapture(text, projectId) } finally { setCaptureSaving(false) }
  }

  async function handleCreateTask(data) {
    if (!activeProject) return
    await createTask(activeProject.id, data)
    setShowTaskForm(false)
  }

  async function handleUpdateTask(data) {
    if (!editingTask || !activeProject) return
    await updateTask(activeProject.id, editingTask.id, data)
    setEditingTask(null)
    setShowTaskForm(false)
    if (selectedTask?.id === editingTask.id) setSelectedTask(null)
  }

  async function handleDelete(task) {
    if (!window.confirm(`Delete "${task.title}"?`)) return
    await deleteTask(task.project_id || activeProject?.id, task.id)
    if (selectedTask?.id === task.id) setSelectedTask(null)
  }

  async function handleComplete(task) {
    const projectId = task.project_id || activeProject?.id
    if (!projectId) return
    if (task.status === 'Done') {
      await updateTask(projectId, task.id, { status: 'Not Started', completed_at: null })
    } else {
      await markTaskDone(projectId, task.id)
    }
  }

  async function handleCreateProject(data) {
    setProjectSaving(true)
    try {
      const p = await createProject(data)
      setSelectedProjectId(p.id)
      setShowProjectForm(false)
    } finally { setProjectSaving(false) }
  }

  function handleAssistSelect(taskId) {
    const task = allTasks.find(t => t.id === taskId)
    if (task) setSelectedTask(task)
  }

  const doneTasks    = filteredTasks.filter(t => t.status === 'Done' || t.completed_at)
  const activeTasks  = filteredTasks.filter(t => t.status !== 'Done' && !t.completed_at)

  return (
    <div className="pm-page ai-planner-page">
      {/* Header */}
      <div className="pm-page-header">
        <div>
          <h1 className="pm-page-title ai-planner-page__title">
            <BrainCircuit size={22} aria-hidden />
            AI Task Planner
          </h1>
          <p className="pm-page-subtitle">
            {allTasks.filter(t => t.status !== 'Done').length} active tasks ·
            auto-prioritized by urgency, impact &amp; dependencies
          </p>
        </div>
        <div className="ai-planner-page__header-actions">
          {projects.length > 0 && (
            <select
              className="pm-select"
              value={selectedProjectId || ''}
              onChange={e => setSelectedProjectId(Number(e.target.value))}
              aria-label="Active project"
            >
              {projects.filter(p => !p.archived).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button className="pm-btn pm-btn-ghost pm-btn-sm" onClick={() => setShowProjectForm(true)}>
            <Plus size={13} /> Project
          </button>
          <button className="pm-btn pm-btn-primary" onClick={() => { setEditingTask(null); setShowTaskForm(true) }}>
            <Plus size={14} /> New Task
          </button>
        </div>
      </div>

      {/* Quick Capture */}
      <QuickCapture
        onSubmit={handleCapture}
        projects={projects}
        defaultProjectId={activeProject?.id}
        loading={captureSaving}
      />

      {/* Main layout: task list + AI panel */}
      <div className="ai-planner-layout">
        {/* Left: task list */}
        <div className="ai-planner-layout__main">
          {/* Toolbar */}
          <div className="pm-toolbar ai-planner-toolbar">
            <div className="pm-search-wrap">
              <Search size={14} />
              <input
                className="pm-search-input"
                placeholder="Search tasks…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button
              className={`pm-btn pm-btn-sm ${showFilters ? 'pm-btn-primary' : 'pm-btn-ghost'}`}
              onClick={() => setShowFilters(v => !v)}
            >
              <SlidersHorizontal size={13} /> Filters
            </button>
          </div>

          {showFilters && (
            <div className="ai-planner-filters">
              <select className="pm-select pm-select--sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                {STATUS_FILTERS.map(f => <option key={f}>{f}</option>)}
              </select>
              <select className="pm-select pm-select--sm" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                {CATEGORY_FILTERS.map(f => <option key={f}>{f}</option>)}
              </select>
              <select className="pm-select pm-select--sm" value={energyFilter} onChange={e => setEnergyFilter(e.target.value)}>
                {ENERGY_FILTERS.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
          )}

          {/* Task list */}
          {isLoading && allTasks.length === 0 ? (
            <div className="pm-loading"><span className="pm-spinner" /> Loading tasks…</div>
          ) : activeTasks.length === 0 && doneTasks.length === 0 ? (
            <div className="pm-empty">
              <div className="pm-empty-icon"><BrainCircuit /></div>
              <div className="pm-empty-title">No tasks yet</div>
              <div className="pm-empty-desc">Use Quick Capture above or create a task manually.</div>
              <button className="pm-btn pm-btn-primary" style={{ marginTop: '1rem' }} onClick={() => setShowTaskForm(true)}>
                <Plus size={14} /> Create First Task
              </button>
            </div>
          ) : (
            <>
              {activeTasks.length > 0 && (
                <div className="ai-task-list">
                  <div className="ai-task-list__label">
                    Active · {activeTasks.length} task{activeTasks.length !== 1 ? 's' : ''} · sorted by priority
                  </div>
                  {activeTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onComplete={handleComplete}
                      onEdit={t => { setEditingTask(t); setShowTaskForm(true) }}
                      onDelete={handleDelete}
                      onSelect={setSelectedTask}
                    />
                  ))}
                </div>
              )}

              {doneTasks.length > 0 && (
                <details className="ai-task-list__done-group">
                  <summary className="ai-task-list__label ai-task-list__label--done">
                    Completed · {doneTasks.length}
                  </summary>
                  <div className="ai-task-list" style={{ marginTop: '0.5rem' }}>
                    {doneTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onComplete={handleComplete}
                        onEdit={t => { setEditingTask(t); setShowTaskForm(true) }}
                        onDelete={handleDelete}
                        onSelect={setSelectedTask}
                        compact
                      />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        {/* Right: AI assist panel */}
        <AIAssistPanel
          suggestions={assistSuggestions}
          onTaskSelect={handleAssistSelect}
          loading={isLoading}
        />
      </div>

      {/* Task Drawer */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          project={projects.find(p => p.id === (selectedTask.project_id || activeProject?.id))}
          sections={activeProject?.sections || []}
          tasks={allTasks}
          onClose={() => setSelectedTask(null)}
          onRefresh={() => activeProject && loadTasks(activeProject.id)}
        />
      )}

      {/* Task Form Modal */}
      {showTaskForm && (
        <TaskForm
          task={editingTask}
          sections={activeProject?.sections || []}
          onSave={editingTask ? handleUpdateTask : handleCreateTask}
          onClose={() => { setShowTaskForm(false); setEditingTask(null) }}
        />
      )}

      {/* Project Form Modal */}
      {showProjectForm && (
        <ProjectForm
          onSave={handleCreateProject}
          onClose={() => setShowProjectForm(false)}
          loading={projectSaving}
        />
      )}
    </div>
  )
}

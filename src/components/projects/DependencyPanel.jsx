import { useState } from 'react'
import { GitBranch, X, Plus, AlertCircle, CheckCircle } from 'lucide-react'
import { useProjects } from '../../contexts/ProjectsContext'
import { buildDependencyGraph, detectCircularDependency } from '../../utils/projectUtils'

export function DependencyPanel({ task, projectId, allTasks, onUpdate }) {
  const { addDependency, removeDependency } = useProjects()
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [depType, setDepType] = useState('finish-to-start')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const deps = task.dependencies || []

  const flatAll = []
  function flatten(tasks) {
    for (const t of tasks || []) {
      flatAll.push(t)
      flatten(t.subtasks)
    }
  }
  flatten(allTasks)

  const availableTasks = flatAll.filter(
    (t) => t.id !== task.id && !deps.some((d) => d.depends_on_task_id === t.id)
  )

  async function handleAdd() {
    setError('')
    if (!selectedTaskId) { setError('Select a task'); return }

    const graph = buildDependencyGraph(allTasks)
    if (detectCircularDependency(graph, task.id, parseInt(selectedTaskId))) {
      setError('This would create a circular dependency')
      return
    }

    try {
      await addDependency(projectId, task.id, {
        depends_on_task_id: parseInt(selectedTaskId),
        dependency_type: depType,
      })
      setSelectedTaskId('')
      setAdding(false)
      onUpdate?.()
    } catch (e) {
      setError(e.message || 'Failed to add dependency')
    }
  }

  async function handleRemove(depId) {
    await removeDependency(projectId, task.id, depId)
    onUpdate?.()
  }

  return (
    <div>
      {deps.length === 0 && !adding && (
        <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-dim)', padding: '0.25rem 0' }}>
          No dependencies
        </div>
      )}

      {deps.map((dep) => (
        <div key={dep.id} className={`pm-dep-item${dep.depends_on_status !== 'Completed' ? ' pm-dep-blocking' : ''}`}>
          {dep.depends_on_status === 'Completed'
            ? <CheckCircle size={13} style={{ color: '#4ade80', flexShrink: 0 }} />
            : <AlertCircle size={13} style={{ color: '#f87171', flexShrink: 0 }} />
          }
          <span className="pm-dep-item-title" title={dep.depends_on_title}>{dep.depends_on_title}</span>
          <span className="pm-dep-item-type">{dep.dependency_type}</span>
          <span style={{ fontSize: '0.7rem', color: dep.depends_on_status === 'Completed' ? '#4ade80' : '#f87171' }}>
            {dep.depends_on_status}
          </span>
          <button className="pm-btn-icon pm-btn-sm" onClick={() => handleRemove(dep.id)} title="Remove dependency">
            <X size={11} />
          </button>
        </div>
      ))}

      {error && (
        <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '0.4rem' }}>{error}</div>
      )}

      {adding ? (
        <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <select
            className="pm-add-dep-select"
            value={selectedTaskId}
            onChange={(e) => setSelectedTaskId(e.target.value)}
          >
            <option value="">Select task…</option>
            {availableTasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select
              className="pm-add-dep-select"
              value={depType}
              onChange={(e) => setDepType(e.target.value)}
              style={{ flex: '0 0 auto' }}
            >
              <option value="finish-to-start">Finish-to-Start</option>
              <option value="start-to-start">Start-to-Start</option>
              <option value="finish-to-finish">Finish-to-Finish</option>
            </select>
            <button className="pm-btn pm-btn-primary pm-btn-sm" onClick={handleAdd}>Add</button>
            <button className="pm-btn pm-btn-ghost pm-btn-sm" onClick={() => { setAdding(false); setError('') }}>Cancel</button>
          </div>
        </div>
      ) : (
        availableTasks.length > 0 && (
          <button className="pm-btn pm-btn-ghost pm-btn-sm" style={{ marginTop: '0.4rem' }} onClick={() => setAdding(true)}>
            <Plus size={12} /> Add Dependency
          </button>
        )
      )}
    </div>
  )
}

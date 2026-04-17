import { useState, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { useProjects } from '../../contexts/ProjectsContext'
import { groupTasksBySections } from '../../utils/projectUtils'
import { SectionHeader } from './SectionHeader'
import { TaskRow } from './TaskRow'
import { TaskDrawer } from './TaskDrawer'
import { TaskForm } from './TaskForm'

export function ListView({ project, tasks, onRefresh }) {
  const { createTask, updateTask, createSection, updateSection, deleteSection } = useProjects()
  const [collapsed, setCollapsed] = useState({})
  const [selectedTask, setSelectedTask] = useState(null)
  const [newTaskSectionId, setNewTaskSectionId] = useState(null)
  const [quickAddValues, setQuickAddValues] = useState({})
  const [showTaskForm, setShowTaskForm] = useState(false)

  const sections = project.sections || []
  const grouped = groupTasksBySections(tasks, sections)

  function toggleCollapse(sectionId) {
    setCollapsed((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }

  function handleAddTaskToSection(sectionId) {
    setNewTaskSectionId(sectionId)
    setShowTaskForm(true)
  }

  async function handleQuickAdd(sectionId) {
    const title = (quickAddValues[sectionId] || '').trim()
    if (!title) return
    await createTask(project.id, {
      title,
      section_id: sectionId,
      status: 'Not Started',
      priority: 'Medium',
    })
    setQuickAddValues((prev) => ({ ...prev, [sectionId]: '' }))
    onRefresh?.()
  }

  async function handleToggleComplete(task) {
    const newStatus = task.status === 'Completed' ? 'Not Started' : 'Completed'
    await updateTask(project.id, task.id, { status: newStatus })
    onRefresh?.()
  }

  function handleOpenTask(task) {
    setSelectedTask(task)
  }

  async function handleTaskUpdate() {
    onRefresh?.()
    // Refresh selected task data
    if (selectedTask) {
      const flat = []
      function flattenFresh(list) { for (const t of list) { flat.push(t); flattenFresh(t.subtasks || []) } }
      flattenFresh(tasks)
      const refreshed = flat.find((t) => t.id === selectedTask.id)
      if (refreshed) setSelectedTask(refreshed)
    }
  }

  async function handleAddSection() {
    const name = window.prompt('New section name:')
    if (!name?.trim()) return
    await createSection(project.id, { name: name.trim(), sort_order: sections.length })
    onRefresh?.()
  }

  async function handleRenameSection(sectionId, name) {
    await updateSection(project.id, sectionId, { name })
    onRefresh?.()
  }

  async function handleDeleteSection(sectionId) {
    const sec = sections.find((s) => s.id === sectionId)
    if (!window.confirm(`Delete section "${sec?.name}"? Tasks will be unsectioned.`)) return
    await deleteSection(project.id, sectionId)
    onRefresh?.()
  }

  return (
    <div className="pm-list-view">
      {grouped.map(({ section, tasks: sectionTasks }) => (
        <div key={section.id ?? 'unsectioned'} className="pm-section-group">
          <SectionHeader
            section={section}
            taskCount={sectionTasks.length}
            collapsed={collapsed[section.id]}
            onToggle={() => toggleCollapse(section.id)}
            onAddTask={() => handleAddTaskToSection(section.id)}
            onRename={section.id ? handleRenameSection : undefined}
            onDelete={section.id ? handleDeleteSection : undefined}
          />

          {!collapsed[section.id] && (
            <>
              <div className="pm-task-list">
                {sectionTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onOpen={handleOpenTask}
                    onToggleComplete={handleToggleComplete}
                  />
                ))}
              </div>

              {/* Quick add */}
              <div className="pm-quick-add">
                <div className="pm-quick-add-input-row">
                  <Plus size={13} style={{ color: 'var(--theme-text-dim)', flexShrink: 0 }} />
                  <input
                    className="pm-quick-add-input"
                    placeholder="Add task…"
                    value={quickAddValues[section.id] || ''}
                    onChange={(e) => setQuickAddValues((prev) => ({ ...prev, [section.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAdd(section.id) }}
                  />
                  {(quickAddValues[section.id] || '').trim() && (
                    <button
                      className="pm-btn pm-btn-primary pm-btn-sm"
                      onClick={() => handleQuickAdd(section.id)}
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      ))}

      {/* Add Section button */}
      <button className="pm-btn pm-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={handleAddSection}>
        <Plus size={13} /> Add Section
      </button>

      {/* Task Form Modal */}
      {showTaskForm && (
        <TaskForm
          sections={sections}
          parentTaskId={null}
          onSave={async (data) => {
            await createTask(project.id, { ...data, section_id: newTaskSectionId })
            setShowTaskForm(false)
            onRefresh?.()
          }}
          onClose={() => setShowTaskForm(false)}
        />
      )}

      {/* Task Drawer */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          projectId={project.id}
          sections={sections}
          allTasks={tasks}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdate}
        />
      )}
    </div>
  )
}

import { useState } from 'react'
import { CalendarDays, List, RefreshCw, BrainCircuit } from 'lucide-react'
import { usePlanner } from '../../contexts/PlannerContext'
import { TimeBlockCalendar } from '../../components/projects/TimeBlockCalendar'
import { DailyScheduleView } from '../../components/projects/DailyScheduleView'
import { TaskDrawer } from '../../components/projects/TaskDrawer'
import './projects.css'

export default function TodayPlanPage() {
  const {
    todayPlan, allTasks,
    projects, loading,
    loadTasks, updateTask,
    selectedProjectId,
  } = usePlanner()

  const [view,         setView]         = useState('schedule') // 'schedule' | 'calendar'
  const [selectedTask, setSelectedTask] = useState(null)
  const [refreshing,   setRefreshing]   = useState(false)

  const activeProject = projects.find(p => p.id === selectedProjectId) || projects[0]

  const totalTasks  = todayPlan.length
  const deepCount   = todayPlan.filter(b => b.slot === 'morning').length
  const shallowCount= todayPlan.filter(b => b.slot === 'afternoon').length
  const blockedCount= todayPlan.filter(b => b.slot === 'blocked').length

  async function handleRefresh() {
    setRefreshing(true)
    try {
      for (const p of projects) await loadTasks(p.id)
    } finally {
      setRefreshing(false)
    }
  }

  async function handleTaskDrop(taskId, hour) {
    const task = allTasks.find(t => t.id === taskId)
    if (!task) return
    const projectId = task.project_id || activeProject?.id
    if (!projectId) return
    // Store the rescheduled hour as a note in the task description (no new backend field needed)
    const timeLabel = `${String(hour).padStart(2, '0')}:00`
    await updateTask(projectId, task.id, {
      description: task.description
        ? `[Rescheduled to ${timeLabel}] ${task.description}`
        : `[Rescheduled to ${timeLabel}]`,
    })
  }

  return (
    <div className="pm-page ai-today-page">
      {/* Header */}
      <div className="pm-page-header">
        <div>
          <h1 className="pm-page-title ai-planner-page__title">
            <CalendarDays size={22} aria-hidden />
            Today's Plan
          </h1>
          <p className="pm-page-subtitle">
            AI-generated daily schedule · {totalTasks} task{totalTasks !== 1 ? 's' : ''}
            {deepCount > 0 && ` · 🧠 ${deepCount} deep`}
            {shallowCount > 0 && ` · ⚡ ${shallowCount} shallow`}
            {blockedCount > 0 && ` · 🚫 ${blockedCount} blocked`}
          </p>
        </div>
        <div className="ai-planner-page__header-actions">
          <button
            className="pm-btn pm-btn-ghost pm-btn-sm"
            onClick={handleRefresh}
            disabled={refreshing || loading}
          >
            <RefreshCw size={13} className={refreshing ? 'ai-spin' : ''} />
            Refresh
          </button>

          {/* View toggle */}
          <div className="ai-view-toggle">
            <button
              className={`ai-view-toggle__btn${view === 'schedule' ? ' active' : ''}`}
              onClick={() => setView('schedule')}
            >
              <List size={13} /> Schedule
            </button>
            <button
              className={`ai-view-toggle__btn${view === 'calendar' ? ' active' : ''}`}
              onClick={() => setView('calendar')}
            >
              <CalendarDays size={13} /> Time Blocks
            </button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="ai-today-stats">
        <div className="ai-today-stat">
          <span className="ai-today-stat__value">{totalTasks}</span>
          <span className="ai-today-stat__label">Scheduled</span>
        </div>
        <div className="ai-today-stat ai-today-stat--deep">
          <span className="ai-today-stat__value">🧠 {deepCount}</span>
          <span className="ai-today-stat__label">Deep Work</span>
        </div>
        <div className="ai-today-stat ai-today-stat--shallow">
          <span className="ai-today-stat__value">⚡ {shallowCount}</span>
          <span className="ai-today-stat__label">Shallow Work</span>
        </div>
        {blockedCount > 0 && (
          <div className="ai-today-stat ai-today-stat--blocked">
            <span className="ai-today-stat__value">🚫 {blockedCount}</span>
            <span className="ai-today-stat__label">Blocked</span>
          </div>
        )}
        <div className="ai-today-stat ai-today-stat--hours">
          <span className="ai-today-stat__value">
            {Math.round(todayPlan.reduce((acc, b) => acc + (b.endMinutes - b.startMinutes), 0) / 60 * 10) / 10}h
          </span>
          <span className="ai-today-stat__label">Planned</span>
        </div>
      </div>

      {/* View content */}
      {loading && todayPlan.length === 0 ? (
        <div className="pm-loading"><span className="pm-spinner" /> Building today's plan…</div>
      ) : view === 'schedule' ? (
        <DailyScheduleView
          plan={todayPlan}
          date={new Date()}
        />
      ) : (
        <TimeBlockCalendar
          plan={todayPlan}
          onTaskDrop={handleTaskDrop}
          onTaskClick={setSelectedTask}
        />
      )}

      {/* Task Drawer */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          project={projects.find(p => p.id === (selectedTask.project_id || activeProject?.id))}
          sections={activeProject?.sections || []}
          tasks={allTasks}
          onClose={() => setSelectedTask(null)}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  )
}

import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import {
  enrichTasks,
  buildDailySchedule,
  generateSuggestions,
  rescheduleIncomplete,
  detectCategory,
  detectEnergyType,
  parseQuickCapture,
} from '../lib/aiEngine'

const STORAGE_KEY = 'ai_planner_tasks_v1'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveToStorage(tasks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  } catch {}
}

// ─── Seed data ─────────────────────────────────────────────────────────────
const SEED_TASKS = [
  {
    id: '1', title: 'Check Amazon VAT invoices', description: 'Review all VAT invoices for UAE store',
    status: 'todo', priority: 'high', dueDate: new Date().toISOString().slice(0, 10),
  },
  {
    id: '2', title: 'Follow up with Noon payment', description: 'Follow up on pending payment settlement',
    status: 'todo', priority: 'high', dueDate: null,
  },
  {
    id: '3', title: 'Review ads campaign ACOS', description: 'Analyse weekly ACOS and adjust bids',
    status: 'todo', priority: 'medium', dueDate: null,
  },
  {
    id: '4', title: 'Send influencer brief', description: 'Email brief to new influencer for shoot schedule',
    status: 'todo', priority: 'medium', dueDate: null,
  },
  {
    id: '5', title: 'Update employee attendance records', description: 'Mark April attendance for all employees',
    status: 'blocked', priority: 'medium', dueDate: null,
  },
  {
    id: '6', title: 'Prepare product launch plan', description: 'Strategy doc for Q2 product launch on Amazon KSA',
    status: 'todo', priority: 'high', dueDate: null,
  },
  {
    id: '7', title: 'Reply to supplier emails', description: '',
    status: 'todo', priority: 'low', dueDate: null,
  },
  {
    id: '8', title: 'Review budget report', description: 'Monthly budget vs actuals',
    status: 'done', priority: 'medium', dueDate: null,
  },
]

const AIPlannerContext = createContext(null)

export function AIPlannerProvider({ children }) {
  const [rawTasks, setRawTasks] = useState(() => {
    const stored = loadFromStorage()
    return stored || SEED_TASKS
  })
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [view, setView] = useState('planner') // 'planner' | 'today' | 'dashboard'

  // Persist whenever rawTasks changes
  useEffect(() => {
    saveToStorage(rawTasks)
  }, [rawTasks])

  // ── Enriched + scheduled tasks (derived) ──────────────────────────────
  const tasks = useMemo(() => {
    const rescheduled = rescheduleIncomplete(rawTasks)
    const enriched    = enrichTasks(rescheduled)
    return buildDailySchedule(enriched)
  }, [rawTasks])

  const suggestions = useMemo(() => generateSuggestions(tasks), [tasks])

  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeTaskId) || null,
    [tasks, activeTaskId]
  )

  // ── CRUD ──────────────────────────────────────────────────────────────

  const addTask = useCallback((data) => {
    const id = Date.now().toString()
    const category   = detectCategory(data.title, data.description)
    const energyType = detectEnergyType(data.title)
    const newTask = {
      id,
      title: '',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      estimatedMinutes: null,
      notes: '',
      ...data,
      category,
      energyType,
      createdAt: new Date().toISOString(),
    }
    setRawTasks((prev) => [newTask, ...prev])
    return newTask
  }, [])

  const updateTask = useCallback((id, patch) => {
    setRawTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const updated = { ...t, ...patch }
        // Re-detect category/energy if title changed
        if (patch.title !== undefined) {
          updated.category   = patch.category   || detectCategory(patch.title, updated.description)
          updated.energyType = patch.energyType || detectEnergyType(patch.title)
        }
        return updated
      })
    )
  }, [])

  const deleteTask = useCallback((id) => {
    setRawTasks((prev) => prev.filter((t) => t.id !== id))
    setActiveTaskId((prev) => (prev === id ? null : prev))
  }, [])

  const markDone = useCallback((id) => {
    updateTask(id, { status: 'done' })
  }, [updateTask])

  const markTodo = useCallback((id) => {
    updateTask(id, { status: 'todo' })
  }, [updateTask])

  const quickCapture = useCallback((input) => {
    const parsed = parseQuickCapture(input)
    if (!parsed) return null
    return addTask(parsed)
  }, [addTask])

  // ── Filtered views ────────────────────────────────────────────────────

  const todoTasks    = useMemo(() => tasks.filter((t) => t.status === 'todo'),    [tasks])
  const blockedTasks = useMemo(() => tasks.filter((t) => t.status === 'blocked'), [tasks])
  const doneTasks    = useMemo(() => tasks.filter((t) => t.status === 'done'),    [tasks])
  const todayTasks   = useMemo(() => {
    const today = new Date().toDateString()
    return tasks.filter((t) => {
      if (t.status === 'done') return false
      if (t.dueDate && new Date(t.dueDate).toDateString() === today) return true
      if (t.scheduledStart && new Date(t.scheduledStart).toDateString() === today) return true
      return false
    })
  }, [tasks])

  return (
    <AIPlannerContext.Provider value={{
      tasks,
      rawTasks,
      todoTasks,
      blockedTasks,
      doneTasks,
      todayTasks,
      suggestions,
      activeTask,
      activeTaskId,
      view,
      setView,
      setActiveTaskId,
      addTask,
      updateTask,
      deleteTask,
      markDone,
      markTodo,
      quickCapture,
    }}>
      {children}
    </AIPlannerContext.Provider>
  )
}

export function useAIPlanner() {
  const ctx = useContext(AIPlannerContext)
  if (!ctx) throw new Error('useAIPlanner must be used inside AIPlannerProvider')
  return ctx
}

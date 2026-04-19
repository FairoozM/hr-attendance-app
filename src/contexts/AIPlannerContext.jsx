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

const STORAGE_KEY          = 'ai_planner_tasks_v1'
const SECTIONS_STORAGE_KEY = 'ai_planner_sections_v1'

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

function loadSectionsFromStorage() {
  try {
    const raw = localStorage.getItem(SECTIONS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSectionsToStorage(sections) {
  try {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(sections))
  } catch {}
}

const SEED_SECTIONS = [
  { id: 'sec-1', title: 'This Week', color: '#8b5cf6', order: 0 },
  { id: 'sec-2', title: 'Operations', color: '#3b82f6', order: 1 },
  { id: 'sec-3', title: 'Finance', color: '#f59e0b', order: 2 },
]

// ─── Seed data ─────────────────────────────────────────────────────────────
const SEED_TASKS = [
  {
    id: '1', title: 'Check Amazon VAT invoices', description: 'Review all VAT invoices for UAE store',
    status: 'todo', priority: 'high', dueDate: new Date().toISOString().slice(0, 10), sectionId: 'sec-3',
  },
  {
    id: '2', title: 'Follow up with Noon payment', description: 'Follow up on pending payment settlement',
    status: 'todo', priority: 'high', dueDate: null, sectionId: 'sec-3',
  },
  {
    id: '3', title: 'Review ads campaign ACOS', description: 'Analyse weekly ACOS and adjust bids',
    status: 'todo', priority: 'medium', dueDate: null, sectionId: 'sec-1',
  },
  {
    id: '4', title: 'Send influencer brief', description: 'Email brief to new influencer for shoot schedule',
    status: 'todo', priority: 'medium', dueDate: null, sectionId: 'sec-1',
  },
  {
    id: '5', title: 'Update employee attendance records', description: 'Mark April attendance for all employees',
    status: 'blocked', priority: 'medium', dueDate: null, sectionId: null,
  },
  {
    id: '6', title: 'Prepare product launch plan', description: 'Strategy doc for Q2 product launch on Amazon KSA',
    status: 'todo', priority: 'high', dueDate: null, sectionId: 'sec-2',
  },
  {
    id: '7', title: 'Reply to supplier emails', description: '',
    status: 'todo', priority: 'low', dueDate: null, sectionId: 'sec-2',
  },
  {
    id: '8', title: 'Review budget report', description: 'Monthly budget vs actuals',
    status: 'done', priority: 'medium', dueDate: null, sectionId: 'sec-3',
  },
]

const AIPlannerContext = createContext(null)

export function AIPlannerProvider({ children }) {
  const [rawTasks, setRawTasks] = useState(() => {
    const stored = loadFromStorage()
    return stored || SEED_TASKS
  })
  const [sections, setSections] = useState(() => {
    const stored = loadSectionsFromStorage()
    return stored || SEED_SECTIONS
  })
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [view, setView] = useState('planner') // 'planner' | 'today' | 'dashboard'

  // Persist whenever rawTasks changes
  useEffect(() => {
    saveToStorage(rawTasks)
  }, [rawTasks])

  // Persist sections
  useEffect(() => {
    saveSectionsToStorage(sections)
  }, [sections])

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
      subtasks: [],
      attachments: [],
      blockedBy: [],
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

  // ── Subtasks ──────────────────────────────────────────────────────────

  const addSubtask = useCallback((taskId, title) => {
    const sub = {
      id: Date.now().toString(),
      title,
      done: false,
      createdAt: new Date().toISOString(),
    }
    setRawTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, subtasks: [...(t.subtasks || []), sub] }
          : t
      )
    )
    return sub
  }, [])

  const toggleSubtask = useCallback((taskId, subId) => {
    setRawTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t
        return {
          ...t,
          subtasks: (t.subtasks || []).map((s) =>
            s.id === subId ? { ...s, done: !s.done } : s
          ),
        }
      })
    )
  }, [])

  const updateSubtask = useCallback((taskId, subId, title) => {
    setRawTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t
        return {
          ...t,
          subtasks: (t.subtasks || []).map((s) =>
            s.id === subId ? { ...s, title } : s
          ),
        }
      })
    )
  }, [])

  const deleteSubtask = useCallback((taskId, subId) => {
    setRawTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t
        return { ...t, subtasks: (t.subtasks || []).filter((s) => s.id !== subId) }
      })
    )
  }, [])

  // ── Attachments (base64, stored in localStorage) ──────────────────────

  const addAttachment = useCallback((taskId, file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const attachment = {
          id: Date.now().toString(),
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: e.target.result,
          uploadedAt: new Date().toISOString(),
        }
        setRawTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, attachments: [...(t.attachments || []), attachment] }
              : t
          )
        )
        resolve(attachment)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }, [])

  const deleteAttachment = useCallback((taskId, attachId) => {
    setRawTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t
        return { ...t, attachments: (t.attachments || []).filter((a) => a.id !== attachId) }
      })
    )
  }, [])

  // ── Dependencies ──────────────────────────────────────────────────────

  const addDependency = useCallback((taskId, blockerTaskId) => {
    if (taskId === blockerTaskId) return
    setRawTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t
        const existing = t.blockedBy || []
        if (existing.includes(blockerTaskId)) return t
        return { ...t, blockedBy: [...existing, blockerTaskId] }
      })
    )
  }, [])

  const removeDependency = useCallback((taskId, blockerTaskId) => {
    setRawTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t
        return { ...t, blockedBy: (t.blockedBy || []).filter((id) => id !== blockerTaskId) }
      })
    )
  }, [])

  // ── Sections ──────────────────────────────────────────────────────────

  const addSection = useCallback((title) => {
    const sec = {
      id: `sec-${Date.now()}`,
      title: title || 'New Section',
      color: '#6b7280',
      order: Date.now(),
    }
    setSections((prev) => [...prev, sec])
    return sec
  }, [])

  const updateSection = useCallback((id, patch) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const deleteSection = useCallback((id) => {
    setSections((prev) => prev.filter((s) => s.id !== id))
    // Move tasks from deleted section to unsectioned
    setRawTasks((prev) =>
      prev.map((t) => (t.sectionId === id ? { ...t, sectionId: null } : t))
    )
  }, [])

  const moveTaskToSection = useCallback((taskId, sectionId) => {
    setRawTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, sectionId: sectionId || null } : t))
    )
  }, [])

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
      addSubtask,
      toggleSubtask,
      updateSubtask,
      deleteSubtask,
      addAttachment,
      deleteAttachment,
      sections,
      addSection,
      updateSection,
      deleteSection,
      moveTaskToSection,
      addDependency,
      removeDependency,
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

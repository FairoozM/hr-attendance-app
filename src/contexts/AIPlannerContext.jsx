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

const STORAGE_KEY          = 'ai_planner_tasks_v2'
const SECTIONS_STORAGE_KEY = 'ai_planner_sections_v2'
const TRASH_STORAGE_KEY    = 'ai_planner_trash_v1'
const RECENTS_STORAGE_KEY  = 'ai_planner_recents_v1'
/** Bump when adding default tasks/sections so existing localStorage gets merged once */
const SEED_REVISION_KEY     = 'ai_planner_seed_revision_v1'
const CURRENT_SEED_REVISION = 1

let _initPlannerCache = null

function initPlannerState() {
  if (_initPlannerCache) return _initPlannerCache

  const tasksStored = loadFromStorage()
  const secStored = loadSectionsFromStorage()
  let rev = 0
  try {
    rev = Number(localStorage.getItem(SEED_REVISION_KEY) || '0')
  } catch {}

  if (!tasksStored && !secStored) {
    try {
      localStorage.setItem(SEED_REVISION_KEY, String(CURRENT_SEED_REVISION))
    } catch {}
    _initPlannerCache = { tasks: SEED_TASKS, sections: SEED_SECTIONS }
    return _initPlannerCache
  }

  let tasks = tasksStored ? [...tasksStored] : [...SEED_TASKS]
  let sections = secStored ? [...secStored] : [...SEED_SECTIONS]

  if (rev < CURRENT_SEED_REVISION) {
    const taskIds = new Set(tasks.map((t) => t.id))
    for (const t of SEED_TASKS) {
      if (!taskIds.has(t.id)) {
        tasks.push(t)
        taskIds.add(t.id)
      }
    }
    const secIds = new Set(sections.map((s) => s.id))
    for (const s of SEED_SECTIONS) {
      if (!secIds.has(s.id)) {
        sections.push(s)
        secIds.add(s.id)
      }
    }
    sections.sort((a, b) => a.order - b.order)
    try {
      localStorage.setItem(SEED_REVISION_KEY, String(CURRENT_SEED_REVISION))
    } catch {}
  }

  _initPlannerCache = { tasks, sections }
  return _initPlannerCache
}

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

function loadTrashFromStorage() {
  try {
    const raw = localStorage.getItem(TRASH_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveTrashToStorage(tasks) {
  try {
    localStorage.setItem(TRASH_STORAGE_KEY, JSON.stringify(tasks))
  } catch {}
}

function loadRecentsFromStorage() {
  try {
    const raw = localStorage.getItem(RECENTS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveRecentsToStorage(ids) {
  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(ids))
  } catch {}
}

/** Default sections — aligned with imported Asana-style workflow lists */
const SEED_SECTIONS = [
  { id: 'sec-daily', title: 'Daily To-Do', color: '#8b5cf6', order: 0 },
  { id: 'sec-weekly', title: 'Weekly', color: '#6366f1', order: 1 },
  { id: 'sec-followup', title: 'Follow-Up', color: '#f59e0b', order: 2 },
  { id: 'sec-monthly', title: 'Monthly Tasks', color: '#10b981', order: 3 },
  { id: 'sec-threat-matrix', title: 'Threat Matrix', color: '#ef4444', order: 4 },
]

/**
 * Default tasks — bulk import from the Life Smile ops Asana list (dates use 2026).
 * Assignee noted in description where it was Abdullah; unassigned rows omitted.
 */
const SEED_TASKS = [
  // —— Daily To-Do ——
  {
    id: 'asana-d1',
    title: 'Open Cliq and check messages',
    description: 'Assignee: Abdullah Ab. · Recurring.',
    status: 'todo',
    priority: 'medium',
    dueDate: '2026-04-09',
    sectionId: 'sec-daily',
  },
  {
    id: 'asana-d2',
    title: 'Check the Apple Email and Clear and Follow Up',
    description: 'Assignee: Abdullah Ab. · Recurring.',
    status: 'todo',
    priority: 'medium',
    dueDate: '2026-03-30',
    sectionId: 'sec-daily',
  },
  {
    id: 'asana-d3',
    title: 'Stelcore Communication about Billing and VAT penalty',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-03-25',
    sectionId: 'sec-daily',
  },
  {
    id: 'asana-d4',
    title: 'Forwarding Invoice to Asad from Wanasa for Payment',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-03-25',
    sectionId: 'sec-daily',
  },
  {
    id: 'asana-d5',
    title: 'UAE VAT invoices related to KSA Amazon to give to Abobecker',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-03-25',
    sectionId: 'sec-daily',
  },
  {
    id: 'asana-d6',
    title: 'KNINExUnit Videos Follow-Up',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'medium',
    dueDate: '2026-03-25',
    sectionId: 'sec-daily',
  },
  {
    id: 'asana-d7',
    title: 'Check the LIFEP24SL-MIX-13-1-SILVER product upload on Amazon',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'medium',
    dueDate: '2026-03-25',
    sectionId: 'sec-daily',
  },
  // —— Weekly ——
  {
    id: 'asana-w1',
    title: 'Clearing the Low Stock Group',
    description: 'Assignee: Abdullah Ab. · Recurring.',
    status: 'todo',
    priority: 'medium',
    dueDate: '2026-03-25',
    sectionId: 'sec-weekly',
  },
  {
    id: 'asana-w2',
    title: 'Weekly Reports Preparation',
    description: 'Assignee: Abdullah Ab. · Recurring.',
    status: 'todo',
    priority: 'medium',
    dueDate: '2026-03-26',
    sectionId: 'sec-weekly',
  },
  // —— Follow-Up ——
  {
    id: 'asana-f1',
    title: 'Shein & Temu Fake Life Smile Product Removal - Registration on Temu',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-03-10',
    sectionId: 'sec-followup',
  },
  {
    id: 'asana-f2',
    title: 'Following up for IP Trademark Life Smile Life Smile for Australia',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-03-10',
    sectionId: 'sec-followup',
  },
  {
    id: 'asana-f3',
    title: 'Mr. Rahim Personal Account (Mr. Rahim Capital Account)',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'medium',
    dueDate: '2026-03-10',
    sectionId: 'sec-followup',
  },
  {
    id: 'asana-f4',
    title: 'Amazon Australia - Trademark Case Checking and Writing the comment',
    description: 'Unassigned in source list — set due date when known.',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    sectionId: 'sec-followup',
  },
  {
    id: 'asana-f5',
    title: 'ZDS + KNIFE SET + FLASK + LIFEP17-MIX-31 + A BIG NEW SET + CAKE MO…',
    description: 'Unassigned · long SKU / product bundle follow-up from Asana.',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    sectionId: 'sec-followup',
  },
  // —— Monthly Tasks ——
  {
    id: 'asana-m1',
    title: 'Salary Preparation and Clearance',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-04-07',
    sectionId: 'sec-monthly',
  },
  // —— Threat Matrix ——
  {
    id: 'asana-tm1',
    title: 'Amazon KSA Stocks, Payment Clearance, FBA',
    description: 'Assignee: Abdullah Ab.',
    status: 'todo',
    priority: 'high',
    dueDate: '2026-03-11',
    sectionId: 'sec-threat-matrix',
  },
]

const AIPlannerContext = createContext(null)

export function AIPlannerProvider({ children }) {
  const [rawTasks, setRawTasks] = useState(() => initPlannerState().tasks)
  const [sections, setSections] = useState(() => initPlannerState().sections)
  const [trashedTasks, setTrashedTasks] = useState(() => loadTrashFromStorage())
  const [recentTaskIds, setRecentTaskIds] = useState(() => loadRecentsFromStorage())
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

  // Persist trash
  useEffect(() => {
    saveTrashToStorage(trashedTasks)
  }, [trashedTasks])

  // Persist recents
  useEffect(() => {
    saveRecentsToStorage(recentTaskIds)
  }, [recentTaskIds])

  // Track recently viewed tasks
  const trackRecent = useCallback((id) => {
    if (!id) return
    setRecentTaskIds((prev) => {
      const filtered = prev.filter((r) => r !== id)
      return [id, ...filtered].slice(0, 10)
    })
  }, [])

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
    const sid = data.sectionId ?? null
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
    setRawTasks((prev) => {
      const inSec = prev.filter((t) => (t.sectionId ?? null) === sid)
      const minL =
        inSec.length > 0
          ? Math.min(...inSec.map((t) => (t.listOrder != null ? t.listOrder : Number.MAX_SAFE_INTEGER)))
          : 1_000_000
      newTask.listOrder = minL - 1000
      return [newTask, ...prev]
    })
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

  // Soft-delete: moves task to trash instead of removing permanently
  const deleteTask = useCallback((id) => {
    setRawTasks((prev) => {
      const task = prev.find((t) => t.id === id)
      if (task) {
        setTrashedTasks((tr) => [{ ...task, deletedAt: new Date().toISOString() }, ...tr])
      }
      return prev.filter((t) => t.id !== id)
    })
    setActiveTaskId((prev) => (prev === id ? null : prev))
  }, [])

  const restoreTask = useCallback((id) => {
    setTrashedTasks((prev) => {
      const task = prev.find((t) => t.id === id)
      if (task) {
        const { deletedAt: _d, ...restored } = task
        setRawTasks((rt) => [restored, ...rt])
      }
      return prev.filter((t) => t.id !== id)
    })
  }, [])

  const permanentlyDeleteTask = useCallback((id) => {
    setTrashedTasks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const emptyTrash = useCallback(() => {
    setTrashedTasks([])
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

  /** Manual list order within a section (AI Task Planner table). */
  const reorderTasksInSection = useCallback((sectionId, draggedId, beforeTaskId) => {
    const sid = sectionId ?? null
    setRawTasks((prev) => {
      const dragged = prev.find((t) => t.id === draggedId)
      if (!dragged || (dragged.sectionId ?? null) !== sid) return prev

      const inSection = prev.filter((t) => (t.sectionId ?? null) === sid)
      if (!inSection.some((t) => t.id === draggedId)) return prev

      let ordered = [...inSection].sort((a, b) => (a.listOrder ?? 0) - (b.listOrder ?? 0))
      let ids = ordered.map((t) => t.id).filter((id) => id !== draggedId)

      if (beforeTaskId === null || beforeTaskId === '__end__') {
        ids.push(draggedId)
      } else {
        const insertAt = ids.indexOf(beforeTaskId)
        if (insertAt === -1) return prev
        ids.splice(insertAt, 0, draggedId)
      }

      const orderMap = Object.fromEntries(ids.map((id, i) => [id, i * 1000]))
      return prev.map((t) => {
        if (orderMap[t.id] !== undefined) return { ...t, listOrder: orderMap[t.id] }
        return t
      })
    })
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
      setActiveTaskId: (id) => { setActiveTaskId(id); if (id) trackRecent(id) },
      addTask,
      updateTask,
      deleteTask,
      restoreTask,
      permanentlyDeleteTask,
      emptyTrash,
      trashedTasks,
      recentTaskIds,
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
      reorderTasksInSection,
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

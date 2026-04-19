/**
 * AI Engine — pure deterministic rule-based logic
 * No external API. All scoring, categorisation, scheduling and
 * quick-capture parsing runs synchronously in the browser.
 */

// ─── Category detection ────────────────────────────────────────────────────

const CATEGORY_RULES = [
  {
    id: 'finance',
    label: 'Finance',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.12)',
    icon: '💰',
    keywords: ['vat', 'invoice', 'payment', 'bank', 'tax', 'salary', 'budget', 'cost', 'expense', 'billing', 'receipt', 'accounting', 'finance', 'refund', 'transfer', 'aed', 'sar', 'revenue'],
  },
  {
    id: 'operations',
    label: 'Operations',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.12)',
    icon: '📦',
    keywords: ['amazon', 'noon', 'stock', 'product', 'inventory', 'shipment', 'warehouse', 'logistics', 'delivery', 'order', 'supplier', 'sku', 'listing', 'asin', 'marketplace', 'store'],
  },
  {
    id: 'communication',
    label: 'Communication',
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.12)',
    icon: '💬',
    keywords: ['email', 'follow-up', 'follow up', 'call', 'meeting', 'reply', 'respond', 'contact', 'message', 'slack', 'whatsapp', 'send', 'reach out', 'coordinate', 'discuss', 'review'],
  },
  {
    id: 'admin',
    label: 'Admin',
    color: '#6b7280',
    bg: 'rgba(107,114,128,0.12)',
    icon: '📋',
    keywords: ['document', 'report', 'file', 'update', 'record', 'hr', 'attendance', 'leave', 'schedule', 'plan', 'organise', 'organize', 'prepare', 'checklist', 'process'],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    color: '#ec4899',
    bg: 'rgba(236,72,153,0.12)',
    icon: '📣',
    keywords: ['ad', 'ads', 'campaign', 'acos', 'ppc', 'influencer', 'social media', 'content', 'post', 'brand', 'promotion', 'marketing', 'creative', 'shoot', 'photo', 'video'],
  },
]

export function detectCategory(title = '', description = '') {
  const text = `${title} ${description}`.toLowerCase()
  let best = null
  let bestScore = 0

  for (const cat of CATEGORY_RULES) {
    let score = 0
    for (const kw of cat.keywords) {
      if (text.includes(kw)) score += kw.split(' ').length // multi-word KWs score higher
    }
    if (score > bestScore) {
      bestScore = score
      best = cat
    }
  }

  return best || { id: 'general', label: 'General', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', icon: '📌' }
}

export function getCategoryById(id) {
  return CATEGORY_RULES.find((c) => c.id === id) || { id: 'general', label: 'General', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', icon: '📌' }
}

// ─── Priority scoring ──────────────────────────────────────────────────────

/**
 * Returns a 0-100 priority score.
 * Factors: urgency keywords, business-impact keywords, due date proximity, blocked status, energy type.
 */
export function calcPriorityScore(task) {
  let score = 40 // baseline

  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase()

  // Urgency keywords (+10 each, max +30)
  const urgencyKws = ['urgent', 'asap', 'today', 'immediately', 'critical', 'deadline', 'overdue', 'now']
  let urgencyHits = 0
  for (const kw of urgencyKws) {
    if (text.includes(kw)) urgencyHits++
  }
  score += Math.min(urgencyHits * 10, 30)

  // Business impact keywords (+8 each, max +24)
  const impactKws = ['amazon', 'vat', 'payment', 'invoice', 'client', 'revenue', 'launch', 'campaign', 'noon', 'legal']
  let impactHits = 0
  for (const kw of impactKws) {
    if (text.includes(kw)) impactHits++
  }
  score += Math.min(impactHits * 8, 24)

  // Due date proximity
  if (task.dueDate) {
    const daysUntil = diffDays(new Date(), new Date(task.dueDate))
    if (daysUntil < 0) score += 25        // overdue
    else if (daysUntil === 0) score += 20  // due today
    else if (daysUntil <= 2) score += 14
    else if (daysUntil <= 7) score += 7
  }

  // Blocked tasks (manual status or unresolved dependencies) get deprioritised
  if (task.status === 'blocked') score -= 20
  if (task._hasUnresolvedDeps) score -= 15

  // Deep work gets a slight boost (more important to schedule early)
  if (task.energyType === 'deep') score += 5

  // Manual priority override
  if (task.priority === 'urgent') score += 15
  else if (task.priority === 'high') score += 8
  else if (task.priority === 'low') score -= 10

  return Math.max(0, Math.min(100, Math.round(score)))
}

function diffDays(a, b) {
  const ms = b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0)
  return Math.round(ms / 86400000)
}

export function priorityLabel(score) {
  if (score >= 80) return { text: 'Critical', color: '#ef4444' }
  if (score >= 65) return { text: 'High', color: '#f97316' }
  if (score >= 45) return { text: 'Medium', color: '#eab308' }
  return { text: 'Low', color: '#22c55e' }
}

export function priorityFlame(score) {
  if (score >= 80) return '🔥🔥🔥'
  if (score >= 65) return '🔥🔥'
  if (score >= 45) return '🔥'
  return ''
}

// ─── Energy type ───────────────────────────────────────────────────────────

const DEEP_WORK_KWS = ['write', 'design', 'build', 'code', 'analyse', 'analyze', 'research', 'plan', 'create', 'develop', 'strategy', 'review', 'audit']
const SHALLOW_WORK_KWS = ['email', 'call', 'meeting', 'reply', 'update', 'send', 'check', 'follow', 'upload', 'download', 'share', 'book', 'schedule']

export function detectEnergyType(title = '') {
  const text = title.toLowerCase()
  let deep = 0, shallow = 0
  DEEP_WORK_KWS.forEach((kw) => { if (text.includes(kw)) deep++ })
  SHALLOW_WORK_KWS.forEach((kw) => { if (text.includes(kw)) shallow++ })
  if (deep > shallow) return 'deep'
  if (shallow > deep) return 'shallow'
  return 'shallow' // default
}

// ─── Duration estimation ───────────────────────────────────────────────────

export function estimateDuration(task) {
  if (task.estimatedMinutes) return task.estimatedMinutes

  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase()

  // Finance / ops tasks tend to take longer
  if (['finance', 'operations'].includes(task.category?.id)) return 60
  if (task.energyType === 'deep') return 90
  if (text.includes('meeting') || text.includes('call')) return 30
  if (text.includes('email') || text.includes('reply') || text.includes('send')) return 15
  return 45 // default
}

// ─── Daily scheduler ──────────────────────────────────────────────────────

const WORK_START_HOUR = 9  // 9:00 AM
const WORK_END_HOUR   = 18 // 6:00 PM
const BUFFER_MINUTES  = 10 // gap between tasks

/**
 * Given a sorted list of tasks, assign time slots for today.
 * Deep-work tasks go to morning (9–12), shallow in afternoon.
 * Returns tasks with { scheduledStart, scheduledEnd } (Date objects).
 */
export function buildDailySchedule(tasks, baseDate = new Date()) {
  const doneTasks    = tasks.filter((t) => t.status === 'done')
  const deepTasks    = tasks.filter((t) => t.energyType === 'deep'    && t.status !== 'done' && t.status !== 'blocked')
  const shallowTasks = tasks.filter((t) => t.energyType !== 'deep'    && t.status !== 'done' && t.status !== 'blocked')
  const blockedTasks = tasks.filter((t) => t.status === 'blocked')

  const ordered = [...deepTasks, ...shallowTasks, ...blockedTasks]

  let cursor = setHour(baseDate, WORK_START_HOUR, 0)
  const workEnd = setHour(baseDate, WORK_END_HOUR, 0)

  const scheduled = ordered.map((task) => {
    const duration = estimateDuration(task)
    const start = new Date(cursor)
    const end   = new Date(cursor.getTime() + duration * 60000)

    if (end > workEnd || task.status === 'blocked') {
      return { ...task, scheduledStart: null, scheduledEnd: null, overflow: true }
    }

    cursor = new Date(end.getTime() + BUFFER_MINUTES * 60000)
    return { ...task, scheduledStart: start, scheduledEnd: end, overflow: false }
  })

  // Done tasks are passed through unchanged so they remain visible in the list
  return [...scheduled, ...doneTasks]
}

function setHour(date, h, m) {
  const d = new Date(date)
  d.setHours(h, m, 0, 0)
  return d
}

export function formatTime(date) {
  if (!date) return ''
  return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

// ─── Quick-capture parser ──────────────────────────────────────────────────

const RELATIVE_DATE_MAP = {
  'today': 0, 'tonight': 0,
  'tomorrow': 1, 'tmr': 1, 'tmrw': 1,
  'next week': 7, 'this week': 0,
  'monday': null, 'tuesday': null, 'wednesday': null,
  'thursday': null, 'friday': null, 'saturday': null, 'sunday': null,
}

const WEEKDAY_MAP = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 }

export function parseQuickCapture(input = '') {
  const raw = input.trim()
  if (!raw) return null

  let title = raw
  let dueDate = null

  // Try to find a date phrase in the input
  const lc = raw.toLowerCase()
  for (const [phrase, days] of Object.entries(RELATIVE_DATE_MAP)) {
    if (lc.includes(phrase)) {
      title = raw.replace(new RegExp(phrase, 'i'), '').replace(/\s+/g, ' ').trim()
      if (days !== null) {
        const d = new Date()
        d.setDate(d.getDate() + days)
        dueDate = d.toISOString().slice(0, 10)
      } else {
        // Named weekday
        const targetDay = WEEKDAY_MAP[phrase]
        const today = new Date().getDay()
        let diff = targetDay - today
        if (diff <= 0) diff += 7
        const d = new Date()
        d.setDate(d.getDate() + diff)
        dueDate = d.toISOString().slice(0, 10)
      }
      break
    }
  }

  // Remove trailing punctuation / filler words
  title = title.replace(/^(please|can you|i need to|need to|make sure to|don't forget to)\s*/i, '')
  title = title.replace(/[.,!?;]+$/, '').trim()
  // Capitalise first letter
  title = title.charAt(0).toUpperCase() + title.slice(1)

  const category = detectCategory(title)
  const energyType = detectEnergyType(title)

  return {
    title,
    dueDate,
    category,
    energyType,
    status: 'todo',
    priority: dueDate ? 'high' : 'medium',
  }
}

// ─── AI Assist suggestions ─────────────────────────────────────────────────

export function generateSuggestions(tasks) {
  const active = tasks.filter((t) => t.status !== 'done')
  const suggestions = []

  // "Start this next" — highest priority non-blocked
  const next = [...active]
    .filter((t) => t.status !== 'blocked')
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))[0]

  if (next) {
    suggestions.push({
      type: 'next',
      icon: '▶️',
      title: 'Start this next',
      body: next.title,
      taskId: next.id,
      color: '#8b5cf6',
    })
  }

  // Overdue risk
  const overdue = active.filter((t) => {
    if (!t.dueDate) return false
    return new Date(t.dueDate) < new Date(new Date().toDateString())
  })
  if (overdue.length > 0) {
    suggestions.push({
      type: 'overdue',
      icon: '⚠️',
      title: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`,
      body: overdue.map((t) => t.title).slice(0, 3).join(', '),
      color: '#ef4444',
    })
  }

  // Batching — group same-category shallow tasks
  const catCounts = {}
  active.filter((t) => t.energyType === 'shallow').forEach((t) => {
    const cat = t.category?.id || 'general'
    catCounts[cat] = (catCounts[cat] || [])
    catCounts[cat].push(t)
  })
  for (const [catId, items] of Object.entries(catCounts)) {
    if (items.length >= 2) {
      const cat = getCategoryById(catId)
      suggestions.push({
        type: 'batch',
        icon: '🗂️',
        title: `Batch ${items.length} ${cat.label} tasks`,
        body: `Do them together: ${items.map((t) => t.title).slice(0, 2).join(', ')}${items.length > 2 ? '…' : ''}`,
        color: cat.color,
      })
      break // one batching suggestion is enough
    }
  }

  // Blocked tasks notice
  const blocked = tasks.filter((t) => t.status === 'blocked')
  if (blocked.length > 0) {
    suggestions.push({
      type: 'blocked',
      icon: '🚫',
      title: `${blocked.length} blocked task${blocked.length > 1 ? 's' : ''}`,
      body: 'Resolve blockers or reschedule these tasks',
      color: '#f97316',
    })
  }

  // Deep work window reminder
  const hour = new Date().getHours()
  const deepPending = active.filter((t) => t.energyType === 'deep' && t.status !== 'blocked')
  if (deepPending.length > 0 && hour < 12) {
    suggestions.push({
      type: 'energy',
      icon: '🧠',
      title: 'Peak focus window',
      body: `Morning is ideal for ${deepPending.length} deep work task${deepPending.length > 1 ? 's' : ''}`,
      color: '#06b6d4',
    })
  }

  return suggestions
}

// ─── Workload analysis ─────────────────────────────────────────────────────

export function analyseWorkload(tasks) {
  const byDay = {}
  tasks.forEach((t) => {
    if (!t.scheduledStart) return
    const day = new Date(t.scheduledStart).toDateString()
    byDay[day] = (byDay[day] || 0) + estimateDuration(t)
  })

  const OVERLOAD_THRESHOLD = 480 // 8 hrs in minutes
  return Object.entries(byDay).map(([day, mins]) => ({
    day,
    minutes: mins,
    overloaded: mins > OVERLOAD_THRESHOLD,
  }))
}

// ─── Auto-reschedule blocked/incomplete tasks ─────────────────────────────

export function rescheduleIncomplete(tasks) {
  return tasks.map((t) => {
    if (t.status === 'done') return t
    if (!t.scheduledStart) return t

    const scheduledDate = new Date(t.scheduledStart)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    scheduledDate.setHours(0, 0, 0, 0)

    if (scheduledDate < today) {
      // Move to today
      return { ...t, rescheduled: true, scheduledStart: null, scheduledEnd: null }
    }
    return t
  })
}

// ─── Dependency resolution ────────────────────────────────────────────────

/**
 * For a given task, return the list of blocker tasks that are NOT yet done.
 * Also returns a boolean _hasUnresolvedDeps flag.
 */
export function resolveBlockers(task, allTasks) {
  const deps = task.blockedBy || []
  if (deps.length === 0) return { blockers: [], unresolvedBlockers: [], _hasUnresolvedDeps: false }

  const taskMap = Object.fromEntries(allTasks.map((t) => [t.id, t]))
  const blockers = deps.map((id) => taskMap[id]).filter(Boolean)
  const unresolvedBlockers = blockers.filter((b) => b.status !== 'done')

  return {
    blockers,
    unresolvedBlockers,
    _hasUnresolvedDeps: unresolvedBlockers.length > 0,
  }
}

// ─── Full enrichment pipeline ─────────────────────────────────────────────

/**
 * Run all AI enrichment steps on a raw task array.
 * Returns enriched tasks sorted by priority score (descending).
 */
export function enrichTasks(rawTasks) {
  // First pass: basic enrichment without dep info
  const firstPass = rawTasks.map((task) => {
    const category   = task.category   || detectCategory(task.title, task.description)
    const energyType = task.energyType || detectEnergyType(task.title)
    return { ...task, category, energyType }
  })

  // Second pass: resolve dependencies (needs full array for lookups)
  const enriched = firstPass.map((task) => {
    const { _hasUnresolvedDeps, unresolvedBlockers } = resolveBlockers(task, firstPass)
    const base = { ...task, _hasUnresolvedDeps, _unresolvedBlockerIds: unresolvedBlockers.map((b) => b.id) }
    const priorityScore = calcPriorityScore(base)
    return { ...base, priorityScore }
  })

  return enriched.sort((a, b) => b.priorityScore - a.priorityScore)
}

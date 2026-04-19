// ─── AI Engine — pure rule-based, deterministic, no external API ──────────────
// All functions are stateless: same input → same output.

// ---------------------------------------------------------------------------
// Keyword dictionaries
// ---------------------------------------------------------------------------

const FINANCE_KEYWORDS    = ['invoice', 'vat', 'payment', 'tax', 'salary', 'payroll', 'budget', 'expense', 'bill', 'receipt', 'finance', 'accounting', 'refund', 'charge', 'fee', 'cost', 'price']
const OPERATIONS_KEYWORDS = ['amazon', 'noon', 'stock', 'product', 'listing', 'shipment', 'inventory', 'warehouse', 'supplier', 'order', 'fulfillment', 'fba', 'sku', 'asin', 'logistics', 'dispatch']
const COMMS_KEYWORDS      = ['email', 'follow-up', 'followup', 'reply', 'call', 'meeting', 'message', 'contact', 'slack', 'whatsapp', 'respond', 'feedback', 'review', 'discuss', 'coordinate']
const ADMIN_KEYWORDS      = ['admin', 'document', 'file', 'report', 'update', 'record', 'register', 'form', 'contract', 'policy', 'procedure', 'compliance', 'approval', 'audit', 'hr']

const URGENCY_KEYWORDS    = ['urgent', 'asap', 'critical', 'immediately', 'emergency', 'deadline', 'overdue', 'important']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textOf(task) {
  return `${task.title || ''} ${task.description || ''}`.toLowerCase()
}

function daysUntilDue(task) {
  if (!task.due_date) return null
  const due  = new Date(task.due_date)
  const now  = new Date()
  due.setHours(0, 0, 0, 0)
  now.setHours(0, 0, 0, 0)
  return Math.floor((due - now) / (1000 * 60 * 60 * 24))
}

function matchesAny(text, keywords) {
  return keywords.some(kw => text.includes(kw))
}

// ---------------------------------------------------------------------------
// 1. Priority Score  0–100
// ---------------------------------------------------------------------------

export function scorePriority(task) {
  let score = 30 // baseline

  // Due date urgency
  const days = daysUntilDue(task)
  if (days !== null) {
    if (days < 0)      score += 45  // overdue
    else if (days === 0) score += 40 // today
    else if (days === 1) score += 28 // tomorrow
    else if (days <= 3)  score += 18 // this week
    else if (days <= 7)  score += 10
  }

  // Explicit priority field from backend
  const prio = (task.priority || '').toLowerCase()
  if (prio === 'urgent')   score += 20
  else if (prio === 'high') score += 12
  else if (prio === 'low')  score -= 8

  // Business impact keywords
  const text = textOf(task)
  if (matchesAny(text, URGENCY_KEYWORDS))    score += 18
  if (matchesAny(text, FINANCE_KEYWORDS))    score += 15
  if (matchesAny(text, OPERATIONS_KEYWORDS)) score += 12
  if (matchesAny(text, COMMS_KEYWORDS))      score +=  6

  // Blocked tasks get deprioritized
  if (task.status === 'Blocked' || task.is_blocked) score -= 25

  // Completed tasks have no urgency
  if (task.status === 'Done' || task.completed_at)  score = 0

  return Math.max(0, Math.min(100, Math.round(score)))
}

// ---------------------------------------------------------------------------
// 2. Category detection
// ---------------------------------------------------------------------------

export function detectCategory(task) {
  const text = textOf(task)
  if (matchesAny(text, FINANCE_KEYWORDS))    return 'Finance'
  if (matchesAny(text, OPERATIONS_KEYWORDS)) return 'Operations'
  if (matchesAny(text, COMMS_KEYWORDS))      return 'Communication'
  return 'Admin'
}

// ---------------------------------------------------------------------------
// 3. Energy type
// ---------------------------------------------------------------------------

export function detectEnergyType(task) {
  const cat = detectCategory(task)
  if (cat === 'Finance' || cat === 'Operations') return 'Deep Work'
  return 'Shallow Work'
}

// ---------------------------------------------------------------------------
// 4. Estimated duration (minutes)
// ---------------------------------------------------------------------------

export function estimateDuration(task) {
  if (task.estimated_hours) return Math.round(task.estimated_hours * 60)
  const energy = detectEnergyType(task)
  return energy === 'Deep Work' ? 90 : 30
}

// ---------------------------------------------------------------------------
// 5. Daily plan builder
// Returns array of { task, startMinutes, endMinutes, hour, label }
// Deep Work → 09:00–12:00 | Shallow Work → 13:00–17:00
// ---------------------------------------------------------------------------

export function buildDailyPlan(tasks, date = new Date()) {
  const dateStr = toDateStr(date)

  // Only schedule non-done tasks
  const eligible = tasks.filter(t =>
    t.status !== 'Done' &&
    !t.completed_at &&
    !t.archived
  )

  // Sort by priority descending
  const sorted = [...eligible].sort((a, b) => scorePriority(b) - scorePriority(a))

  const deepSlots   = sorted.filter(t => !t.is_blocked && detectEnergyType(t) === 'Deep Work')
  const shallowSlots = sorted.filter(t => !t.is_blocked && detectEnergyType(t) === 'Shallow Work')
  const blockedSlots = sorted.filter(t => t.is_blocked || t.status === 'Blocked')

  const plan = []

  // Deep work: 09:00 (540 min) – 12:00 (720 min)
  let cursor = 540
  const deepEnd = 720
  for (const task of deepSlots) {
    const dur = estimateDuration(task)
    if (cursor + dur > deepEnd) break
    plan.push({ task, startMinutes: cursor, endMinutes: cursor + dur, slot: 'morning' })
    cursor += dur + 10 // 10 min buffer
  }

  // Shallow work: 13:00 (780 min) – 17:00 (1020 min)
  cursor = 780
  const shallowEnd = 1020
  for (const task of shallowSlots) {
    const dur = estimateDuration(task)
    if (cursor + dur > shallowEnd) break
    plan.push({ task, startMinutes: cursor, endMinutes: cursor + dur, slot: 'afternoon' })
    cursor += dur + 5
  }

  // Blocked tasks: 17:00+ or flagged as "needs unblocking"
  cursor = 1020
  for (const task of blockedSlots) {
    plan.push({ task, startMinutes: cursor, endMinutes: cursor + 30, slot: 'blocked' })
    cursor += 35
  }

  return plan
}

// ---------------------------------------------------------------------------
// 6. Enrich a tasks array with AI fields (non-mutating)
// ---------------------------------------------------------------------------

export function enrichTasks(tasks) {
  return tasks.map(task => ({
    ...task,
    priorityScore: scorePriority(task),
    category:      detectCategory(task),
    energyType:    detectEnergyType(task),
    daysUntilDue:  daysUntilDue(task),
  }))
}

// ---------------------------------------------------------------------------
// 7. Quick Capture parser
// "Check Amazon VAT invoices tomorrow at 10am"
// Returns { title, category, suggestedDate, suggestedTime, rawText }
// ---------------------------------------------------------------------------

export function parseCapture(text) {
  if (!text || !text.trim()) return null

  const lower = text.toLowerCase().trim()
  let suggestedDate = null
  let suggestedTime = null
  let cleanTitle = text.trim()

  // ── Date extraction ──
  const today    = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

  if (/\btoday\b/.test(lower)) {
    suggestedDate = toDateStr(today)
    cleanTitle = cleanTitle.replace(/\btoday\b/gi, '').trim()
  } else if (/\btomorrow\b/.test(lower)) {
    suggestedDate = toDateStr(tomorrow)
    cleanTitle = cleanTitle.replace(/\btomorrow\b/gi, '').trim()
  } else {
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    for (let i = 0; i < dayNames.length; i++) {
      if (lower.includes(dayNames[i])) {
        const target = new Date(today)
        const diff = (i - today.getDay() + 7) % 7 || 7
        target.setDate(today.getDate() + diff)
        suggestedDate = toDateStr(target)
        cleanTitle = cleanTitle.replace(new RegExp(dayNames[i], 'gi'), '').trim()
        break
      }
    }
  }

  // ── Time extraction ──
  // Matches: 10am, 2:30pm, 14:00, 9 am
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  if (timeMatch) {
    let hour   = parseInt(timeMatch[1])
    const min  = parseInt(timeMatch[2] || '0')
    const ampm = timeMatch[3]
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    suggestedTime = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    cleanTitle = cleanTitle.replace(timeMatch[0], '').trim()
  }

  // ── Category ──
  const mockTask = { title: text, description: '' }
  const category = detectCategory(mockTask)

  // Clean up double spaces / trailing punctuation
  cleanTitle = cleanTitle.replace(/\s{2,}/g, ' ').replace(/[,.\s]+$/, '').trim()

  return {
    title: cleanTitle || text.trim(),
    category,
    suggestedDate,
    suggestedTime,
    rawText: text.trim(),
  }
}

// ---------------------------------------------------------------------------
// 8. AI Assist suggestions
// Returns array of suggestion objects for the AIAssistPanel
// ---------------------------------------------------------------------------

export function buildAssistSuggestions(tasks) {
  const enriched  = enrichTasks(tasks).filter(t => t.status !== 'Done' && !t.completed_at && !t.archived)
  const suggestions = []

  // "Start this next" — highest priority non-blocked task
  const nextUp = enriched
    .filter(t => !t.is_blocked && t.status !== 'Blocked')
    .sort((a, b) => b.priorityScore - a.priorityScore)[0]

  if (nextUp) {
    suggestions.push({
      type:    'next',
      icon:    'zap',
      title:   'Start this next',
      message: nextUp.title,
      taskId:  nextUp.id,
      score:   nextUp.priorityScore,
    })
  }

  // Overdue risks
  const overdue = enriched.filter(t => t.daysUntilDue !== null && t.daysUntilDue < 0)
  if (overdue.length > 0) {
    suggestions.push({
      type:    'overdue',
      icon:    'alert-triangle',
      title:   `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`,
      message: overdue.map(t => t.title).slice(0, 3).join(', '),
      tasks:   overdue,
    })
  }

  // Due today risk
  const dueToday = enriched.filter(t => t.daysUntilDue === 0)
  if (dueToday.length > 0) {
    suggestions.push({
      type:    'today',
      icon:    'clock',
      title:   `${dueToday.length} due today`,
      message: dueToday.map(t => t.title).slice(0, 2).join(', '),
      tasks:   dueToday,
    })
  }

  // Batch suggestion — group same category
  const catCounts = {}
  enriched.forEach(t => { catCounts[t.category] = (catCounts[t.category] || 0) + 1 })
  const batchCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]
  if (batchCat && batchCat[1] >= 2) {
    suggestions.push({
      type:    'batch',
      icon:    'layers',
      title:   `Batch ${batchCat[0]} tasks`,
      message: `You have ${batchCat[1]} ${batchCat[0]} tasks — do them together for focus`,
      category: batchCat[0],
    })
  }

  // Blocked tasks warning
  const blocked = enriched.filter(t => t.is_blocked || t.status === 'Blocked')
  if (blocked.length > 0) {
    suggestions.push({
      type:    'blocked',
      icon:    'shield-off',
      title:   `${blocked.length} blocked`,
      message: `Resolve blockers: ${blocked.map(t => t.title).slice(0, 2).join(', ')}`,
      tasks:   blocked,
    })
  }

  return suggestions
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateStr(date) {
  return date.toISOString().slice(0, 10)
}

export function minutesToTime(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const CATEGORY_META = {
  Finance:       { color: '#34d399', bg: 'rgba(52,211,153,0.12)',  icon: '💰' },
  Operations:    { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  icon: '📦' },
  Communication: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: '💬' },
  Admin:         { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '📋' },
}

export const ENERGY_META = {
  'Deep Work':    { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  label: 'Deep' },
  'Shallow Work': { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', label: 'Shallow' },
}

// Future-ready stubs
// TODO: export async function syncGoogleCalendar(tasks) { /* Google Calendar API */ }
// TODO: export async function captureFromSlack(webhook)  { /* Slack Events API */ }
// TODO: export async function captureFromEmail(imap)     { /* IMAP integration */ }

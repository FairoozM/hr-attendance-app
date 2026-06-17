/**
 * Recurring tasks (Asana-style): next occurrence dates and cloning when completing.
 */

function toIso(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysToIso(iso, days) {
  const parts = String(iso).split('-').map(Number)
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null
  const dt = new Date(parts[0], parts[1] - 1, parts[2])
  if (Number.isNaN(dt.getTime())) return null
  dt.setDate(dt.getDate() + days)
  return toIso(dt)
}

export function addMonthsToIso(iso, deltaMonths) {
  const parts = String(iso).split('-').map(Number)
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null
  const dt = new Date(parts[0], parts[1] - 1 + deltaMonths, parts[2])
  if (Number.isNaN(dt.getTime())) return null
  return toIso(dt)
}

/** Effective recurrence: stored field, or infer daily from legacy "Recurring" in description */
export function effectiveRecurrence(task) {
  const r = task.recurrence
  if (r && r !== 'none') return r
  if (typeof task.description === 'string' && /recurring/i.test(task.description)) return 'daily'
  return 'none'
}

/**
 * Next due dates after completing one instance (null if not recurring or no due date).
 */
export function nextOccurrenceAfterComplete(task) {
  const rec = effectiveRecurrence(task)
  if (rec === 'none' || !task.dueDate) return null

  const end = task.dueDate
  const start = task.dueDateStart || end
  const hasRange = Boolean(start && end && start !== end)

  let nextEnd
  let nextStart
  if (rec === 'daily') {
    nextEnd = addDaysToIso(end, 1)
    nextStart = hasRange ? addDaysToIso(start, 1) : nextEnd
  } else if (rec === 'weekly') {
    nextEnd = addDaysToIso(end, 7)
    nextStart = hasRange ? addDaysToIso(start, 7) : nextEnd
  } else if (rec === 'monthly') {
    nextEnd = addMonthsToIso(end, 1)
    nextStart = hasRange ? addMonthsToIso(start, 1) : nextEnd
  } else {
    return null
  }

  if (!nextEnd || !nextStart) return null

  return {
    dueDate: nextEnd,
    dueDateStart: hasRange ? nextStart : null,
  }
}

function stripRuntimeEnrichment(task) {
  const {
    priorityScore,
    scheduledStart,
    scheduledEnd,
    _hasUnresolvedDeps,
    _unresolvedBlockerIds,
    ...base
  } = task
  return base
}

/**
 * New todo task for the next occurrence (same metadata, fresh subtasks, new id).
 */
export function spawnNextRecurrenceTask(task) {
  const next = nextOccurrenceAfterComplete(task)
  if (!next) return null

  const base = stripRuntimeEnrichment(task)
  const hadRange = Boolean(task.dueDateStart && task.dueDateStart !== task.dueDate)
  const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const freshSubtasks = (base.subtasks || []).map((s) => ({ ...s, done: false }))

  const rec = effectiveRecurrence(task)

  return {
    ...base,
    id: newId,
    status: 'todo',
    recurrence: rec,
    dueDate: next.dueDate,
    dueDateStart: hadRange ? next.dueDateStart : null,
    subtasks: freshSubtasks,
    createdAt: new Date().toISOString(),
  }
}

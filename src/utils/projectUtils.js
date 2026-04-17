// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ['Not Started', 'In Progress', 'Blocked', 'On Hold', 'Completed']
export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
export const PROJECT_STATUSES = ['Planning', 'Active', 'On Hold', 'Completed', 'Archived']
export const PROJECT_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
export const DEPENDENCY_TYPES = ['finish-to-start', 'start-to-start', 'finish-to-finish']

export const STATUS_COLORS = {
  'Not Started': '#64748b',
  'In Progress': '#3b82f6',
  'Blocked': '#ef4444',
  'On Hold': '#f59e0b',
  'Completed': '#22c55e',
  'Planning': '#8b5cf6',
  'Active': '#3b82f6',
  'Archived': '#64748b',
}

export const PRIORITY_COLORS = {
  Low: '#22c55e',
  Medium: '#3b82f6',
  High: '#f59e0b',
  Urgent: '#ef4444',
}

export const PROJECT_COLORS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#f97316', '#84cc16',
]

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * Calculates project progress as a percentage (0–100) based on top-level tasks only.
 */
export function calcProjectProgress(tasks) {
  if (!tasks || tasks.length === 0) return 0
  const topLevel = tasks.filter((t) => !t.parent_task_id && !t.archived)
  if (topLevel.length === 0) return 0
  const completed = topLevel.filter((t) => t.status === 'Completed').length
  return Math.round((completed / topLevel.length) * 100)
}

/**
 * Flattens nested tasks (including subtasks) into a single array.
 */
export function flattenTasks(tasks) {
  const result = []
  function walk(list) {
    for (const t of list || []) {
      result.push(t)
      if (t.subtasks?.length) walk(t.subtasks)
    }
  }
  walk(tasks)
  return result
}

// ---------------------------------------------------------------------------
// Filtering helpers
// ---------------------------------------------------------------------------

export function getOverdueTasks(tasks) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return flattenTasks(tasks).filter((t) => {
    if (!t.due_date || t.status === 'Completed' || t.archived) return false
    return new Date(t.due_date) < today
  })
}

export function getBlockedTasks(tasks) {
  return flattenTasks(tasks).filter((t) => t.is_blocked && t.status !== 'Completed' && !t.archived)
}

export function getUpcomingTasks(tasks, days = 7) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const future = new Date(today)
  future.setDate(future.getDate() + days)
  return flattenTasks(tasks).filter((t) => {
    if (!t.due_date || t.status === 'Completed' || t.archived) return false
    const due = new Date(t.due_date)
    return due >= today && due <= future
  })
}

export function getCompletedTasks(tasks) {
  return flattenTasks(tasks).filter((t) => t.status === 'Completed' && !t.archived)
}

// ---------------------------------------------------------------------------
// Aggregation for dashboard
// ---------------------------------------------------------------------------

export function aggregateDashboardStats(projects, tasksByProject) {
  let totalTasks = 0
  let completedTasks = 0
  let overdueTasks = 0
  let blockedTasks = 0

  for (const project of projects) {
    const tasks = tasksByProject[project.id] || []
    const flat = flattenTasks(tasks)
    totalTasks += flat.filter((t) => !t.archived).length
    completedTasks += flat.filter((t) => t.status === 'Completed' && !t.archived).length
    overdueTasks += getOverdueTasks(tasks).length
    blockedTasks += getBlockedTasks(tasks).length
  }

  const activeProjects = projects.filter((p) => p.status === 'Active' && !p.archived).length
  const completedProjects = projects.filter((p) => p.status === 'Completed').length

  return {
    totalProjects: projects.filter((p) => !p.archived).length,
    activeProjects,
    completedProjects,
    totalTasks,
    completedTasks,
    overdueTasks,
    blockedTasks,
  }
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Groups top-level tasks by section. Returns an array of { section, tasks } objects.
 * Unsectioned tasks go into a default "No Section" group.
 */
export function groupTasksBySections(tasks, sections) {
  const topLevel = tasks.filter((t) => !t.parent_task_id)
  const grouped = []

  for (const section of sections) {
    grouped.push({
      section,
      tasks: topLevel.filter((t) => t.section_id === section.id),
    })
  }

  const unsectioned = topLevel.filter((t) => !t.section_id)
  if (unsectioned.length > 0 || sections.length === 0) {
    grouped.push({
      section: { id: null, name: 'Unsectioned', sort_order: 9999 },
      tasks: unsectioned,
    })
  }

  return grouped
}

// ---------------------------------------------------------------------------
// Client-side circular dependency check
// ---------------------------------------------------------------------------

/**
 * Given an adjacency map { taskId: [dependsOnTaskId, ...] }, checks if adding
 * an edge (taskId → dependsOnTaskId) would create a cycle. Returns true if it would.
 */
export function detectCircularDependency(graph, taskId, dependsOnTaskId) {
  if (taskId === dependsOnTaskId) return true
  const visited = new Set()
  const stack = [dependsOnTaskId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (visited.has(current)) continue
    visited.add(current)
    const deps = graph[current] || []
    for (const dep of deps) {
      if (dep === taskId) return true
      if (!visited.has(dep)) stack.push(dep)
    }
  }
  return false
}

/**
 * Builds an adjacency map from a flat task list (including nested subtasks).
 */
export function buildDependencyGraph(tasks) {
  const graph = {}
  for (const task of flattenTasks(tasks)) {
    graph[task.id] = (task.dependencies || []).map((d) => d.depends_on_task_id)
  }
  return graph
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDueDate(dateStr) {
  if (!dateStr) return null
  const date = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  date.setHours(0, 0, 0, 0)
  const diff = Math.round((date - today) / (1000 * 60 * 60 * 24))
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, overdue: true }
  if (diff === 0) return { label: 'Due today', today: true }
  if (diff === 1) return { label: 'Due tomorrow', soon: true }
  if (diff <= 7) return { label: `Due in ${diff}d`, soon: true }
  return {
    label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    overdue: false,
  }
}

export function getFileIcon(fileType) {
  if (!fileType) return '📄'
  if (fileType.startsWith('image/')) return '🖼️'
  if (fileType === 'application/pdf') return '📕'
  if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv')) return '📊'
  if (fileType.includes('word') || fileType.includes('document')) return '📝'
  if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('tar')) return '🗜️'
  return '📄'
}

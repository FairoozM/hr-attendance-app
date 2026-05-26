/**
 * TeamProjectsContext.jsx
 *
 * Provides server-backed team project data for the Jira-like planner.
 * Lives in PARALLEL with the existing AIPlannerContext — does NOT replace it.
 *
 * Usage:
 *   const { projects, tasks, members, loading, error, actions } = useTeamProjects()
 *
 * The context is intentionally thin: it manages async state and exposes raw
 * normalised data from projectsApi.js. Page components handle their own
 * derived/filtered views via local state or useMemo.
 */

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  projectsApi,
  tasksApi,
  teamApi,
  cyclesApi,
  sprintsApi,
  normalizeTask,
  normalizeProject,
} from '../lib/projectsApi'

// ─────────────────────────────────────────────────────────────────────────────

const TeamProjectsContext = createContext(null)
const CACHE_TTL_MS = 5 * 60 * 1000

function isFresh(timestamp, ttl = CACHE_TTL_MS) {
  return Number.isFinite(timestamp) && (Date.now() - timestamp) < ttl
}

// ─────────────────────────────────────────────────────────────────────────────

export function TeamProjectsProvider({ children }) {
  // ── State ─────────────────────────────────────────────────────────────────

  const [projects,  setProjects]  = useState([])
  const [members,   setMembers]   = useState([])
  const [sprints,   setSprints]   = useState({}) // { [projectId]: Sprint[] }
  const [cycles,    setCycles]    = useState({}) // { [projectId]: Cycle[] }
  const [taskCache, setTaskCache] = useState({}) // { [projectId]: Task[] }

  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingMembers,  setLoadingMembers]  = useState(false)
  const [loadingTasks,    setLoadingTasks]    = useState({}) // { [projectId]: boolean }

  const [error, setError] = useState(null)

  // Prevent duplicate in-flight fetches
  const fetchingRef = useRef({ projects: false, members: false, tasks: {}, cycles: {}, sprints: {} })
  const fetchedAtRef = useRef({ projects: 0, members: 0, tasks: {}, cycles: {}, sprints: {} })
  const projectsRef = useRef(projects)
  const membersRef = useRef(members)
  const taskCacheRef = useRef(taskCache)
  const cyclesRef = useRef(cycles)
  const sprintsRef = useRef(sprints)

  useEffect(() => { projectsRef.current = projects }, [projects])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { taskCacheRef.current = taskCache }, [taskCache])
  useEffect(() => { cyclesRef.current = cycles }, [cycles])
  useEffect(() => { sprintsRef.current = sprints }, [sprints])

  // ── Project actions ───────────────────────────────────────────────────────

  const fetchProjects = useCallback(async (opts = {}) => {
    const force = opts?.force === true
    const hasCustomOpts = Object.keys(opts || {}).some((key) => key !== 'force')
    if (!force && !hasCustomOpts && projectsRef.current.length > 0 && isFresh(fetchedAtRef.current.projects)) {
      return projectsRef.current
    }
    if (fetchingRef.current.projects) return projectsRef.current
    fetchingRef.current.projects = true
    setLoadingProjects(true)
    setError(null)
    try {
      const rows = await projectsApi.list(opts)
      setProjects(rows)
      fetchedAtRef.current.projects = Date.now()
      return rows
    } catch (err) {
      console.error('[TeamProjects] fetchProjects:', err)
      setError(err.message || 'Failed to load projects')
      return projectsRef.current
    } finally {
      setLoadingProjects(false)
      fetchingRef.current.projects = false
    }
  }, [])

  const createProject = useCallback(async (data) => {
    const project = await projectsApi.create(data)
    setProjects((prev) => [project, ...prev])
    return project
  }, [])

  const updateProject = useCallback(async (id, data) => {
    const updated = await projectsApi.update(id, data)
    setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)))
    return updated
  }, [])

  const deleteProject = useCallback(async (id) => {
    await projectsApi.delete(id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
    setTaskCache((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setCycles((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setSprints((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    delete fetchedAtRef.current.tasks[id]
    delete fetchedAtRef.current.cycles[id]
    delete fetchedAtRef.current.sprints[id]
  }, [])

  // ── Task actions ──────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async (projectId, params = {}) => {
    const { force = false, ...apiParams } = params || {}
    const shouldUseCache = !force && Object.keys(apiParams).length === 0
    if (shouldUseCache && taskCacheRef.current[projectId] && isFresh(fetchedAtRef.current.tasks[projectId])) {
      return taskCacheRef.current[projectId]
    }
    if (fetchingRef.current.tasks[projectId]) return taskCacheRef.current[projectId] || []
    fetchingRef.current.tasks[projectId] = true
    setLoadingTasks((prev) => ({ ...prev, [projectId]: true }))
    try {
      const rows = await tasksApi.list(projectId, apiParams)
      setTaskCache((prev) => ({ ...prev, [projectId]: rows }))
      if (Object.keys(apiParams).length === 0) fetchedAtRef.current.tasks[projectId] = Date.now()
      return rows
    } catch (err) {
      console.error('[TeamProjects] fetchTasks:', err)
      setError(err.message || 'Failed to load tasks')
      return taskCacheRef.current[projectId] || []
    } finally {
      setLoadingTasks((prev) => ({ ...prev, [projectId]: false }))
      fetchingRef.current.tasks[projectId] = false
    }
  }, [])

  const createTask = useCallback(async (projectId, data) => {
    const task = await tasksApi.create(projectId, data)
    setTaskCache((prev) => ({
      ...prev,
      [projectId]: [task, ...(prev[projectId] || [])],
    }))
    return task
  }, [])

  const updateTask = useCallback(async (projectId, taskId, data) => {
    const updated = await tasksApi.update(projectId, taskId, data)
    setTaskCache((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] || []).map((t) =>
        t.id === taskId ? updated : t
      ),
    }))
    return updated
  }, [])

  const deleteTask = useCallback(async (projectId, taskId) => {
    await tasksApi.delete(projectId, taskId)
    setTaskCache((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] || []).filter((t) => t.id !== taskId),
    }))
  }, [])

  // ── Team members ──────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async (opts = {}) => {
    const force = opts?.force === true
    if (!force && membersRef.current.length > 0 && isFresh(fetchedAtRef.current.members)) {
      return membersRef.current
    }
    if (fetchingRef.current.members) return membersRef.current
    fetchingRef.current.members = true
    setLoadingMembers(true)
    try {
      const rows = await teamApi.listMembers()
      setMembers(rows)
      fetchedAtRef.current.members = Date.now()
      return rows
    } catch (err) {
      console.error('[TeamProjects] fetchMembers:', err)
      // Non-fatal: assignee pickers just show empty
      return membersRef.current
    } finally {
      setLoadingMembers(false)
      fetchingRef.current.members = false
    }
  }, [])

  // ── Sprint actions (legacy — kept for compat) ────────────────────────────

  const fetchSprints = useCallback(async (projectId, opts = {}) => {
    const force = opts?.force === true
    if (!force && sprintsRef.current[projectId] && isFresh(fetchedAtRef.current.sprints[projectId])) {
      return sprintsRef.current[projectId]
    }
    if (fetchingRef.current.sprints[projectId]) return sprintsRef.current[projectId] || []
    fetchingRef.current.sprints[projectId] = true
    try {
      const rows = await sprintsApi.list(projectId)
      setSprints((prev) => ({ ...prev, [projectId]: Array.isArray(rows) ? rows : [] }))
      fetchedAtRef.current.sprints[projectId] = Date.now()
      return Array.isArray(rows) ? rows : []
    } catch {
      // Legacy endpoint not available — silently ignore
      return sprintsRef.current[projectId] || []
    } finally {
      fetchingRef.current.sprints[projectId] = false
    }
  }, [])

  // ── Cycle actions (Phase 4B) ──────────────────────────────────────────────

  const fetchCycles = useCallback(async (projectId, opts = {}) => {
    const force = opts?.force === true
    if (!force && cyclesRef.current[projectId] && isFresh(fetchedAtRef.current.cycles[projectId])) {
      return cyclesRef.current[projectId]
    }
    if (fetchingRef.current.cycles[projectId]) return cyclesRef.current[projectId] || []
    fetchingRef.current.cycles[projectId] = true
    try {
      const rows = await cyclesApi.list(projectId)
      setCycles((prev) => ({ ...prev, [projectId]: Array.isArray(rows) ? rows : [] }))
      fetchedAtRef.current.cycles[projectId] = Date.now()
      return Array.isArray(rows) ? rows : []
    } catch (err) {
      console.error('[TeamProjects] fetchCycles:', err)
      // Non-fatal: cycle pickers just show empty
      return cyclesRef.current[projectId] || []
    } finally {
      fetchingRef.current.cycles[projectId] = false
    }
  }, [])

  const createCycle = useCallback(async (projectId, data) => {
    const cycle = await cyclesApi.create(projectId, data)
    setCycles((prev) => ({
      ...prev,
      [projectId]: [...(prev[projectId] || []), cycle],
    }))
    return cycle
  }, [])

  const updateCycle = useCallback(async (projectId, cycleId, data) => {
    const updated = await cyclesApi.update(projectId, cycleId, data)
    setCycles((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] || []).map((c) => (c.id === cycleId ? updated : c)),
    }))
    return updated
  }, [])

  // ── Normalisation helpers (re-exported for convenience) ───────────────────

  // ── Selectors ─────────────────────────────────────────────────────────────

  const getTasksForProject = useCallback(
    (projectId) => taskCache[projectId] || [],
    [taskCache]
  )

  const getSprintsForProject = useCallback(
    (projectId) => sprints[projectId] || [],
    [sprints]
  )

  const getCyclesForProject = useCallback(
    (projectId) => cycles[projectId] || [],
    [cycles]
  )

  const getMemberById = useCallback(
    (id) => members.find((m) => m.id === id) || null,
    [members]
  )

  // ── Context value ─────────────────────────────────────────────────────────

  const actions = useMemo(() => ({
    // Projects
    fetchProjects,
    refreshProjects: () => fetchProjects({ force: true }),
    createProject,
    updateProject,
    deleteProject,

    // Tasks
    fetchTasks,
    refreshTasks: (projectId) => fetchTasks(projectId, { force: true }),
    createTask,
    updateTask,
    deleteTask,

    // Team
    fetchMembers,
    refreshMembers: () => fetchMembers({ force: true }),

    // Sprints (legacy)
    fetchSprints,
    refreshSprints: (projectId) => fetchSprints(projectId, { force: true }),

    // Cycles (Phase 4B)
    fetchCycles,
    refreshCycles: (projectId) => fetchCycles(projectId, { force: true }),
    createCycle,
    updateCycle,
  }), [
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    fetchMembers,
    fetchSprints,
    fetchCycles,
    createCycle,
    updateCycle,
  ])

  const value = useMemo(() => ({
    // Data
    projects,
    members,

    // Loading states
    loadingProjects,
    loadingMembers,
    loadingTasks,

    // Error
    error,

    // Selectors
    getTasksForProject,
    getSprintsForProject,
    getCyclesForProject,
    getMemberById,

    // Normalisation helpers (consumers can normalise ad-hoc data)
    normalizeTask,
    normalizeProject,

    // Actions
    actions,
  }), [
    projects,
    members,
    loadingProjects,
    loadingMembers,
    loadingTasks,
    error,
    getTasksForProject,
    getSprintsForProject,
    getCyclesForProject,
    getMemberById,
    actions,
  ])

  return (
    <TeamProjectsContext.Provider value={value}>
      {children}
    </TeamProjectsContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to consume the TeamProjectsContext.
 * Must be used inside <TeamProjectsProvider>.
 */
export function useTeamProjectsContext() {
  const ctx = useContext(TeamProjectsContext)
  if (!ctx) {
    throw new Error('useTeamProjectsContext must be used within <TeamProjectsProvider>')
  }
  return ctx
}

export default TeamProjectsContext

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

import { createContext, useContext, useState, useCallback, useRef } from 'react'
import {
  projectsApi,
  tasksApi,
  teamApi,
  sprintsApi,
  normalizeTask,
  normalizeProject,
} from '../lib/projectsApi'

// ─────────────────────────────────────────────────────────────────────────────

const TeamProjectsContext = createContext(null)

// ─────────────────────────────────────────────────────────────────────────────

export function TeamProjectsProvider({ children }) {
  // ── State ─────────────────────────────────────────────────────────────────

  const [projects,  setProjects]  = useState([])
  const [members,   setMembers]   = useState([])
  const [sprints,   setSprints]   = useState({}) // { [projectId]: Sprint[] }
  const [taskCache, setTaskCache] = useState({}) // { [projectId]: Task[] }

  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingMembers,  setLoadingMembers]  = useState(false)
  const [loadingTasks,    setLoadingTasks]    = useState({}) // { [projectId]: boolean }

  const [error, setError] = useState(null)

  // Prevent duplicate in-flight fetches
  const fetchingRef = useRef({ projects: false, members: false, tasks: {} })

  // ── Project actions ───────────────────────────────────────────────────────

  const fetchProjects = useCallback(async (opts = {}) => {
    if (fetchingRef.current.projects) return
    fetchingRef.current.projects = true
    setLoadingProjects(true)
    setError(null)
    try {
      const rows = await projectsApi.list(opts)
      setProjects(rows)
    } catch (err) {
      console.error('[TeamProjects] fetchProjects:', err)
      setError(err.message || 'Failed to load projects')
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
  }, [])

  // ── Task actions ──────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async (projectId, params = {}) => {
    if (fetchingRef.current.tasks[projectId]) return
    fetchingRef.current.tasks[projectId] = true
    setLoadingTasks((prev) => ({ ...prev, [projectId]: true }))
    try {
      const rows = await tasksApi.list(projectId, params)
      setTaskCache((prev) => ({ ...prev, [projectId]: rows }))
    } catch (err) {
      console.error('[TeamProjects] fetchTasks:', err)
      setError(err.message || 'Failed to load tasks')
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

  const fetchMembers = useCallback(async () => {
    if (fetchingRef.current.members) return
    fetchingRef.current.members = true
    setLoadingMembers(true)
    try {
      const rows = await teamApi.listMembers()
      setMembers(rows)
    } catch (err) {
      console.error('[TeamProjects] fetchMembers:', err)
      // Non-fatal: assignee pickers just show empty
    } finally {
      setLoadingMembers(false)
      fetchingRef.current.members = false
    }
  }, [])

  // ── Sprint actions ────────────────────────────────────────────────────────

  const fetchSprints = useCallback(async (projectId) => {
    try {
      const rows = await sprintsApi.list(projectId)
      setSprints((prev) => ({ ...prev, [projectId]: Array.isArray(rows) ? rows : [] }))
    } catch {
      // Sprints endpoint is Phase 5 — silently ignore 404s for now
    }
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

  const getMemberById = useCallback(
    (id) => members.find((m) => m.id === id) || null,
    [members]
  )

  // ── Context value ─────────────────────────────────────────────────────────

  const value = {
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
    getMemberById,

    // Normalisation helpers (consumers can normalise ad-hoc data)
    normalizeTask,
    normalizeProject,

    // Actions
    actions: {
      // Projects
      fetchProjects,
      createProject,
      updateProject,
      deleteProject,

      // Tasks
      fetchTasks,
      createTask,
      updateTask,
      deleteTask,

      // Team
      fetchMembers,

      // Sprints
      fetchSprints,
    },
  }

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

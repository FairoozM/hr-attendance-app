import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import * as api from '../lib/projects'
import { enrichTasks, buildDailyPlan, buildAssistSuggestions, parseCapture } from '../lib/aiEngine'

const PlannerContext = createContext(null)

export function PlannerProvider({ children }) {
  const [projects, setProjects]               = useState([])
  const [tasksByProject, setTasksByProject]   = useState({})
  const [tasksLoading, setTasksLoading]       = useState({})
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState(null)
  const [captureText, setCaptureText]         = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState(null)

  // ── All tasks flattened across projects (AI-enriched) ──
  const allTasks = useMemo(() => {
    const flat = Object.values(tasksByProject).flat()
    return enrichTasks(flat)
  }, [tasksByProject])

  // ── Today's schedule ──
  const todayPlan = useMemo(() => buildDailyPlan(allTasks), [allTasks])

  // ── AI assist suggestions ──
  const assistSuggestions = useMemo(() => buildAssistSuggestions(allTasks), [allTasks])

  // ── Projects ──
  const loadProjects = useCallback(async (includeArchived = false) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.fetchProjects(includeArchived)
      setProjects(data)
      return data
    } catch (e) {
      setError(e.message || 'Failed to load projects')
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  const createProject = useCallback(async (data) => {
    const project = await api.createProject(data)
    setProjects(prev => [project, ...prev])
    return project
  }, [])

  const updateProject = useCallback(async (id, data) => {
    const project = await api.updateProject(id, data)
    setProjects(prev => prev.map(p => p.id === project.id ? project : p))
    return project
  }, [])

  const deleteProject = useCallback(async (id) => {
    await api.deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
    setTasksByProject(prev => { const n = { ...prev }; delete n[id]; return n })
  }, [])

  const fetchProjectDetail = useCallback(async (id) => {
    const project = await api.fetchProject(id)
    setProjects(prev => {
      const exists = prev.find(p => p.id === project.id)
      return exists ? prev.map(p => p.id === project.id ? project : p) : [project, ...prev]
    })
    return project
  }, [])

  // ── Tasks ──
  const loadTasks = useCallback(async (projectId) => {
    setTasksLoading(prev => ({ ...prev, [projectId]: true }))
    try {
      const tasks = await api.fetchTasks(projectId)
      setTasksByProject(prev => ({ ...prev, [projectId]: tasks }))
      return tasks
    } finally {
      setTasksLoading(prev => ({ ...prev, [projectId]: false }))
    }
  }, [])

  const createTask = useCallback(async (projectId, data) => {
    const task = await api.createTask(projectId, data)
    await loadTasks(projectId)
    return task
  }, [loadTasks])

  const updateTask = useCallback(async (projectId, taskId, data) => {
    const task = await api.updateTask(projectId, taskId, data)
    setTasksByProject(prev => ({
      ...prev,
      [projectId]: (prev[projectId] || []).map(t => t.id === task.id ? task : t),
    }))
    return task
  }, [])

  const deleteTask = useCallback(async (projectId, taskId) => {
    await api.deleteTask(projectId, taskId)
    setTasksByProject(prev => ({
      ...prev,
      [projectId]: (prev[projectId] || []).filter(t => t.id !== taskId),
    }))
  }, [])

  const markTaskDone = useCallback(async (projectId, taskId) => {
    return updateTask(projectId, taskId, { status: 'Done', completed_at: new Date().toISOString() })
  }, [updateTask])

  // ── Sections ──
  const createSection = useCallback(async (projectId, data) => {
    const section = await api.createSection(projectId, data)
    await fetchProjectDetail(projectId)
    return section
  }, [fetchProjectDetail])

  const updateSection = useCallback(async (projectId, sectionId, data) => {
    const section = await api.updateSection(projectId, sectionId, data)
    await fetchProjectDetail(projectId)
    return section
  }, [fetchProjectDetail])

  const deleteSection = useCallback(async (projectId, sectionId) => {
    await api.deleteSection(projectId, sectionId)
    await fetchProjectDetail(projectId)
    await loadTasks(projectId)
  }, [fetchProjectDetail, loadTasks])

  // ── Quick capture ──
  const submitCapture = useCallback(async (text, projectId) => {
    const parsed = parseCapture(text)
    if (!parsed || !projectId) return null
    const taskData = {
      title:       parsed.title,
      description: `Category: ${parsed.category}`,
      due_date:    parsed.suggestedDate || null,
      status:      'Not Started',
      priority:    'Medium',
    }
    const task = await createTask(projectId, taskData)
    setCaptureText('')
    return { task, parsed }
  }, [createTask])

  // ── Attachments ──
  const uploadAttachment = useCallback(async (projectId, taskId, file) => {
    const { uploadUrl, s3Key } = await api.getAttachmentUploadUrl(projectId, taskId, {
      fileName: file.name, contentType: file.type, fileSize: file.size,
    })
    await api.uploadFileToS3(uploadUrl, file)
    const attachment = await api.saveAttachment(projectId, taskId, {
      s3Key, fileName: file.name, fileType: file.type, fileSize: file.size,
    })
    await loadTasks(projectId)
    return attachment
  }, [loadTasks])

  const deleteAttachment = useCallback(async (projectId, taskId, attachId) => {
    await api.deleteAttachment(projectId, taskId, attachId)
    await loadTasks(projectId)
  }, [loadTasks])

  const getAttachmentDownloadUrl = useCallback(async (projectId, taskId, attachId) => {
    return api.getAttachmentDownloadUrl(projectId, taskId, attachId)
  }, [])

  // ── Dependencies ──
  const addDependency = useCallback(async (projectId, taskId, data) => {
    const dep = await api.addDependency(projectId, taskId, data)
    await loadTasks(projectId)
    return dep
  }, [loadTasks])

  const removeDependency = useCallback(async (projectId, taskId, depId) => {
    await api.removeDependency(projectId, taskId, depId)
    await loadTasks(projectId)
  }, [loadTasks])

  return (
    <PlannerContext.Provider value={{
      // data
      projects, loading, error,
      tasksByProject, tasksLoading,
      allTasks, todayPlan, assistSuggestions,
      captureText, setCaptureText,
      selectedProjectId, setSelectedProjectId,
      // actions
      loadProjects, createProject, updateProject, deleteProject, fetchProjectDetail,
      loadTasks, createTask, updateTask, deleteTask, markTaskDone,
      createSection, updateSection, deleteSection,
      submitCapture,
      uploadAttachment, deleteAttachment, getAttachmentDownloadUrl,
      addDependency, removeDependency,
    }}>
      {children}
    </PlannerContext.Provider>
  )
}

export function usePlanner() {
  const ctx = useContext(PlannerContext)
  if (!ctx) throw new Error('usePlanner must be used within PlannerProvider')
  return ctx
}

// Backwards-compat alias so any remaining imports of useProjects still work
export { usePlanner as useProjects }

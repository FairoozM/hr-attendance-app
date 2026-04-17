import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import * as projectsApi from '../lib/projects'

const ProjectsContext = createContext(null)

export function ProjectsProvider({ children }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Per-project task cache: { [projectId]: Task[] }
  const [tasksByProject, setTasksByProject] = useState({})
  const [tasksLoading, setTasksLoading] = useState({})

  const loadProjects = useCallback(async (includeArchived = false) => {
    setLoading(true)
    setError(null)
    try {
      const data = await projectsApi.fetchProjects(includeArchived)
      setProjects(data)
      return data
    } catch (e) {
      setError(e.message || 'Failed to load projects')
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const createProject = useCallback(async (data) => {
    const project = await projectsApi.createProject(data)
    setProjects((prev) => [project, ...prev])
    return project
  }, [])

  const updateProject = useCallback(async (id, data) => {
    const project = await projectsApi.updateProject(id, data)
    setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)))
    return project
  }, [])

  const deleteProject = useCallback(async (id) => {
    await projectsApi.deleteProject(id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
    setTasksByProject((prev) => { const next = { ...prev }; delete next[id]; return next })
  }, [])

  const fetchProjectDetail = useCallback(async (id) => {
    const project = await projectsApi.fetchProject(id)
    setProjects((prev) => {
      const exists = prev.find((p) => p.id === project.id)
      return exists ? prev.map((p) => (p.id === project.id ? project : p)) : [project, ...prev]
    })
    return project
  }, [])

  const loadTasks = useCallback(async (projectId) => {
    setTasksLoading((prev) => ({ ...prev, [projectId]: true }))
    try {
      const tasks = await projectsApi.fetchTasks(projectId)
      setTasksByProject((prev) => ({ ...prev, [projectId]: tasks }))
      return tasks
    } finally {
      setTasksLoading((prev) => ({ ...prev, [projectId]: false }))
    }
  }, [])

  const createTask = useCallback(async (projectId, data) => {
    const task = await projectsApi.createTask(projectId, data)
    await loadTasks(projectId)
    return task
  }, [loadTasks])

  const updateTask = useCallback(async (projectId, taskId, data) => {
    const task = await projectsApi.updateTask(projectId, taskId, data)
    await loadTasks(projectId)
    return task
  }, [loadTasks])

  const deleteTask = useCallback(async (projectId, taskId) => {
    await projectsApi.deleteTask(projectId, taskId)
    await loadTasks(projectId)
  }, [loadTasks])

  const createSection = useCallback(async (projectId, data) => {
    const section = await projectsApi.createSection(projectId, data)
    await fetchProjectDetail(projectId)
    return section
  }, [fetchProjectDetail])

  const updateSection = useCallback(async (projectId, sectionId, data) => {
    const section = await projectsApi.updateSection(projectId, sectionId, data)
    await fetchProjectDetail(projectId)
    return section
  }, [fetchProjectDetail])

  const deleteSection = useCallback(async (projectId, sectionId) => {
    await projectsApi.deleteSection(projectId, sectionId)
    await fetchProjectDetail(projectId)
    await loadTasks(projectId)
  }, [fetchProjectDetail, loadTasks])

  const addDependency = useCallback(async (projectId, taskId, data) => {
    const dep = await projectsApi.addDependency(projectId, taskId, data)
    await loadTasks(projectId)
    return dep
  }, [loadTasks])

  const removeDependency = useCallback(async (projectId, taskId, depId) => {
    await projectsApi.removeDependency(projectId, taskId, depId)
    await loadTasks(projectId)
  }, [loadTasks])

  const uploadAttachment = useCallback(async (projectId, taskId, file) => {
    const { uploadUrl, s3Key } = await projectsApi.getAttachmentUploadUrl(projectId, taskId, {
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
    })
    await projectsApi.uploadFileToS3(uploadUrl, file)
    const attachment = await projectsApi.saveAttachment(projectId, taskId, {
      s3Key,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    })
    await loadTasks(projectId)
    return attachment
  }, [loadTasks])

  const deleteAttachment = useCallback(async (projectId, taskId, attachId) => {
    await projectsApi.deleteAttachment(projectId, taskId, attachId)
    await loadTasks(projectId)
  }, [loadTasks])

  const getAttachmentDownloadUrl = useCallback(async (projectId, taskId, attachId) => {
    return projectsApi.getAttachmentDownloadUrl(projectId, taskId, attachId)
  }, [])

  return (
    <ProjectsContext.Provider value={{
      projects,
      loading,
      error,
      tasksByProject,
      tasksLoading,
      loadProjects,
      createProject,
      updateProject,
      deleteProject,
      fetchProjectDetail,
      loadTasks,
      createTask,
      updateTask,
      deleteTask,
      createSection,
      updateSection,
      deleteSection,
      addDependency,
      removeDependency,
      uploadAttachment,
      deleteAttachment,
      getAttachmentDownloadUrl,
    }}>
      {children}
    </ProjectsContext.Provider>
  )
}

export function useProjects() {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider')
  return ctx
}

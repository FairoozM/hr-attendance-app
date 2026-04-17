import { apiFetch } from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: number
  name: string
  slug: string
  description: string
  status: string
  priority: string
  color: string
  start_date: string | null
  due_date: string | null
  owner_user_id: number | null
  owner_username: string | null
  archived: boolean
  created_at: string
  updated_at: string
  sections?: Section[]
  task_count?: number
  completed_count?: number
  overdue_count?: number
  progress?: number
}

export interface Section {
  id: number
  project_id: number
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Task {
  id: number
  project_id: number
  section_id: number | null
  parent_task_id: number | null
  title: string
  description: string
  status: string
  priority: string
  start_date: string | null
  due_date: string | null
  completed_at: string | null
  estimated_hours: number | null
  actual_hours: number | null
  progress_percent: number
  sort_order: number
  archived: boolean
  created_by: number | null
  created_at: string
  updated_at: string
  dependencies?: Dependency[]
  attachments?: Attachment[]
  subtasks?: Task[]
  is_blocked?: boolean
}

export interface Dependency {
  id: number
  task_id: number
  depends_on_task_id: number
  dependency_type: string
  depends_on_title: string
  depends_on_status: string
  created_at: string
}

export interface Attachment {
  id: number
  task_id: number
  file_name: string
  s3_key: string
  file_type: string | null
  file_size: number | null
  uploaded_by: number | null
  uploaded_at: string
}

export interface DashboardStats {
  total_projects: string
  active_projects: string
  completed_projects: string
  archived_projects: string
  total_tasks: string
  completed_tasks: string
  overdue_tasks: string
  blocked_tasks: number
  projects: Project[]
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function fetchProjects(includeArchived = false): Promise<Project[]> {
  return apiFetch(`/api/projects${includeArchived ? '?archived=true' : ''}`)
}

export async function fetchProject(id: number | string): Promise<Project> {
  return apiFetch(`/api/projects/${id}`)
}

export async function createProject(data: Partial<Project>): Promise<Project> {
  return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateProject(id: number | string, data: Partial<Project>): Promise<Project> {
  return apiFetch(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteProject(id: number | string): Promise<void> {
  return apiFetch(`/api/projects/${id}`, { method: 'DELETE' })
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  return apiFetch('/api/projects/dashboard')
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export async function createSection(projectId: number | string, data: { name: string; sort_order?: number }): Promise<Section> {
  return apiFetch(`/api/projects/${projectId}/sections`, { method: 'POST', body: JSON.stringify(data) })
}

export async function updateSection(projectId: number | string, sectionId: number | string, data: Partial<Section>): Promise<Section> {
  return apiFetch(`/api/projects/${projectId}/sections/${sectionId}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteSection(projectId: number | string, sectionId: number | string): Promise<void> {
  return apiFetch(`/api/projects/${projectId}/sections/${sectionId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function fetchTasks(projectId: number | string): Promise<Task[]> {
  return apiFetch(`/api/projects/${projectId}/tasks`)
}

export async function createTask(projectId: number | string, data: Partial<Task>): Promise<Task> {
  return apiFetch(`/api/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) })
}

export async function updateTask(projectId: number | string, taskId: number | string, data: Partial<Task>): Promise<Task> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteTask(projectId: number | string, taskId: number | string): Promise<void> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export async function addDependency(projectId: number | string, taskId: number | string, data: { depends_on_task_id: number; dependency_type?: string }): Promise<Dependency> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}/dependencies`, { method: 'POST', body: JSON.stringify(data) })
}

export async function removeDependency(projectId: number | string, taskId: number | string, depId: number | string): Promise<void> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}/dependencies/${depId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function getAttachmentUploadUrl(projectId: number | string, taskId: number | string, data: { fileName: string; contentType: string; fileSize?: number }): Promise<{ uploadUrl: string; s3Key: string }> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}/attachments/upload-url`, { method: 'POST', body: JSON.stringify(data) })
}

export async function saveAttachment(projectId: number | string, taskId: number | string, data: { s3Key: string; fileName: string; fileType?: string; fileSize?: number }): Promise<Attachment> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}/attachments`, { method: 'POST', body: JSON.stringify(data) })
}

export async function deleteAttachment(projectId: number | string, taskId: number | string, attachId: number | string): Promise<void> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}/attachments/${attachId}`, { method: 'DELETE' })
}

export async function getAttachmentDownloadUrl(projectId: number | string, taskId: number | string, attachId: number | string): Promise<Attachment & { downloadUrl: string }> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}/attachments/${attachId}/download-url`)
}

export async function uploadFileToS3(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!response.ok) throw new Error(`S3 upload failed: ${response.status}`)
}

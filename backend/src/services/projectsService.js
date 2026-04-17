const { query } = require('../db')

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function uniqueSlug(base) {
  let slug = base
  let attempt = 0
  while (true) {
    const existing = await query('SELECT id FROM projects WHERE slug = $1', [slug])
    if (existing.rowCount === 0) return slug
    attempt++
    slug = `${base}-${attempt}`
  }
}

async function listProjects({ includeArchived = false } = {}) {
  const rows = await query(
    `SELECT
       p.*,
       u.username AS owner_username,
       COUNT(t.id) FILTER (WHERE t.archived = false AND t.parent_task_id IS NULL) AS task_count,
       COUNT(t.id) FILTER (WHERE t.status = 'Completed' AND t.archived = false AND t.parent_task_id IS NULL) AS completed_count,
       COUNT(t.id) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status != 'Completed' AND t.archived = false AND t.parent_task_id IS NULL) AS overdue_count
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_user_id
     LEFT JOIN project_tasks t ON t.project_id = p.id
     WHERE ($1 OR p.archived = false)
     GROUP BY p.id, u.username
     ORDER BY p.created_at DESC`,
    [includeArchived]
  )
  return rows.rows
}

async function getProjectById(id) {
  const projectRow = await query(
    `SELECT p.*, u.username AS owner_username
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_user_id
     WHERE p.id = $1`,
    [id]
  )
  if (projectRow.rowCount === 0) return null
  const project = projectRow.rows[0]

  const sections = await query(
    `SELECT * FROM project_sections WHERE project_id = $1 ORDER BY sort_order ASC, id ASC`,
    [id]
  )
  project.sections = sections.rows

  const stats = await query(
    `SELECT
       COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived = false) AS task_count,
       COUNT(*) FILTER (WHERE status = 'Completed' AND parent_task_id IS NULL AND archived = false) AS completed_count,
       COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status != 'Completed' AND parent_task_id IS NULL AND archived = false) AS overdue_count
     FROM project_tasks WHERE project_id = $1`,
    [id]
  )
  project.task_count = parseInt(stats.rows[0].task_count || 0)
  project.completed_count = parseInt(stats.rows[0].completed_count || 0)
  project.overdue_count = parseInt(stats.rows[0].overdue_count || 0)
  project.progress = project.task_count > 0
    ? Math.round((project.completed_count / project.task_count) * 100)
    : 0

  return project
}

async function createProject({ name, description, status, priority, color, start_date, due_date, owner_user_id }) {
  const base = slugify(name || 'project')
  const slug = await uniqueSlug(base)
  const result = await query(
    `INSERT INTO projects (name, slug, description, status, priority, color, start_date, due_date, owner_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      name,
      slug,
      description || '',
      status || 'Planning',
      priority || 'Medium',
      color || '#8b5cf6',
      start_date || null,
      due_date || null,
      owner_user_id || null,
    ]
  )
  const project = result.rows[0]

  // Create default sections
  const defaultSections = ['To Do', 'In Progress', 'Done']
  for (let i = 0; i < defaultSections.length; i++) {
    await query(
      `INSERT INTO project_sections (project_id, name, sort_order) VALUES ($1, $2, $3)`,
      [project.id, defaultSections[i], i]
    )
  }

  return getProjectById(project.id)
}

async function updateProject(id, fields) {
  const allowed = ['name', 'description', 'status', 'priority', 'color', 'start_date', 'due_date', 'owner_user_id', 'archived']
  const sets = []
  const values = []
  let idx = 1
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx}`)
      values.push(fields[key])
      idx++
    }
  }
  if (sets.length === 0) return getProjectById(id)
  sets.push(`updated_at = NOW()`)
  values.push(id)
  await query(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $${idx}`,
    values
  )
  return getProjectById(id)
}

async function deleteProject(id) {
  await query(`DELETE FROM projects WHERE id = $1`, [id])
}

async function createSection(projectId, { name, sort_order }) {
  const result = await query(
    `INSERT INTO project_sections (project_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *`,
    [projectId, name, sort_order ?? 0]
  )
  return result.rows[0]
}

async function updateSection(sectionId, { name, sort_order }) {
  const sets = []
  const values = []
  let idx = 1
  if (name !== undefined) { sets.push(`name = $${idx}`); values.push(name); idx++ }
  if (sort_order !== undefined) { sets.push(`sort_order = $${idx}`); values.push(sort_order); idx++ }
  if (sets.length === 0) {
    const r = await query('SELECT * FROM project_sections WHERE id = $1', [sectionId])
    return r.rows[0]
  }
  sets.push(`updated_at = NOW()`)
  values.push(sectionId)
  const result = await query(
    `UPDATE project_sections SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  )
  return result.rows[0]
}

async function deleteSection(sectionId) {
  await query(`UPDATE project_tasks SET section_id = NULL WHERE section_id = $1`, [sectionId])
  await query(`DELETE FROM project_sections WHERE id = $1`, [sectionId])
}

async function getDashboardStats() {
  const projectStats = await query(`
    SELECT
      COUNT(*) AS total_projects,
      COUNT(*) FILTER (WHERE status = 'Active' AND archived = false) AS active_projects,
      COUNT(*) FILTER (WHERE status = 'Completed') AS completed_projects,
      COUNT(*) FILTER (WHERE archived = true) AS archived_projects
    FROM projects
  `)
  const taskStats = await query(`
    SELECT
      COUNT(*) FILTER (WHERE parent_task_id IS NULL AND archived = false) AS total_tasks,
      COUNT(*) FILTER (WHERE status = 'Completed' AND parent_task_id IS NULL AND archived = false) AS completed_tasks,
      COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status != 'Completed' AND parent_task_id IS NULL AND archived = false) AS overdue_tasks
    FROM project_tasks
  `)
  const blockedStats = await query(`
    SELECT COUNT(DISTINCT td.task_id) AS blocked_tasks
    FROM task_dependencies td
    JOIN project_tasks blocker ON blocker.id = td.depends_on_task_id
    JOIN project_tasks blocked ON blocked.id = td.task_id
    WHERE blocker.status != 'Completed'
      AND blocked.status != 'Completed'
      AND blocked.archived = false
  `)
  const projects = await query(`
    SELECT
      p.id, p.name, p.status, p.priority, p.color, p.due_date, p.archived,
      COUNT(t.id) FILTER (WHERE t.parent_task_id IS NULL AND t.archived = false) AS task_count,
      COUNT(t.id) FILTER (WHERE t.status = 'Completed' AND t.parent_task_id IS NULL AND t.archived = false) AS completed_count
    FROM projects p
    LEFT JOIN project_tasks t ON t.project_id = p.id
    WHERE p.archived = false
    GROUP BY p.id
    ORDER BY p.due_date ASC NULLS LAST
    LIMIT 10
  `)

  return {
    ...projectStats.rows[0],
    ...taskStats.rows[0],
    blocked_tasks: parseInt(blockedStats.rows[0]?.blocked_tasks || 0),
    projects: projects.rows,
  }
}

module.exports = {
  listProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  createSection,
  updateSection,
  deleteSection,
  getDashboardStats,
}

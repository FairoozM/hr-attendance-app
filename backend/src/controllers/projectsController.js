const projectsService = require('../services/projectsService')

function requireAdmin(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return false
  }
  return true
}

async function listProjects(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const includeArchived = req.query.archived === 'true'
    const projects = await projectsService.listProjects({ includeArchived })
    res.json(projects)
  } catch (err) {
    console.error('[projects] list error:', err)
    res.status(500).json({ error: 'Failed to load projects', detail: String(err.message || '').slice(0, 240) })
  }
}

async function getProject(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const project = await projectsService.getProjectById(req.params.id)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    res.json(project)
  } catch (err) {
    console.error('[projects] get error:', err)
    res.status(500).json({ error: 'Failed to load project', detail: String(err.message || '').slice(0, 240) })
  }
}

async function createProject(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const { name, description, status, priority, color, start_date, due_date } = req.body
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Project name is required' })
    }
    const project = await projectsService.createProject({
      name: String(name).trim(),
      description,
      status,
      priority,
      color,
      start_date,
      due_date,
      owner_user_id: req.user.userId,
    })
    res.status(201).json(project)
  } catch (err) {
    console.error('[projects] create error:', err)
    res.status(500).json({ error: 'Failed to create project', detail: String(err.message || '').slice(0, 240) })
  }
}

async function updateProject(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const project = await projectsService.updateProject(req.params.id, req.body)
    if (!project) return res.status(404).json({ error: 'Project not found' })
    res.json(project)
  } catch (err) {
    console.error('[projects] update error:', err)
    res.status(500).json({ error: 'Failed to update project', detail: String(err.message || '').slice(0, 240) })
  }
}

async function deleteProject(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    await projectsService.deleteProject(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('[projects] delete error:', err)
    res.status(500).json({ error: 'Failed to delete project', detail: String(err.message || '').slice(0, 240) })
  }
}

async function createSection(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const { name, sort_order } = req.body
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Section name is required' })
    }
    const section = await projectsService.createSection(req.params.id, { name: String(name).trim(), sort_order })
    res.status(201).json(section)
  } catch (err) {
    console.error('[projects] createSection error:', err)
    res.status(500).json({ error: 'Failed to create section', detail: String(err.message || '').slice(0, 240) })
  }
}

async function updateSection(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const section = await projectsService.updateSection(req.params.sectionId, req.body)
    res.json(section)
  } catch (err) {
    console.error('[projects] updateSection error:', err)
    res.status(500).json({ error: 'Failed to update section', detail: String(err.message || '').slice(0, 240) })
  }
}

async function deleteSection(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    await projectsService.deleteSection(req.params.sectionId)
    res.json({ success: true })
  } catch (err) {
    console.error('[projects] deleteSection error:', err)
    res.status(500).json({ error: 'Failed to delete section', detail: String(err.message || '').slice(0, 240) })
  }
}

async function getDashboard(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const stats = await projectsService.getDashboardStats()
    res.json(stats)
  } catch (err) {
    console.error('[projects] dashboard error:', err)
    res.status(500).json({ error: 'Failed to load dashboard', detail: String(err.message || '').slice(0, 240) })
  }
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  createSection,
  updateSection,
  deleteSection,
  getDashboard,
}

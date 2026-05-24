/**
 * projectCyclesController.js
 * Handles GET / POST / PATCH for project cycles.
 * Routes live at /api/projects/:projectId/cycles[/:cycleId]
 * Uses the same requireAdmin guard as existing task controllers.
 */

const cyclesService = require('../services/projectCyclesService')

function requireAdmin(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return false
  }
  return true
}

async function listCycles(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const cycles = await cyclesService.listCycles(Number(req.params.projectId))
    res.json(cycles)
  } catch (err) {
    console.error('[cycles] list error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Failed to load cycles' })
  }
}

async function createCycle(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const { name, goal, status, start_date, end_date } = req.body
    const cycle = await cyclesService.createCycle(Number(req.params.projectId), {
      name,
      goal,
      status,
      start_date,
      end_date,
      created_by: req.user.userId,
    })
    res.status(201).json(cycle)
  } catch (err) {
    console.error('[cycles] create error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Failed to create cycle' })
  }
}

async function updateCycle(req, res) {
  try {
    if (!requireAdmin(req, res)) return
    const { name, goal, status, start_date, end_date } = req.body
    const cycle = await cyclesService.updateCycle(
      Number(req.params.projectId),
      Number(req.params.cycleId),
      { name, goal, status, start_date, end_date }
    )
    res.json(cycle)
  } catch (err) {
    console.error('[cycles] update error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Failed to update cycle' })
  }
}

module.exports = { listCycles, createCycle, updateCycle }

/**
 * projectCyclesService.js
 * CRUD for project cycles (backed by the existing `sprints` table).
 * User-facing UI says "Cycle". DB column/table still says sprint.
 * No schema changes required.
 */

const { query } = require('../db')

function rowToCycle(row) {
  if (!row) return null
  const rawStatus = row.status || 'planned'
  // Normalise legacy 'draft' default to 'planned'
  const status = rawStatus === 'draft' ? 'planned' : rawStatus
  return {
    id:           row.id,
    project_id:   row.project_id,
    name:         row.name || '',
    goal:         row.goal || null,
    status,
    start_date:   row.start_date || null,
    end_date:     row.end_date || null,
    completed_at: row.completed_at || null,
    sort_order:   row.sort_order ?? 0,
    created_by:   row.created_by || null,
    created_at:   row.created_at,
    updated_at:   row.updated_at,
  }
}

/**
 * List all cycles for a project, ordered by sort_order then id.
 */
async function listCycles(projectId) {
  const { rows } = await query(
    `SELECT * FROM sprints WHERE project_id = $1 ORDER BY sort_order ASC, id ASC`,
    [projectId]
  )
  return rows.map(rowToCycle)
}

/**
 * Create a new cycle inside a project.
 * status: 'planned' | 'active' | 'completed'
 */
async function createCycle(projectId, { name, goal, status, start_date, end_date, created_by }) {
  if (!name || !String(name).trim()) {
    const err = new Error('Cycle name is required')
    err.status = 400
    throw err
  }
  const { rows } = await query(
    `INSERT INTO sprints (project_id, name, goal, status, start_date, end_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      projectId,
      String(name).trim(),
      goal || null,
      status || 'planned',
      start_date || null,
      end_date || null,
      created_by || null,
    ]
  )
  return rowToCycle(rows[0])
}

/**
 * Update an existing cycle. Only updates provided fields.
 */
async function updateCycle(projectId, cycleId, { name, goal, status, start_date, end_date }) {
  const existing = await query(
    `SELECT id FROM sprints WHERE id = $1 AND project_id = $2`,
    [cycleId, projectId]
  )
  if (existing.rowCount === 0) {
    const err = new Error('Cycle not found')
    err.status = 404
    throw err
  }

  const sets = []
  const vals = []
  let idx = 1

  if (name      !== undefined) { sets.push(`name = $${idx++}`);       vals.push(String(name).trim()) }
  if (goal      !== undefined) { sets.push(`goal = $${idx++}`);       vals.push(goal || null) }
  if (status    !== undefined) { sets.push(`status = $${idx++}`);     vals.push(status) }
  if (start_date !== undefined) { sets.push(`start_date = $${idx++}`); vals.push(start_date || null) }
  if (end_date   !== undefined) { sets.push(`end_date = $${idx++}`);   vals.push(end_date || null) }

  if (sets.length === 0) {
    const curr = await query(`SELECT * FROM sprints WHERE id = $1`, [cycleId])
    return rowToCycle(curr.rows[0])
  }

  sets.push(`updated_at = NOW()`)
  vals.push(cycleId, projectId)

  const { rows } = await query(
    `UPDATE sprints
     SET ${sets.join(', ')}
     WHERE id = $${idx} AND project_id = $${idx + 1}
     RETURNING *`,
    vals
  )
  return rowToCycle(rows[0])
}

module.exports = { listCycles, createCycle, updateCycle }

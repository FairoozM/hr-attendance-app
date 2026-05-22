/**
 * teamController.js
 *
 * GET /api/team/members
 *   Returns all users who have the 'planner' permission (view or manage)
 *   plus admins. Used by the team planner UI for assignee pickers, etc.
 *
 * Response shape per member:
 *   { id, username, display_name, role, avatar_url, employee_id,
 *     planner_role: 'manage' | 'view' | 'admin' }
 */

const { query } = require('../db')

/**
 * Resolve a display name from the user + employee rows.
 * Priority: employee.full_name → username (strip @domain)
 */
function resolveDisplayName(row) {
  if (row.full_name) return String(row.full_name).trim()
  const u = String(row.username || '')
  return u.includes('@') ? u.split('@')[0] : u
}

/**
 * Resolve a planner role label for the response.
 * Admins always get 'admin'. Others: manage > view.
 */
function resolvePlannerRole(row) {
  if (row.role === 'admin') return 'admin'
  const perms = row.permissions || {}
  if (perms.planner === 'manage' || perms.planner?.manage) return 'manage'
  if (perms.planner === 'view'   || perms.planner?.view)   return 'view'
  // Fallback for JSONB shape { planner: { view: true } }
  if (perms.planner && typeof perms.planner === 'object') {
    if (perms.planner.manage) return 'manage'
    if (perms.planner.view)   return 'view'
  }
  return 'view'
}

async function listMembers(req, res) {
  try {
    // requireAuth is applied by the router; any authenticated user can fetch the
    // team list (needed for assignee pickers). We do NOT require admin here.
    const { rows } = await query(`
      SELECT
        u.id,
        u.username,
        u.role,
        u.permissions,
        u.employee_id,
        e.full_name,
        e.photo_url,
        e.department,
        e.designation
      FROM users u
      LEFT JOIN employees e ON e.id = u.employee_id
      WHERE
        u.role = 'admin'
        OR (u.permissions->>'planner' IS NOT NULL)
        OR (u.permissions->'planner' IS NOT NULL)
      ORDER BY e.full_name NULLS LAST, u.username
    `)

    const members = rows.map((row) => ({
      id:           row.id,
      username:     row.username,
      display_name: resolveDisplayName(row),
      role:         row.role,
      planner_role: resolvePlannerRole(row),
      avatar_url:   row.photo_url || null,
      employee_id:  row.employee_id || null,
      department:   row.department || null,
      designation:  row.designation || null,
    }))

    res.json(members)
  } catch (err) {
    console.error('[team] listMembers error:', err)
    res.status(500).json({ error: 'Failed to load team members', detail: String(err.message || '').slice(0, 200) })
  }
}

module.exports = { listMembers }

const { query } = require('../db')

/**
 * Return the list of employee IDs that a manager user is allowed to manage.
 * Returns an empty array if no assignments exist for this user.
 */
async function getAssignedEmployeeIds(managerUserId) {
  const result = await query(
    `SELECT assigned_employee_id FROM attendance_assignments
     WHERE manager_user_id = $1`,
    [managerUserId]
  )
  return result.rows.map((r) => r.assigned_employee_id)
}

/**
 * Return full assignment records for a manager user, joined with employee details.
 */
async function getAssignmentsForUser(managerUserId) {
  const result = await query(
    `SELECT aa.id, aa.assigned_employee_id, aa.assigned_at,
            e.full_name, e.employee_code, e.department, e.designation,
            e.photo_url, e.photo_doc_key, e.is_active
     FROM attendance_assignments aa
     JOIN employees e ON e.id = aa.assigned_employee_id
     WHERE aa.manager_user_id = $1
     ORDER BY e.full_name`,
    [managerUserId]
  )
  return result.rows
}

/**
 * Replace all attendance assignments for a manager user.
 * Deletes existing ones and inserts the new list atomically.
 * @param {number} managerUserId
 * @param {number[]} employeeIds - array of employee IDs to assign
 * @param {number} assignedBy - admin user ID performing the action
 */
async function setAssignments(managerUserId, employeeIds, assignedBy) {
  // Run in a transaction
  await query('BEGIN')
  try {
    await query(
      `DELETE FROM attendance_assignments WHERE manager_user_id = $1`,
      [managerUserId]
    )

    if (employeeIds && employeeIds.length > 0) {
      const values = employeeIds
        .map((_, i) => `($1, $${i + 2}, $${employeeIds.length + 2})`)
        .join(', ')
      const params = [managerUserId, ...employeeIds, assignedBy]
      await query(
        `INSERT INTO attendance_assignments (manager_user_id, assigned_employee_id, assigned_by)
         VALUES ${values}
         ON CONFLICT (manager_user_id, assigned_employee_id) DO NOTHING`,
        params
      )
    }

    await query('COMMIT')
  } catch (err) {
    await query('ROLLBACK')
    throw err
  }
}

/**
 * Get all managers who have attendance assignments, grouped with their assigned counts.
 * Used in admin overview.
 */
async function getAllAssignmentsSummary() {
  const result = await query(
    `SELECT aa.manager_user_id,
            u.username,
            e_mgr.full_name AS manager_name,
            COUNT(aa.assigned_employee_id)::int AS assigned_count
     FROM attendance_assignments aa
     JOIN users u ON u.id = aa.manager_user_id
     LEFT JOIN employees e_mgr ON e_mgr.id = u.employee_id
     GROUP BY aa.manager_user_id, u.username, e_mgr.full_name
     ORDER BY manager_name`
  )
  return result.rows
}

module.exports = {
  getAssignedEmployeeIds,
  getAssignmentsForUser,
  setAssignments,
  getAllAssignmentsSummary,
}

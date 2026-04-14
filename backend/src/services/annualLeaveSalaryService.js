const { query } = require('../db')

const JOIN_EMPLOYEES = `
  JOIN employees e ON e.id = als.employee_id
`

async function findAll({ employeeId } = {}) {
  const where = employeeId ? 'WHERE als.employee_id = $1' : ''
  const params = employeeId ? [employeeId] : []
  const result = await query(
    `SELECT als.*,
            e.full_name, e.employee_code, e.department, e.designation, e.monthly_salary AS emp_monthly_salary
     FROM annual_leave_salary als
     ${JOIN_EMPLOYEES}
     ${where}
     ORDER BY als.calculation_date DESC, als.id DESC`,
    params
  )
  return result.rows
}

async function findById(id) {
  const result = await query(
    `SELECT als.*,
            e.full_name, e.employee_code, e.department, e.designation,
            e.joining_date, e.monthly_salary AS emp_monthly_salary
     FROM annual_leave_salary als
     ${JOIN_EMPLOYEES}
     WHERE als.id = $1`,
    [id]
  )
  return result.rows[0] || null
}

/** Latest saved calculation per employee (for shop-visit settlement link). */
async function findLatestByEmployeeId(employeeId) {
  const result = await query(
    `SELECT als.*,
            e.full_name, e.employee_code, e.department, e.designation
     FROM annual_leave_salary als
     ${JOIN_EMPLOYEES}
     WHERE als.employee_id = $1
     ORDER BY als.calculation_date DESC, als.id DESC
     LIMIT 1`,
    [employeeId]
  )
  return result.rows[0] || null
}

async function create(data) {
  const {
    employee_id, calculation_date, monthly_salary, per_day_rate,
    running_month_days, running_month_amount,
    annual_leave_days_eligible, leave_days_to_pay, leave_salary_amount,
    other_additions, other_deductions, grand_total, remarks, created_by,
  } = data
  const result = await query(
    `INSERT INTO annual_leave_salary (
      employee_id, calculation_date, monthly_salary, per_day_rate,
      running_month_days, running_month_amount,
      annual_leave_days_eligible, leave_days_to_pay, leave_salary_amount,
      other_additions, other_deductions, grand_total, remarks, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *`,
    [
      employee_id, calculation_date || new Date().toISOString().slice(0, 10),
      monthly_salary, per_day_rate,
      running_month_days, running_month_amount,
      annual_leave_days_eligible, leave_days_to_pay, leave_salary_amount,
      other_additions || 0, other_deductions || 0, grand_total, remarks || null, created_by || null,
    ]
  )
  return result.rows[0]
}

async function update(id, data) {
  const {
    calculation_date, monthly_salary, per_day_rate,
    running_month_days, running_month_amount,
    annual_leave_days_eligible, leave_days_to_pay, leave_salary_amount,
    other_additions, other_deductions, grand_total, remarks,
  } = data
  const result = await query(
    `UPDATE annual_leave_salary SET
      calculation_date = $2, monthly_salary = $3, per_day_rate = $4,
      running_month_days = $5, running_month_amount = $6,
      annual_leave_days_eligible = $7, leave_days_to_pay = $8,
      leave_salary_amount = $9, other_additions = $10, other_deductions = $11,
      grand_total = $12, remarks = $13, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [
      id, calculation_date, monthly_salary, per_day_rate,
      running_month_days, running_month_amount,
      annual_leave_days_eligible, leave_days_to_pay, leave_salary_amount,
      other_additions || 0, other_deductions || 0, grand_total, remarks || null,
    ]
  )
  return result.rows[0] || null
}

async function remove(id) {
  await query('DELETE FROM annual_leave_salary WHERE id = $1', [id])
}

module.exports = { findAll, findById, findLatestByEmployeeId, create, update, remove }

const { Pool } = require('pg')

const connectionString =
  process.env.DATABASE_URL || 'postgres://localhost:5432/hr_attendance'

const pool = new Pool({ connectionString })

/**
 * Run a SQL query with optional parameters.
 * @param {string} text - SQL query
 * @param {Array} [params] - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
function query(text, params) {
  return pool.query(text, params)
}

/**
 * Create employees table if it does not exist.
 */
async function ensureEmployeesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      employee_code VARCHAR(50) UNIQUE NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      department VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

/**
 * Create attendance table if it does not exist.
 */
async function ensureAttendanceTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      attendance_date DATE NOT NULL,
      status VARCHAR(10) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, attendance_date)
    )
  `)
}

/**
 * Test DB connection with SELECT NOW(). Logs success or error.
 */
async function testConnection() {
  try {
    const result = await query('SELECT NOW()')
    const now = result.rows[0]?.now
    console.log('Database connected successfully. Server time:', now)
    await ensureEmployeesTable()
    await ensureAttendanceTable()
  } catch (err) {
    console.error('Database connection failed:', err.message)
  }
}

module.exports = {
  query,
  pool,
  testConnection,
  ensureEmployeesTable,
  ensureAttendanceTable,
}

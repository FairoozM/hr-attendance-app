const { Pool } = require('pg')

const connectionString =
  process.env.DATABASE_URL || 'postgres://localhost:5432/hr_attendance'

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
})

function query(text, params) {
  return pool.query(text, params)
}

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

async function ensureEmployeeExtendedColumns() {
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS joining_date DATE`)
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url TEXT`)
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`)
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS emirates_id VARCHAR(100)`)
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS passport_number VARCHAR(100)`)
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality VARCHAR(100)`)
}

async function ensureAttendanceTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      attendance_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, attendance_date)
    )
  `)
  await query(`
    ALTER TABLE attendance
    ADD COLUMN IF NOT EXISTS sick_leave_document_url TEXT
  `)
}

async function ensureAnnualLeaveTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS annual_leave (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      from_date DATE NOT NULL,
      to_date DATE NOT NULL,
      reason TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Approved', 'Rejected')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_annual_leave_employee_id ON annual_leave(employee_id)
  `)
}

async function ensureAttendanceAnnualLeaveColumn() {
  await query(`
    ALTER TABLE attendance
    ADD COLUMN IF NOT EXISTS annual_leave_id INTEGER REFERENCES annual_leave(id) ON DELETE SET NULL
  `)
}

/** One-time data migration: Holiday (H) → Annual Leave (AL); approved leave rows were Absent (A). */
async function migrateAttendanceStatusHToAl() {
  await query(`UPDATE attendance SET status = 'AL' WHERE status = 'H'`)
  await query(
    `UPDATE attendance SET status = 'AL' WHERE annual_leave_id IS NOT NULL AND status = 'A'`
  )
}

async function testConnection() {
  try {
    const result = await query('SELECT NOW()')
    const now = result.rows[0]?.now
    console.log('Database connected successfully. Server time:', now)
    await ensureEmployeesTable()
    await ensureEmployeeExtendedColumns()
    await ensureAttendanceTable()
    await ensureAnnualLeaveTable()
    await ensureAttendanceAnnualLeaveColumn()
    await migrateAttendanceStatusHToAl()
  } catch (err) {
    console.error('Database connection failed:', err.message)
  }
}

module.exports = {
  query,
  pool,
  testConnection,
  ensureEmployeesTable,
  ensureEmployeeExtendedColumns,
  ensureAttendanceTable,
  ensureAnnualLeaveTable,
  ensureAttendanceAnnualLeaveColumn,
}
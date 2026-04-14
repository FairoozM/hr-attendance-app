const { Pool } = require('pg')
const bcrypt = require('bcrypt')

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
  await query(
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS include_in_attendance BOOLEAN NOT NULL DEFAULT true`
  )
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_off_day VARCHAR(20)`)
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS duty_location VARCHAR(50)`)
}

async function ensureEmployeesAlternateEmployeeColumn() {
  await query(`
    ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS alternate_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_employees_alternate_employee_id ON employees(alternate_employee_id)
  `)
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

async function ensureUsersTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(32) NOT NULL CHECK (role IN ('admin', 'employee', 'warehouse')),
      employee_id INTEGER UNIQUE REFERENCES employees(id) ON DELETE SET NULL,
      permissions JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id)`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'`)
}

/**
 * Ensures exactly one default admin exists when none is present (role = 'admin').
 * Password is hashed with bcrypt; does not insert if an admin row already exists.
 */
async function ensureDefaultAdminUser() {
  const rounds = 10
  const existing = await query(`SELECT id, username FROM users WHERE role = 'admin' LIMIT 1`)
  if (existing.rows.length > 0) {
    console.log(
      '[auth] Admin user already exists (username: %s); skipping default admin seed',
      existing.rows[0].username
    )
    return
  }

  const username = String(process.env.ADMIN_USERNAME || 'admin@company.com').trim().toLowerCase()
  const password =
    process.env.ADMIN_PASSWORD != null && String(process.env.ADMIN_PASSWORD) !== ''
      ? String(process.env.ADMIN_PASSWORD)
      : 'admin123'
  const hash = await bcrypt.hash(password, rounds)
  await query(
    `INSERT INTO users (username, password_hash, role, employee_id) VALUES ($1, $2, 'admin', NULL)`,
    [username, hash]
  )
  console.log('[auth] Default admin user created (username: %s)', username)
}

async function ensureWarehouseUser() {
  const rounds = 10
  const whUser = String(process.env.WAREHOUSE_USERNAME || 'warehouse@company.com').trim().toLowerCase()
  const whCheck = await query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [whUser])
  if (whCheck.rows.length > 0) return

  const wp = process.env.WAREHOUSE_PASSWORD || 'warehouse123'
  const hash = await bcrypt.hash(wp, rounds)
  await query(
    `INSERT INTO users (username, password_hash, role, employee_id) VALUES ($1, $2, 'warehouse', NULL)`,
    [whUser, hash]
  )
  console.log('[auth] Seeded warehouse user: %s', whUser)
}

/**
 * One-time migration: update non-email usernames to email format.
 * - admin -> admin@company.com
 * - warehouse -> warehouse@company.com
 * - employee portal accounts without @ -> {employee_code}@portal.internal
 */
async function migrateUsernamesToEmail() {
  const rounds = 10

  // Migrate admin system account: only if current username has no @
  // Use ADMIN_USERNAME env only when it looks like a valid email
  const adminEmail = (() => {
    const e = process.env.ADMIN_USERNAME || ''
    return e.includes('@') ? e.toLowerCase() : 'admin@company.com'
  })()
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  const adminHash = await bcrypt.hash(adminPassword, rounds)
  const adminMigrated = await query(`
    UPDATE users
    SET username = $1, password_hash = $2
    WHERE role = 'admin' AND username NOT LIKE '%@%'
    RETURNING id, username
  `, [adminEmail, adminHash])
  if (adminMigrated.rowCount > 0) {
    console.log('[auth] Migrated admin account to email: %s (password reset to default)', adminEmail)
  }

  // Migrate warehouse system account
  const warehouseEmail = (() => {
    const e = process.env.WAREHOUSE_USERNAME || ''
    return e.includes('@') ? e.toLowerCase() : 'warehouse@company.com'
  })()
  const warehousePassword = process.env.WAREHOUSE_PASSWORD || 'warehouse123'
  const warehouseHash = await bcrypt.hash(warehousePassword, rounds)
  await query(`
    UPDATE users
    SET username = $1, password_hash = $2
    WHERE role = 'warehouse' AND username NOT LIKE '%@%'
  `, [warehouseEmail, warehouseHash])

  // Migrate employee portal accounts: use {employee_code}@portal.internal as placeholder
  const migrated = await query(`
    UPDATE users u
    SET username = CONCAT(COALESCE(e.employee_code, CAST(u.id AS TEXT)), '@portal.internal')
    FROM employees e
    WHERE u.employee_id = e.id
      AND u.role = 'employee'
      AND u.username NOT LIKE '%@%'
    RETURNING u.id, u.username
  `)
  if (migrated.rowCount > 0) {
    console.log('[auth] Migrated %d employee portal accounts to email format', migrated.rowCount)
    migrated.rows.forEach((r) =>
      console.log('[auth]   user id %s → %s', r.id, r.username)
    )
  }
}

async function ensureProfileColumns() {
  const cols = [
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender VARCHAR(20)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS marital_status VARCHAR(30)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_email VARCHAR(255)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS current_address TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS city VARCHAR(100)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS country VARCHAR(100)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS designation VARCHAR(255)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_location VARCHAR(255)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_name VARCHAR(255)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_status VARCHAR(50)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(100)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_alt_phone VARCHAR(50)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS account_holder_name VARCHAR(255)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS iban VARCHAR(100)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS passport_issue_date DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS passport_expiry_date DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS passport_doc_key TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_number VARCHAR(100)`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_issue_date DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_expiry_date DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS visa_doc_key TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emirates_id_issue_date DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emirates_id_expiry_date DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emirates_id_doc_key TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_doc_key TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS signature_doc_key TEXT`,
  ]
  for (const sql of cols) {
    await query(sql)
  }
}

async function ensureAnnualLeavePdfDocumentColumns() {
  await query(`ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS leave_request_pdf_key TEXT`)
  await query(
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS leave_request_pdf_generated_at TIMESTAMPTZ`
  )
}

async function ensureAnnualLeaveExtendedColumns() {
  const cols = [
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS actual_return_date DATE`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS return_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS return_confirmed_at TIMESTAMPTZ`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS admin_remarks TEXT`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS grace_period_days SMALLINT NOT NULL DEFAULT 1`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS alternate_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL`,
  ]
  for (const sql of cols) await query(sql)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_annual_leave_alternate_employee_id ON annual_leave(alternate_employee_id)`
  )
}

/** Main shop visit workflow + HR reminder notifications */
async function ensureAnnualLeaveShopVisitColumns() {
  const cols = [
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_status VARCHAR(40)`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_date DATE`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_time VARCHAR(32)`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_note TEXT`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_submitted_at TIMESTAMPTZ`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_confirmed_at TIMESTAMPTZ`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_admin_note TEXT`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS calculated_leave_amount NUMERIC(14,2)`,
    `ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS calculator_snapshot JSONB`,
  ]
  for (const sql of cols) await query(sql)
}

async function ensureNotificationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      type VARCHAR(64) NOT NULL,
      title TEXT,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT false,
      read_at TIMESTAMPTZ,
      scheduled_for DATE NOT NULL,
      trigger_key VARCHAR(255) NOT NULL UNIQUE,
      employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
      annual_leave_id INTEGER REFERENCES annual_leave(id) ON DELETE CASCADE,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notifications(scheduled_for)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_leave ON notifications(annual_leave_id)`)
}

/** Backfill shop visit state for already-approved leaves */
async function backfillShopVisitPendingSubmission() {
  await query(`
    UPDATE annual_leave
    SET shop_visit_status = 'PendingSubmission'
    WHERE status = 'Approved'
      AND (shop_visit_status IS NULL OR shop_visit_status = '')
  `)
}

/** For `node backend/scripts/apply-shop-visit-schema.js` if startup migrations did not run. */
async function ensureShopVisitSchemaOnly() {
  await ensureAnnualLeaveShopVisitColumns()
  await ensureNotificationsTable()
  await backfillShopVisitPendingSubmission()
}

async function ensureInfluencersSnapshotTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS influencers_snapshot (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      body JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function ensureAttendanceAssignmentsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS attendance_assignments (
      id SERIAL PRIMARY KEY,
      manager_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(manager_user_id, assigned_employee_id)
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_aa_manager ON attendance_assignments(manager_user_id)
  `)
}

async function ensureAnnualLeaveSalaryTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS annual_leave_salary (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      calculation_date DATE NOT NULL DEFAULT CURRENT_DATE,
      monthly_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
      per_day_rate NUMERIC(14,4) NOT NULL DEFAULT 0,
      running_month_days NUMERIC(6,2) NOT NULL DEFAULT 0,
      running_month_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      annual_leave_days_eligible NUMERIC(6,2) NOT NULL DEFAULT 0,
      leave_days_to_pay NUMERIC(6,2) NOT NULL DEFAULT 0,
      leave_salary_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      other_additions NUMERIC(14,2) NOT NULL DEFAULT 0,
      other_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
      grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      remarks TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_als_employee_id ON annual_leave_salary(employee_id)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_als_date ON annual_leave_salary(calculation_date)
  `)
  // Add monthly_salary to employees if not present (for pre-filling the calculator)
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(14,2)`)
}

/**
 * Legacy cleanup: old flows could persist expiring S3 signed photo URLs in employees.photo_url.
 * If photo_doc_key exists, those URLs become invalid after expiry and break avatars.
 */
async function normalizeEmployeePhotoUrls() {
  await query(`
    UPDATE employees
    SET photo_url = NULL
    WHERE photo_doc_key IS NOT NULL
      AND photo_url IS NOT NULL
      AND (
        photo_url LIKE '%X-Amz-Signature=%'
        OR photo_url LIKE '%X-Amz-Algorithm=%'
      )
  `)
}

async function testConnection() {
  const result = await query('SELECT NOW()')
  const now = result.rows[0]?.now
  console.log('Database connected successfully. Server time:', now)
  await ensureEmployeesTable()
  await ensureEmployeeExtendedColumns()
  await ensureEmployeesAlternateEmployeeColumn()
  await ensureAttendanceTable()
  await ensureAnnualLeaveTable()
  // PDF metadata columns only (no FKs); run early so a failure later in this chain
  // cannot leave annual_leave SELECTs broken on first request.
  await ensureAnnualLeavePdfDocumentColumns()
  await ensureAttendanceAnnualLeaveColumn()
  await migrateAttendanceStatusHToAl()
  await ensureUsersTable()
  await ensureDefaultAdminUser()
  await ensureWarehouseUser()
  // Must run before username migration: migrateUsernamesToEmail() can throw on edge
  // duplicate data; if it aborts testConnection(), annual_leave columns would never apply.
  await ensureAnnualLeaveExtendedColumns()
  // Shop visit + notifications must run before later steps: if a later migration fails,
  // annual_leave list queries still need these columns once new API code is deployed.
  await ensureShopVisitSchemaOnly()
  await ensureProfileColumns()
  try {
    await migrateUsernamesToEmail()
  } catch (e) {
    console.error('[db] migrateUsernamesToEmail skipped/failed (non-fatal):', e.message || e)
  }
  await ensureAnnualLeaveSalaryTable()
  await normalizeEmployeePhotoUrls()
  await ensureAttendanceAssignmentsTable()
  await ensureInfluencersSnapshotTable()
}

module.exports = {
  query,
  pool,
  testConnection,
  ensureShopVisitSchemaOnly,
  ensureEmployeesTable,
  ensureEmployeeExtendedColumns,
  ensureAttendanceTable,
  ensureAnnualLeaveTable,
  ensureAttendanceAnnualLeaveColumn,
  ensureUsersTable,
  ensureDefaultAdminUser,
  ensureInfluencersSnapshotTable,
}
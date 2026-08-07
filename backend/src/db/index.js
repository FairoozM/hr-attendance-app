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

const SYNC_ADMIN_TRUTHY = /^(1|true|yes)$/i

/**
 * When SYNC_ADMIN_PASSWORD is truthy and ADMIN_PASSWORD is set, re-hash and update
 * the existing admin row (ADMIN_USERNAME or admin@company.com). Skipped in production
 * so production deploys cannot overwrite admin credentials from env by mistake.
 */
async function resyncAdminPasswordFromEnvIfRequested() {
  if (process.env.NODE_ENV === 'production') {
    if (SYNC_ADMIN_TRUTHY.test(String(process.env.SYNC_ADMIN_PASSWORD || '')) && process.env.ADMIN_PASSWORD) {
      console.warn(
        '[auth] SYNC_ADMIN_PASSWORD is set but ignored when NODE_ENV=production (set a new password via DB or the admin UI)'
      )
    }
    return
  }
  if (!SYNC_ADMIN_TRUTHY.test(String(process.env.SYNC_ADMIN_PASSWORD || ''))) return

  const pw = process.env.ADMIN_PASSWORD != null ? String(process.env.ADMIN_PASSWORD) : ''
  if (!pw) {
    console.warn('[auth] SYNC_ADMIN_PASSWORD=1 but ADMIN_PASSWORD is empty; skipping resync')
    return
  }
  if (pw.length < 8) {
    console.warn('[auth] SYNC_ADMIN_PASSWORD: ADMIN_PASSWORD must be at least 8 characters; skipping')
    return
  }
  const uname = String(process.env.ADMIN_USERNAME || 'admin@company.com').trim().toLowerCase()
  const hash = await bcrypt.hash(pw, 10)
  const r = await query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE role = 'admin' AND LOWER(username) = LOWER($2)`,
    [hash, uname]
  )
  if (r.rowCount > 0) {
    console.log('[auth] Admin password updated from env (SYNC_ADMIN_PASSWORD) for', uname)
  } else {
    console.warn(
      '[auth] SYNC_ADMIN_PASSWORD: no admin user matched username %s; create one first or fix ADMIN_USERNAME',
      uname
    )
  }
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
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read, scheduled_for)`)
}

async function ensureNotificationActionsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS notification_actions (
      id SERIAL PRIMARY KEY,
      notification_key VARCHAR(512) NOT NULL UNIQUE,
      source_type VARCHAR(64) NOT NULL DEFAULT '',
      source_id VARCHAR(64) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      snoozed_until DATE,
      resolved_at TIMESTAMPTZ,
      resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ignored_at TIMESTAMPTZ,
      ignored_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ignore_reason TEXT NOT NULL DEFAULT '',
      due_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  // Read state is independent of status so a reminder can be read while still active/visible.
  await query(`ALTER TABLE notification_actions ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`)
  await query(
    `ALTER TABLE notification_actions
     ADD COLUMN IF NOT EXISTS read_by INTEGER REFERENCES users(id) ON DELETE SET NULL`
  )
  await query(`CREATE INDEX IF NOT EXISTS idx_notification_actions_status ON notification_actions(status)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_notification_actions_snoozed_until ON notification_actions(snoozed_until)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_notification_actions_source ON notification_actions(source_type, source_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_notification_actions_read_at ON notification_actions(read_at)`)
}

/**
 * Shared "when did the fleet last sync" state. Without it the sync throttle is per-process, so
 * every additional worker/container performs its own delete-and-reinsert pass.
 */
async function ensureNotificationSyncStateTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS notification_sync_state (
      sync_name VARCHAR(64) PRIMARY KEY,
      last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_run_by VARCHAR(128) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
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
  await ensureNotificationActionsTable()
  await ensureNotificationSyncStateTable()
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

/** Daily influencer performance checks (synced from app; influencer ids match influencers_snapshot). */
async function ensureInfluencerPerformanceRecordsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS influencer_performance_contracts (
      id TEXT PRIMARY KEY,
      influencer_id TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      campaign_name TEXT NOT NULL DEFAULT '',
      video_title TEXT NOT NULL DEFAULT '',
      post_url TEXT NOT NULL DEFAULT '',
      contract_start_date DATE,
      monitoring_days INTEGER NOT NULL DEFAULT 5,
      body JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_ipc_influencer ON influencer_performance_contracts(influencer_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_ipc_start_date ON influencer_performance_contracts(contract_start_date)`)
  await query(`
    CREATE TABLE IF NOT EXISTS influencer_performance_records (
      id TEXT PRIMARY KEY,
      contract_id TEXT,
      influencer_id TEXT NOT NULL,
      check_date DATE NOT NULL,
      body JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `)
  await query(`ALTER TABLE influencer_performance_records ADD COLUMN IF NOT EXISTS contract_id TEXT`)
  await query(`CREATE INDEX IF NOT EXISTS idx_ipr_influencer ON influencer_performance_records(influencer_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_ipr_contract ON influencer_performance_records(contract_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_ipr_check_date ON influencer_performance_records(check_date)`)
  await query(`
    CREATE TABLE IF NOT EXISTS influencer_performance_record_tombstones (
      id TEXT PRIMARY KEY,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `)
}

/** Per performance-contract payment rows (finance tracking; separate from influencers_snapshot). */
async function ensureInfluencerContractPaymentsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS influencer_contract_payments (
      contract_id TEXT PRIMARY KEY REFERENCES influencer_performance_contracts(id) ON DELETE CASCADE,
      influencer_id TEXT NOT NULL,
      amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
      payment_status VARCHAR(50) NOT NULL DEFAULT 'Not Due',
      due_date DATE,
      payment_date DATE,
      invoice_reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      zoho_vendor_bill_id TEXT,
      zoho_payment_id TEXT,
      zoho_last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_icp_influencer ON influencer_contract_payments(influencer_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_icp_status ON influencer_contract_payments(payment_status)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_icp_due_date ON influencer_contract_payments(due_date)`)
}

async function ensureDocumentExpiryTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS document_expiry (
      id SERIAL PRIMARY KEY,
      name VARCHAR(500) NOT NULL,
      document_type VARCHAR(255) NOT NULL DEFAULT '',
      company VARCHAR(255) NOT NULL DEFAULT '',
      expiry_date DATE,
      reminder_days INTEGER NOT NULL DEFAULT 30,
      renewal_frequency VARCHAR(100) NOT NULL DEFAULT '',
      period_covered VARCHAR(255) NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      workflow_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_doc_expiry_expiry_date ON document_expiry(expiry_date)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_doc_expiry_company ON document_expiry(company)`)
  // Add unique constraint only if it doesn't exist yet (IF NOT EXISTS not supported on all PG versions)
  const constraintExists = await query(`
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_doc_expiry_name' AND conrelid = 'document_expiry'::regclass
  `)
  if (constraintExists.rowCount === 0) {
    await query(`ALTER TABLE document_expiry ADD CONSTRAINT uq_doc_expiry_name UNIQUE (name)`)
  }

  // Seed records — inserted once, never duplicated
  const seedRows = [
    // name, document_type, company, expiry_date, reminder_days, renewal_frequency, period_covered, notes, workflow_status
    ['Basmat Al Hayat Goods Wholesalers - 2026 (2nd Qtr)',       'Trade License', 'Basmat Al Hayat Goods Wholesalers',      '2026-11-15', 30, 'Quarterly', 'Q2 2026', '', 'Pending'],
    ['Envato Elements',                                           'Subscription',  'Basmat Al Hayat General Trading LLC',    '2026-11-30', 14, 'Annual',    'Nov 2025 – Nov 2026', '', 'Pending'],
    ['VAT KSA July ~ September, 2025',                           'VAT Filing',    'KSA Operations',                        '2026-10-05', 14, 'Quarterly', 'Q3 2025 (Jul–Sep)', '', 'Submitted'],
    ['VAT KSA April ~ June, 2025',                               'VAT Filing',    'KSA Operations',                        '2026-07-05', 14, 'Quarterly', 'Q2 2025 (Apr–Jun)', '', 'Submitted'],
    ['VAT KSA January ~ March, 2026',                            'VAT Filing',    'KSA Operations',                        '2026-04-05', 14, 'Quarterly', 'Q1 2026 (Jan–Mar)', '', 'Submitted'],
    ['VAT KSA October ~ December, 2025',                         'VAT Filing',    'KSA Operations',                        '2026-01-05', 14, 'Quarterly', 'Q4 2025 (Oct–Dec)', '', 'Submitted'],
    ['Basmat Al Hayat General Trading LLC - 2026 (2nd Qtr)',     'Trade License', 'Basmat Al Hayat General Trading LLC',    '2026-06-15', 30, 'Quarterly', 'Q2 2026', '', 'Pending'],
    ['Basmat Al Hayat General Trading LLC - 2026 (1st Qtr)',     'Trade License', 'Basmat Al Hayat General Trading LLC',    '2026-03-15', 30, 'Quarterly', 'Q1 2026', '', 'Pending'],
    ['Basmat Al Hayat General Trading LLC - 2025 (4th Qtr)',     'Trade License', 'Basmat Al Hayat General Trading LLC',    '2025-12-26', 30, 'Quarterly', 'Q4 2025', '', 'Pending'],
    ['Basmat Al Hayat Goods Wholesalers - 2026 (2nd Qtr) Aug',  'Trade License', 'Basmat Al Hayat Goods Wholesalers',      '2026-08-15', 30, 'Quarterly', 'Q2 2026 (Aug)', '', 'Pending'],
    ['Basmat Al Hayat Goods Wholesalers - 2026 (1st Qtr)',       'Trade License', 'Basmat Al Hayat Goods Wholesalers',      '2026-05-15', 30, 'Quarterly', 'Q1 2026', '', 'Pending'],
    ['Basmat Al Hayat Goods Wholesalers - 2025 (4th Qtr)',       'Trade License', 'Basmat Al Hayat Goods Wholesalers',      '2026-02-15', 30, 'Quarterly', 'Q4 2025', '', 'Pending'],
    ['Urvah NICOP',                                              'ID / NICOP',    'Personal',                               '2034-05-04', 60, 'Every 5 Years', '2029–2034', '', 'Completed'],
    ['Abdullah NICOP',                                           'ID / NICOP',    'Personal',                               '2035-08-26', 60, 'Every 5 Years', '2030–2035', '', 'Completed'],
    ['Afra Vaccination',                                         'Medical / Certificate', 'Personal',                       '2026-10-08', 30, 'As Required', '2026', '', 'Completed'],
    ['ISO Certificate',                                          'Other',         'Basmat Al Hayat General Trading LLC',    '2026-04-10', 30, 'Annual',    '2025–2026', '', 'Pending'],
    ['Hamdan Visa',                                              'Visa / Emirates ID', 'Personal',                          '2026-06-27', 30, 'Annual',    '2025–2026', '', 'Pending'],
    ['Hamdan Passport',                                          'Other',         'Personal',                               '2031-09-13', 60, 'Every 5 Years', '2026–2031', '', 'Completed'],
    ['Ajmal Sharaf Passport',                                    'Other',              'Personal', '2027-06-06', 60, 'Every 5 Years', '2022–2027', '', 'Completed'],
    // Batch 2
    ['Ajmal Sharaf Visa',          'Visa / Emirates ID',  'Personal', '2027-05-09', 30, 'Annual',        '2026–2027', '', 'Pending'],
    ['Ajmal Sharaf Medical Insurance', 'Insurance',       'Personal', '2026-10-24', 30, 'Annual',        '2025–2026', '', 'Pending'],
    ['Aamir Medical Insurance',    'Insurance',           'Personal', '2026-10-24', 30, 'Annual',        '2025–2026', '', 'Pending'],
    ['Aamir Passport',             'Other',               'Personal', '2028-04-15', 60, 'Every 5 Years', '2023–2028', '', 'Completed'],
    ['Afra Medical Insurance',     'Insurance',           'Personal', '2026-10-24', 30, 'Annual',        '2025–2026', '', 'Pending'],
    ['Urvah Medical Insurance',    'Insurance',           'Personal', '2026-10-24', 30, 'Annual',        '2025–2026', '', 'Pending'],
    ['Abdullah Medical Insurance', 'Insurance',           'Personal', '2026-10-24', 30, 'Annual',        '2025–2026', '', 'Pending'],
    ['Faizan Medical Insurance',   'Insurance',           'Personal', '2026-10-24', 30, 'Annual',        '2025–2026', '', 'Pending'],
    ['Faizan Visa',                'Visa / Emirates ID',  'Personal', '2027-01-01', 30, 'Annual',        '2026–2027', '', 'Pending'],
    ['Faizan Passport',            'Other',               'Personal', '2027-02-14', 60, 'Every 5 Years', '2022–2027', '', 'Completed'],
    ['Margret Visa',               'Visa / Emirates ID',  'Personal', '2027-05-22', 30, 'Annual',        '2026–2027', '', 'Pending'],
    ['Margret Passport',           'Other',               'Personal', '2030-10-10', 60, 'Every 5 Years', '2025–2030', '', 'Completed'],
    ['Ali Visa',                   'Visa / Emirates ID',  'Personal', '2027-06-08', 30, 'Annual',        '2026–2027', '', 'Pending'],
    ['Ali Passport',               'Other',               'Personal', '2031-04-20', 60, 'Every 5 Years', '2026–2031', '', 'Completed'],
    ['Afra Visa',                  'Visa / Emirates ID',  'Personal', '2026-08-12', 30, 'Annual',        '2025–2026', '', 'Pending'],
    ['Afra Passport',              'Other',               'Personal', '2029-07-09', 60, 'Every 5 Years', '2024–2029', '', 'Completed'],
    ['Urvah Visa',                 'Visa / Emirates ID',  'Personal', '2027-07-22', 30, 'Annual',        '2026–2027', '', 'Pending'],
    ['Urvah Passport',             'Other',               'Personal', '2028-03-25', 60, 'Every 5 Years', '2023–2028', '', 'Completed'],
    ['Abdullah ILOE',              'Other',               'Personal', '2027-11-20', 30, 'Annual',        '2026–2027', '', 'Pending'],
    ['Abdullah Home Renewal',      'Other',               'Personal', '2026-09-06', 30, 'Annual',        '2025–2026', '', 'Pending'],
    ['Abdullah Visa',              'Visa / Emirates ID',  'Personal', '2027-08-15', 30, 'Annual',        '2026–2027', '', 'Pending'],
    ['Abdullah Passport',          'Other',               'Personal', '2034-04-15', 60, 'Every 5 Years', '2029–2034', '', 'Completed'],
  ]

  for (const row of seedRows) {
    await query(
      `INSERT INTO document_expiry
         (name, document_type, company, expiry_date, reminder_days, renewal_frequency, period_covered, notes, workflow_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (name) DO NOTHING`,
      row
    )
  }
}

async function ensureSubscriptionsTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      name VARCHAR(500) NOT NULL,
      vendor VARCHAR(255) NOT NULL DEFAULT '',
      category VARCHAR(100) NOT NULL DEFAULT 'Other',
      status VARCHAR(50) NOT NULL DEFAULT 'Active',
      billing_cycle VARCHAR(50) NOT NULL DEFAULT 'Monthly',
      cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'AED',
      start_date DATE,
      expiry_date DATE,
      auto_renew BOOLEAN NOT NULL DEFAULT false,
      responsible_person VARCHAR(255) NOT NULL DEFAULT '',
      invoice_required BOOLEAN NOT NULL DEFAULT true,
      invoice_status VARCHAR(100) NOT NULL DEFAULT 'Missing',
      payment_status VARCHAR(100) NOT NULL DEFAULT 'Unpaid',
      payment_sent_at TIMESTAMPTZ,
      payment_sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(expiry_date)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_deleted ON subscriptions(deleted_at)`)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_name_active
    ON subscriptions(name) WHERE deleted_at IS NULL
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS subscription_invoices (
      id SERIAL PRIMARY KEY,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      file_name VARCHAR(500) NOT NULL DEFAULT '',
      file_url TEXT NOT NULL DEFAULT '',
      s3_key VARCHAR(1000) NOT NULL DEFAULT '',
      amount NUMERIC(14, 2),
      currency VARCHAR(10) NOT NULL DEFAULT 'AED',
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes TEXT NOT NULL DEFAULT ''
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_subscription_invoices_sub ON subscription_invoices(subscription_id)`)

  await query(`
    CREATE TABLE IF NOT EXISTS subscription_activity_logs (
      id SERIAL PRIMARY KEY,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      action VARCHAR(100) NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_subscription_activity_sub ON subscription_activity_logs(subscription_id)`)

  const seeded = await query(`SELECT COUNT(*)::int AS n FROM subscriptions WHERE deleted_at IS NULL`)
  if ((seeded.rows[0]?.n || 0) > 0) return

  const seedRows = [
    ['ChatGPT', 'OpenAI', 'AI', 'Monthly', 661, '2026-01-01', '2026-07-15'],
    ['360 Dialog', '360dialog', 'Communication', 'Monthly', 450, '2026-01-01', '2026-08-01'],
    ['Cursor', 'Cursor', 'AI', 'Monthly', 220, '2026-01-01', '2026-07-10'],
    ['Indeed Jobs', 'Indeed', 'Marketing', 'Monthly', 375, '2026-01-01', '2026-07-05'],
    ['Amazon AWS', 'Amazon', 'Hosting', 'Monthly', 170, '2026-01-01', '2026-07-28'],
    ['Vercel', 'Vercel', 'Hosting', 'Monthly', 295, '2026-01-01', '2026-08-15'],
    ['Respond.io', 'Respond.io', 'Communication', 'Monthly', 731.33, '2026-01-01', '2026-07-03'],
    ['Pecdora', 'Pecdora', 'Marketplace', 'Yearly', 110, '2025-06-01', '2026-06-15'],
    ['Zoho Books', 'Zoho', 'Accounting', 'Yearly', 3360, '2025-07-01', '2026-07-01'],
    ['Adobe Creative Cloud', 'Adobe', 'Design & Dev', 'Yearly', 250, '2025-08-01', '2026-08-01'],
    ['Envato Elements', 'Envato', 'Design & Dev', 'Yearly', 530, '2025-11-01', '2026-11-30'],
    ['Alibaba Seller Account', 'Alibaba', 'Marketplace', 'Yearly', 99, '2025-09-01', '2026-09-01'],
    ['Freepik', 'Freepik', 'Design & Dev', 'Yearly', 19.99, '2025-12-01', '2026-12-01'],
  ]

  for (const [name, vendor, category, billingCycle, cost, startDate, expiryDate] of seedRows) {
    await query(
      `INSERT INTO subscriptions
         (name, vendor, category, billing_cycle, cost, currency, start_date, expiry_date, invoice_required, invoice_status, payment_status)
       VALUES ($1, $2, $3, $4, $5, 'AED', $6, $7, true, 'Missing', 'Unpaid')`,
      [name, vendor, category, billingCycle, cost, startDate, expiryDate]
    )
  }
}

async function ensureSimCardsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS sim_cards (
      id SERIAL PRIMARY KEY,
      number VARCHAR(100) NOT NULL,
      remarks TEXT NOT NULL DEFAULT '',
      person VARCHAR(255) NOT NULL,
      imei_number VARCHAR(255) NOT NULL DEFAULT '',
      mobile_number VARCHAR(255) NOT NULL DEFAULT '',
      monthly_charges_aed NUMERIC(14,2) NOT NULL DEFAULT 0,
      usage VARCHAR(10) NOT NULL DEFAULT 'Yes',
      type VARCHAR(255) NOT NULL,
      issued VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_sim_cards_number ON sim_cards(number)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_sim_cards_person ON sim_cards(person)`)

  const seeded = await query(`SELECT COUNT(*)::int AS n FROM sim_cards`)
  const n = seeded.rows[0]?.n || 0
  if (n > 0) return

  const seedRows = [
    ['0521573960', 'Banned but Getting Calls', 'Ali', '96958, 96953', 'Samsung S24 Ultra', 105, 'Yes', 'Data + Calls', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0569048966', 'Banned but Getting Calls', 'Iphone', '90338', 'Iphone 14 Pro Max', 105, 'No', 'Data + Calls', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0565043223', '', 'Margaret', '38094, 38096', 'Galaxy A70', 105, 'Yes', 'Data + Calls', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0506890728', '', 'Respond.io', '66249, 66240', 'Galaxy Note 10 Lite', 105, 'Yes', 'Data + Calls', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0569066450', '', 'Ajmal sharaf', '78154, 78152', 'Galaxy X Cover Pro', 105, 'Yes', 'Data + Calls', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0565028957', '', 'Abdullah', '10486, 10487', 'Samsung Note 10 Lite', 105, 'Yes', 'Data + Calls', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0503253960', 'Banned but Getting Calls', 'Ali', '46641, 46642', 'Samsung Note 10 Lite', 105, 'No', 'Data + Calls', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0502073960', 'New Sim', 'Website- new connection', '96958, 96953', 'Samsung S24 Ultra', 105, 'Yes', 'Data + Calls', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0503924053', '', 'Aparna (Dev)', '66249, 66240', 'Galaxy Note 10 Lite', 0, 'Yes', 'Just Sim (No Package)', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0503925249', '', 'Ch. Faizan', '23554, 23555', 'Samsung Note 10 Lite', 0, 'Yes', 'Just Sim (No Package)', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0521467950', '', 'Abobecker', '48519, 48515', 'Galaxy X Cover 6 Pro', 0, 'Yes', 'Just Sim (No Package)', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['042593082', '', 'E-Com telephone', '', '', 500, 'Yes', 'Official Landline', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['045476168', '', 'E-Com telephone', '', '', 1850, 'Yes', 'Offical Internet', 'BASMAT AL HAYAT GENERAL TRADING LLC'],
    ['0554736936', '', 'Mubashir', '', '', 105, 'Yes', 'Data + Calls', 'AL HOORA TRADING LLC'],
    ['0501779856', '', 'Shahid', '', '', 105, 'Yes', 'Data + Calls', 'AL HOORA TRADING LLC'],
  ]

  for (const row of seedRows) {
    await query(
      `INSERT INTO sim_cards (
        number, remarks, person, imei_number, mobile_number,
        monthly_charges_aed, usage, type, issued
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      row
    )
  }
}

/**
 * Maps Zoho items to logical "report_group" buckets used by the Weekly Reports
 * section. Membership is the source of truth for which items appear in which
 * report. The numeric values themselves always come from the Zoho-source
 * Zoho data (see services/zohoService.js + weeklyReportZohoData.js);
 * this table only decides membership.
 *
 * Seed lists below are bootstrap-only — they reflect the initial Excel groups
 * provided by the business. Long-term, edit this table directly (or add an
 * admin UI) to manage which SKUs belong to which report.
 */
async function ensureItemReportGroupsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS item_report_groups (
      id           SERIAL PRIMARY KEY,
      sku          VARCHAR(100),
      item_id      VARCHAR(100),
      item_name    VARCHAR(255),
      report_group VARCHAR(64) NOT NULL,
      active       BOOLEAN NOT NULL DEFAULT true,
      notes        TEXT NOT NULL DEFAULT '',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (sku IS NOT NULL OR item_id IS NOT NULL OR item_name IS NOT NULL)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_irg_group ON item_report_groups(report_group, active)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_irg_sku   ON item_report_groups(LOWER(sku))`)
  await query(`CREATE INDEX IF NOT EXISTS idx_irg_name  ON item_report_groups(LOWER(item_name))`)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_irg_sku_group
      ON item_report_groups(LOWER(sku), report_group)
      WHERE sku IS NOT NULL
  `)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_irg_name_group
      ON item_report_groups(LOWER(item_name), report_group)
      WHERE sku IS NULL AND item_name IS NOT NULL
  `)

  // Bootstrap seed (idempotent). Skipped entirely if any rows already exist for
  // the group — operators can freely add/remove rows without seed-overwrite.
  const seedGroups = [
    {
      group: 'slow_moving',
      items: [
        'FL SHINE', 'LIFEP2N', 'CUT', 'Acrylic', 'LIFESS',
        'LIFEP9', 'PR', 'STA', 'EGG', 'APRON',
      ],
    },
    {
      group: 'other_family',
      items: [
        'LIFEP75', 'LIFEP17', 'LIFEP18', 'LIFEP17S', 'LIFEP12', 'LIFEP7',
        'LIFEP20', 'FLHM-S', 'LIFEP30', 'ZDS-NEW', 'LIFEP32', 'LIFEP19',
        'LIFEP22', 'LUP', 'LIFEP13N', 'LIFEP24', 'DSH', 'FLCM',
        'R TROLLEY', 'NML', 'TNML', 'LIFEP29', 'TOOLS', 'NCK',
        'LIFEP5', 'TK1', 'BRKH', 'FK', 'SPHM-S', 'NSEL',
        'LIFEP26', 'MR', 'LIFEP21', 'SPF', 'TK3', 'LIFEP23',
      ],
    },
  ]

  for (const { group, items } of seedGroups) {
    const existing = await query(
      `SELECT 1 FROM item_report_groups WHERE report_group = $1 LIMIT 1`,
      [group]
    )
    if (existing.rowCount > 0) continue

    for (const name of items) {
      await query(
        `INSERT INTO item_report_groups (item_name, report_group, notes)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [name, group, 'bootstrap seed']
      )
    }
  }
}

async function ensureItemReportGroupsImportLogTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS item_report_groups_import_log (
      id                SERIAL PRIMARY KEY,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_id           INTEGER,
      user_role         VARCHAR(32),
      mode              VARCHAR(32) NOT NULL,
      total_rows        INTEGER NOT NULL DEFAULT 0,
      created_count     INTEGER NOT NULL DEFAULT 0,
      updated_count     INTEGER NOT NULL DEFAULT 0,
      invalid_count     INTEGER NOT NULL DEFAULT 0,
      deactivated_count INTEGER NOT NULL DEFAULT 0,
      succeeded         BOOLEAN NOT NULL DEFAULT TRUE,
      error_code        VARCHAR(64),
      notes             TEXT
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_irg_import_log_created_at
      ON item_report_groups_import_log (created_at DESC)
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
  await query(`
    UPDATE employees
    SET photo_url = NULL
    WHERE photo_doc_key IS NULL
      AND photo_url IS NOT NULL
      AND (
        photo_url LIKE '%X-Amz-Signature=%'
        OR photo_url LIKE '%X-Amz-Algorithm=%'
      )
  `)
}

/**
 * One-time: derive prices, company_payments, and taxation keys from legacy modules
 * so existing users keep access after splitting permissions (plan migration A).
 */
async function migratePermissionsNewModulesOnce() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_patches (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  const patchId = 'permissions_modules_v2_20260504'
  const exists = await query(`SELECT 1 FROM schema_patches WHERE id = $1`, [patchId])
  if (exists.rows.length > 0) return

  const { rows } = await query(`SELECT id, permissions FROM users WHERE role <> 'admin'`)
  for (const row of rows) {
    let p = row.permissions
    if (p == null) p = {}
    if (typeof p === 'string') {
      try {
        p = JSON.parse(p)
      } catch {
        p = {}
      }
    }
    const next = { ...p }
    let changed = false

    const de = p.document_expiry || {}
    if (de.view && !next.prices?.view) {
      next.prices = { ...(next.prices || {}), view: true }
      changed = true
    }

    if (de.view || de.add || de.edit || de.delete) {
      const cp = { ...(next.company_payments || {}) }
      let cpChanged = false
      const needView = !!(de.view || de.add || de.edit || de.delete)
      if (needView && !cp.view) {
        cp.view = true
        cpChanged = true
      }
      if (de.add && !cp.add) {
        cp.add = true
        cpChanged = true
      }
      if (de.edit && !cp.edit) {
        cp.edit = true
        cpChanged = true
      }
      if (de.delete && !cp.delete) {
        cp.delete = true
        cpChanged = true
      }
      if (cpChanged) {
        next.company_payments = cp
        changed = true
      }
    }

    const wr = p.weekly_reports || {}
    if (wr.view && !next.taxation?.view) {
      next.taxation = { ...(next.taxation || {}), view: true }
      changed = true
    }

    if (changed) {
      await query(`UPDATE users SET permissions = $1::jsonb, updated_at = NOW() WHERE id = $2`, [
        JSON.stringify(next),
        row.id,
      ])
    }
  }

  await query(`INSERT INTO schema_patches (id) VALUES ($1)`, [patchId])
  console.log('[db] migratePermissionsNewModulesOnce applied:', patchId)
}

/**
 * Grant influencers.performance to portal users matching Ali Hassan (employee name or username).
 */
async function grantAliHassanInfluencerPerformancePermissionOnce() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_patches (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  const patchId = 'grant_ali_hassan_influencer_performance_202605'
  const exists = await query(`SELECT 1 FROM schema_patches WHERE id = $1`, [patchId])
  if (exists.rows.length > 0) return

  const upd = await query(
    `UPDATE users u
     SET permissions = jsonb_set(
       COALESCE(u.permissions, '{}'::jsonb),
       '{influencers}',
       COALESCE(u.permissions->'influencers', '{}'::jsonb) || '{"performance": true}'::jsonb,
       true
     ),
     updated_at = NOW()
     FROM employees e
     WHERE u.employee_id = e.id
       AND u.role NOT IN ('admin')
       AND (
         (
           LOWER(TRIM(COALESCE(e.full_name, ''))) LIKE '%ali%'
           AND LOWER(TRIM(COALESCE(e.full_name, ''))) LIKE '%hassan%'
         )
         OR LOWER(TRIM(COALESCE(u.username, ''))) LIKE '%alihassan%'
         OR LOWER(TRIM(COALESCE(u.username, ''))) LIKE '%ali.hassan%'
         OR LOWER(TRIM(COALESCE(u.username, ''))) LIKE '%ali_hassan%'
       )
     RETURNING u.id, u.username, e.full_name`
  )
  if (upd.rows.length > 0) {
    console.log('[db] grantAliHassanInfluencerPerformancePermissionOnce updated:', upd.rows)
  } else {
    console.log(
      '[db] grantAliHassanInfluencerPerformancePermissionOnce: no matching user (skip or add manually in Roles & Permissions)'
    )
  }

  await query(`INSERT INTO schema_patches (id) VALUES ($1)`, [patchId])
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
  await resyncAdminPasswordFromEnvIfRequested()
  await ensureWarehouseUser()
  try {
    await migratePermissionsNewModulesOnce()
  } catch (e) {
    console.error('[db] migratePermissionsNewModulesOnce skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await grantAliHassanInfluencerPerformancePermissionOnce()
  } catch (e) {
    console.error('[db] grantAliHassanInfluencerPerformancePermissionOnce skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureInfluencerPerformanceRecordsTable()
  } catch (e) {
    console.error('[db] ensureInfluencerPerformanceRecordsTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureInfluencerContractPaymentsTable()
  } catch (e) {
    console.error('[db] ensureInfluencerContractPaymentsTable skipped/failed (non-fatal):', e.message || e)
  }
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
  try {
    await ensureAnnualLeaveSalaryTable()
  } catch (e) {
    // Common on RDS when annual_leave_salary was created by a superuser: CREATE INDEX requires table owner.
    console.error('[db] ensureAnnualLeaveSalaryTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await normalizeEmployeePhotoUrls()
  } catch (e) {
    console.error('[db] normalizeEmployeePhotoUrls skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureAttendanceAssignmentsTable()
  } catch (e) {
    console.error('[db] ensureAttendanceAssignmentsTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureInfluencersSnapshotTable()
  } catch (e) {
    console.error('[db] ensureInfluencersSnapshotTable skipped/failed (non-fatal):', e.message || e)
  }
  await ensureSimCardsTable()
  try {
    await ensureDocumentExpiryTable()
  } catch (e) {
    console.error('[db] ensureDocumentExpiryTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureSubscriptionsTables()
  } catch (e) {
    console.error('[db] ensureSubscriptionsTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureZohoAccountWatchlistTable } = require('../services/zohoAccountWatchlistStore')
    await ensureZohoAccountWatchlistTable()
  } catch (e) {
    console.error('[db] ensureZohoAccountWatchlistTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureProjectsTable()
  } catch (e) {
    console.error('[db] ensureProjectsTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureProjectSectionsTable()
  } catch (e) {
    console.error('[db] ensureProjectSectionsTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureProjectTasksTable()
  } catch (e) {
    console.error('[db] ensureProjectTasksTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureTaskDependenciesTable()
  } catch (e) {
    console.error('[db] ensureTaskDependenciesTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureTaskAttachmentsTable()
  } catch (e) {
    console.error('[db] ensureTaskAttachmentsTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureTaskAttachmentKindColumn()
  } catch (e) {
    console.error('[db] ensureTaskAttachmentKindColumn skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureItemReportGroupsTable()
  } catch (e) {
    console.error('[db] ensureItemReportGroupsTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureItemReportGroupsImportLogTable()
  } catch (e) {
    console.error('[db] ensureItemReportGroupsImportLogTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureWeeklyAdsReportHistoryTable } = require('../services/weeklyAdsReportHistoryStore')
    await ensureWeeklyAdsReportHistoryTable()
  } catch (e) {
    console.error('[db] ensureWeeklyAdsReportHistoryTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureUserPreferencesTable } = require('../services/userPreferencesStore')
    await ensureUserPreferencesTable()
  } catch (e) {
    console.error('[db] ensureUserPreferencesTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureZohoApiTables } = require('../services/zohoApiStore')
    await ensureZohoApiTables()
  } catch (e) {
    console.error('[db] ensureZohoApiTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureZohoBulkInvoiceTables } = require('../services/zohoBulkInvoiceStore')
    await ensureZohoBulkInvoiceTables()
  } catch (e) {
    console.error('[db] ensureZohoBulkInvoiceTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureBulkQuantityAdjustmentTables } = require('../services/bulkQuantityAdjustmentStore')
    await ensureBulkQuantityAdjustmentTables()
  } catch (e) {
    console.error('[db] ensureBulkQuantityAdjustmentTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensurePurchasePlanningTables } = require('../services/purchasePlanningService')
    await ensurePurchasePlanningTables()
  } catch (e) {
    console.error('[db] ensurePurchasePlanningTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureAiBudgetAndUsageTables()
  } catch (e) {
    console.error('[db] ensureAiBudgetAndUsageTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureUaePricesCustomRatesTable } = require('../services/uaePricesCustomService')
    await ensureUaePricesCustomRatesTable()
  } catch (e) {
    console.error('[db] ensureUaePricesCustomRatesTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureAmazonBulkListingTables()
  } catch (e) {
    console.error('[db] ensureAmazonBulkListingTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureAmazonOrdersCacheTables } = require('../services/amazonOrdersCacheStore')
    await ensureAmazonOrdersCacheTables()
  } catch (e) {
    console.error('[db] ensureAmazonOrdersCacheTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureAmazonCatalogItemCacheTables } = require('../services/amazonCatalogItemCacheStore')
    await ensureAmazonCatalogItemCacheTables()
  } catch (e) {
    console.error('[db] ensureAmazonCatalogItemCacheTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureAmazonSkuImageOverrideTables } = require('../services/amazonSkuImageOverrideStore')
    await ensureAmazonSkuImageOverrideTables()
  } catch (e) {
    console.error('[db] ensureAmazonSkuImageOverrideTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureAmazonZohoStockComparisonTables } = require('../services/amazonZohoStockComparisonStore')
    await ensureAmazonZohoStockComparisonTables()
  } catch (e) {
    console.error('[db] ensureAmazonZohoStockComparisonTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureAmazonZohoStockRefreshJobTable } = require('../services/amazonZohoStockRefreshJobStore')
    await ensureAmazonZohoStockRefreshJobTable()
  } catch (e) {
    console.error('[db] ensureAmazonZohoStockRefreshJobTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureAmazonPaymentClearingTables } = require('../services/amazonPaymentClearingStore')
    await ensureAmazonPaymentClearingTables()
  } catch (e) {
    console.error('[db] ensureAmazonPaymentClearingTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureAmazonKsaRtoLabelingTables } = require('../services/amazonKsaRtoLabelingService')
    await ensureAmazonKsaRtoLabelingTables()
  } catch (e) {
    console.error('[db] ensureAmazonKsaRtoLabelingTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureAmazonReturnReconciliationTables } = require('../services/amazonReturnReconciliationService')
    await ensureAmazonReturnReconciliationTables()
  } catch (e) {
    console.error('[db] ensureAmazonReturnReconciliationTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureInventoryItemImageTables } = require('../services/inventoryItemImageStore')
    await ensureInventoryItemImageTables()
  } catch (e) {
    console.error('[db] ensureInventoryItemImageTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureNutritionCoachTables } = require('../services/nutritionCoachService')
    await ensureNutritionCoachTables()
  } catch (e) {
    console.error('[db] ensureNutritionCoachTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureCompositeItemsPriceReportTables } = require('../services/compositeItemsPriceReportService')
    await ensureCompositeItemsPriceReportTables()
  } catch (e) {
    console.error('[db] ensureCompositeItemsPriceReportTables skipped/failed (non-fatal):', e.message || e)
  }
  // Team Planner Phase 1 — must run after projects, project_tasks, users tables exist
  await ensureTeamPlannerTables()
  // Linear Workspace shared tables (Phase 14A)
  try {
    const { ensureLinearWorkspaceTables } = require('./linearWorkspaceMigrations')
    await ensureLinearWorkspaceTables()
  } catch (e) {
    console.error('[db] ensureLinearWorkspaceTables skipped/failed (non-fatal):', e.message || e)
  }
  try {
    const { ensureNoonProductSnapshotsTable } = require('../services/noon/noonSnapshotStore')
    await ensureNoonProductSnapshotsTable()
    console.log('[db] Noon product snapshot table: OK')
  } catch (e) {
    console.error('[db] ensureNoonProductSnapshotsTable skipped/failed (non-fatal):', e.message || e)
  }
}

async function ensureProjectsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE,
      description TEXT DEFAULT '',
      status VARCHAR(50) NOT NULL DEFAULT 'Planning',
      priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
      color VARCHAR(20) DEFAULT '#8b5cf6',
      start_date DATE,
      due_date DATE,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived)`)
}

async function ensureProjectSectionsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS project_sections (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_project_sections_project_id ON project_sections(project_id)`)
}

async function ensureProjectTasksTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS project_tasks (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES project_sections(id) ON DELETE SET NULL,
      parent_task_id INTEGER REFERENCES project_tasks(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL,
      description TEXT DEFAULT '',
      status VARCHAR(50) NOT NULL DEFAULT 'Not Started',
      priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
      start_date DATE,
      due_date DATE,
      completed_at TIMESTAMPTZ,
      estimated_hours NUMERIC(8,2),
      actual_hours NUMERIC(8,2),
      progress_percent SMALLINT NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived BOOLEAN NOT NULL DEFAULT false,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON project_tasks(project_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_project_tasks_section_id ON project_tasks(section_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_project_tasks_parent_task_id ON project_tasks(parent_task_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status)`)
}

async function ensureTaskDependenciesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      depends_on_task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      dependency_type VARCHAR(30) NOT NULL DEFAULT 'finish-to-start',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(task_id, depends_on_task_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_task_deps_task_id ON task_dependencies(task_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_task_deps_depends_on ON task_dependencies(depends_on_task_id)`)
}

async function ensureTaskAttachmentsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      file_name VARCHAR(500) NOT NULL,
      s3_key TEXT NOT NULL,
      file_type VARCHAR(100),
      file_size INTEGER,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id)`)
}

async function ensureTaskAttachmentKindColumn() {
  await query(`
    ALTER TABLE task_attachments
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'attachment'
  `)
}

/** AI usage tracking + Amazon listing generations (OpenAI proxy — key stays server-side only). */
async function ensureAiBudgetAndUsageTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_budget_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      daily_budget_usd NUMERIC(14,4) NOT NULL DEFAULT 50,
      monthly_budget_usd NUMERIC(14,4) NOT NULL DEFAULT 500,
      alert_threshold_percent NUMERIC(6,2) NOT NULL DEFAULT 80,
      default_model VARCHAR(128) NOT NULL DEFAULT 'gpt-4.1-mini',
      max_batch_size INTEGER NOT NULL DEFAULT 10,
      allow_ai_generation BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ai_budget_settings_singleton CHECK (id = 1),
      CONSTRAINT ai_budget_settings_batch_chk CHECK (max_batch_size >= 1 AND max_batch_size <= 500)
    )
  `)
  await query(`ALTER TABLE ai_budget_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await query(`
    INSERT INTO ai_budget_settings (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      module_name VARCHAR(128) NOT NULL,
      action_name VARCHAR(128) NOT NULL,
      model VARCHAR(128) NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd NUMERIC(16,8) NOT NULL DEFAULT 0,
      request_status VARCHAR(32) NOT NULL,
      error_message TEXT,
      request_duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS request_duration_ms INTEGER`)
  await query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs(created_at)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_module ON ai_usage_logs(module_name)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user ON ai_usage_logs(user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_status ON ai_usage_logs(request_status)`)

  await query(`
    CREATE TABLE IF NOT EXISTS amazon_listing_generations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_input JSONB NOT NULL DEFAULT '{}',
      listing_result JSONB NOT NULL DEFAULT '{}',
      ai_usage_log_id INTEGER REFERENCES ai_usage_logs(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_listing_generations_user ON amazon_listing_generations(user_id)`
  )

  await query(`
    CREATE TABLE IF NOT EXISTS amazon_generated_listings (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(255) NOT NULL,
      product_name TEXT NOT NULL,
      generated_title TEXT NOT NULL DEFAULT '',
      generated_bullets JSONB NOT NULL DEFAULT '[]',
      generated_description TEXT NOT NULL DEFAULT '',
      generated_search_terms JSONB NOT NULL DEFAULT '[]',
      marketplace VARCHAR(16) NOT NULL,
      language VARCHAR(8) NOT NULL,
      ai_model VARCHAR(128) NOT NULL,
      estimated_cost NUMERIC(16,8) NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ai_usage_log_id INTEGER REFERENCES ai_usage_logs(id) ON DELETE SET NULL,
      arabic_title TEXT NOT NULL DEFAULT '',
      arabic_bullets JSONB NOT NULL DEFAULT '[]',
      suggested_attributes JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_generated_listings_sku ON amazon_generated_listings(sku)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amazon_generated_listings_created ON amazon_generated_listings(created_at)`
  )
}

async function ensureAmazonBulkListingTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS listing_batches (
      id SERIAL PRIMARY KEY,
      batch_name TEXT NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      original_filename TEXT NOT NULL,
      original_mime_type TEXT DEFAULT '',
      original_file_ext TEXT DEFAULT '',
      workbook_data BYTEA NOT NULL,
      template_sheet_name TEXT NOT NULL DEFAULT 'Template',
      header_row_number INTEGER NOT NULL DEFAULT 1,
      sku_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      overflow_count INTEGER NOT NULL DEFAULT 0,
      detected_columns JSONB NOT NULL DEFAULT '[]',
      active_columns JSONB NOT NULL DEFAULT '[]',
      valid_values JSONB NOT NULL DEFAULT '{}',
      status VARCHAR(32) NOT NULL DEFAULT 'Imported',
      summary_counts JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      exported_at TIMESTAMPTZ
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS listing_batch_rows (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES listing_batches(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      sheet_row_number INTEGER NOT NULL,
      sku TEXT NOT NULL,
      item_name TEXT DEFAULT '',
      marketplace TEXT DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'Imported',
      raw_values JSONB NOT NULL DEFAULT '{}',
      current_values JSONB NOT NULL DEFAULT '{}',
      generated_values JSONB NOT NULL DEFAULT '{}',
      source_map JSONB NOT NULL DEFAULT '{}',
      validation JSONB NOT NULL DEFAULT '{"errors":[],"warnings":[]}',
      quality JSONB NOT NULL DEFAULT '{}',
      ai_usage_log_id INTEGER REFERENCES ai_usage_logs(id) ON DELETE SET NULL,
      ai_model VARCHAR(128),
      estimated_cost_usd NUMERIC(16,8) NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      approved_at TIMESTAMPTZ,
      generated_at TIMESTAMPTZ,
      exported_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(batch_id, sheet_row_number),
      UNIQUE(batch_id, sku)
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS default_profiles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      marketplace VARCHAR(32) DEFAULT '',
      description TEXT DEFAULT '',
      is_builtin BOOLEAN NOT NULL DEFAULT false,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS default_profile_fields (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES default_profiles(id) ON DELETE CASCADE,
      column_key TEXT NOT NULL,
      column_label TEXT NOT NULL,
      default_value TEXT NOT NULL DEFAULT '',
      apply_mode VARCHAR(32) NOT NULL DEFAULT 'fill_empty',
      enabled BOOLEAN NOT NULL DEFAULT true,
      source VARCHAR(32) NOT NULL DEFAULT 'Fixed Default',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS listing_batch_events (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES listing_batches(id) ON DELETE CASCADE,
      row_id INTEGER REFERENCES listing_batch_rows(id) ON DELETE CASCADE,
      event_type VARCHAR(64) NOT NULL,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      details JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_listing_batches_created ON listing_batches(created_at DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_listing_batches_user ON listing_batches(uploaded_by)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_listing_batch_rows_batch ON listing_batch_rows(batch_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_listing_batch_rows_status ON listing_batch_rows(batch_id, status)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_listing_batch_rows_sku ON listing_batch_rows(sku)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_default_profile_fields_profile ON default_profile_fields(profile_id)`)

  const profiles = [
    ['Life Smile Amazon UAE', 'UAE', 'Default Life Smile profile for Amazon.ae'],
    ['Life Smile Amazon KSA', 'KSA', 'Default Life Smile profile for Amazon.sa'],
    ['Cookware UAE', 'UAE', 'Cookware profile for Amazon.ae'],
    ['Cookware KSA', 'KSA', 'Cookware profile for Amazon.sa'],
    ['Custom', '', 'Editable custom defaults'],
  ]
  for (const [name, marketplace, description] of profiles) {
    await query(
      `INSERT INTO default_profiles (name, marketplace, description, is_builtin)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (name) DO NOTHING`,
      [name, marketplace, description]
    )
  }

  const r = await query(`SELECT id, name FROM default_profiles WHERE name IN ('Life Smile Amazon UAE','Life Smile Amazon KSA','Cookware UAE','Cookware KSA')`)
  for (const row of r.rows) {
    const defaults = [
      ['brand_name', 'Brand Name', 'Life Smile'],
      ['manufacturer', 'Manufacturer', 'Basmat Al Hayat General Trading LLC'],
    ]
    for (const [columnKey, columnLabel, defaultValue] of defaults) {
      await query(
        `INSERT INTO default_profile_fields (profile_id, column_key, column_label, default_value, apply_mode, enabled)
         SELECT $1, $2, $3, $4, 'fill_empty', true
         WHERE NOT EXISTS (
           SELECT 1 FROM default_profile_fields WHERE profile_id = $1 AND column_key = $2
         )`,
        [row.id, columnKey, columnLabel, defaultValue]
      )
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Team Planner Phase 1 — additive migrations
// All helpers use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so they are safe
// to run multiple times and never break existing data.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True when a named constraint already exists on a table (pg_catalog).
 * Cheap SELECT on every startup — skips ALTER when the constraint is present.
 */
async function pgConstraintExistsOnTable(constraintName, tableName) {
  const result = await query(
    `SELECT 1 FROM pg_constraint
     WHERE conname = $1 AND conrelid = $2::regclass
     LIMIT 1`,
    [constraintName, tableName]
  )
  return result.rowCount > 0
}

/**
 * Extend projects with team-planner fields.
 * project_type: 'software' | 'website' | 'mobile' | 'ops' | 'other'
 */
async function ensureProjectsTeamColumns() {
  await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type VARCHAR(30) NOT NULL DEFAULT 'software'`)
  await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS emoji VARCHAR(10)`)
  await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false`)
}

/**
 * Extend project_tasks with Jira-style fields.
 * All columns nullable or have safe defaults so existing rows are unaffected.
 */
async function ensureProjectTasksTeamColumns() {
  // People
  await query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`)
  await query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS reporter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`)
  await query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`)

  // Issue classification
  await query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS issue_type VARCHAR(20) NOT NULL DEFAULT 'task'`)
  // Allowed values: task | bug | story | epic | subtask

  // Sprint linkage
  await query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS sprint_id INTEGER`)
  // FK added after sprints table exists (see ensureSprintsTable); index below

  // Estimation & effort
  await query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS story_points SMALLINT`)
  // estimated_hours and actual_hours already exist on project_tasks (added at table creation)
  // completed_at already exists on project_tasks

  // Labels (simple text array — no join table needed at this scale)
  await query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}'`)

  // Blocker reason (free text explanation when status = 'Blocked')
  await query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS blocked_reason TEXT`)

  // Dev workflow metadata: branch, PR URL, PR status, commit ref (Phase 6C)
  await query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS dev_meta JSONB NOT NULL DEFAULT '{}'::jsonb`)

  // Indexes on frequently filtered columns
  await query(`CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee ON project_tasks(assignee_user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_project_tasks_issue_type ON project_tasks(issue_type)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_project_tasks_sprint ON project_tasks(sprint_id)`)
}

/**
 * project_members — who belongs to each project and in what role.
 * role: 'owner' | 'member' | 'viewer'
 */
async function ensureProjectMembersTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS project_members (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      role       VARCHAR(20) NOT NULL DEFAULT 'member',
      joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, user_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_project_members_user    ON project_members(user_id)`)
}

/**
 * sprints — time-boxed work iterations per project.
 * status: 'draft' | 'active' | 'completed'
 */
async function ensureSprintsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS sprints (
      id         SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       VARCHAR(255) NOT NULL,
      goal       TEXT,
      status     VARCHAR(20) NOT NULL DEFAULT 'draft',
      start_date DATE,
      end_date   DATE,
      completed_at TIMESTAMPTZ,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_sprints_project ON sprints(project_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_sprints_status  ON sprints(status)`)

  // FK from project_tasks.sprint_id → sprints.id (after sprint_id column + sprints table exist)
  if (!(await pgConstraintExistsOnTable('fk_project_tasks_sprint_id', 'project_tasks'))) {
    await query(`
      ALTER TABLE project_tasks
        ADD CONSTRAINT fk_project_tasks_sprint_id
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE SET NULL
    `)
  }
}

/**
 * task_comments — threaded comments on any task.
 */
async function ensureTaskCommentsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id         SERIAL PRIMARY KEY,
      task_id    INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      parent_id  INTEGER REFERENCES task_comments(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      edited_at  TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_task_comments_task    ON task_comments(task_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_task_comments_user    ON task_comments(user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_task_comments_created ON task_comments(created_at)`)
}

/**
 * task_activity_log — append-only audit trail for every task change.
 * action examples: 'status_changed', 'assignee_changed', 'comment_added', 'created', 'priority_changed'
 */
async function ensureTaskActivityTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS task_activity_log (
      id         SERIAL PRIMARY KEY,
      task_id    INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action     VARCHAR(60) NOT NULL,
      old_value  TEXT,
      new_value  TEXT,
      meta       JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_task_activity_task    ON task_activity_log(task_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_task_activity_user    ON task_activity_log(user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_task_activity_created ON task_activity_log(created_at DESC)`)
}

/**
 * Run all Phase 1 team-planner migrations in safe dependency order.
 * Called from initDb() — safe to re-run on every server start.
 */
async function ensureTeamPlannerTables() {
  try {
    await ensureProjectsTeamColumns()
    await ensureProjectTasksTeamColumns()
    await ensureProjectMembersTable()
    await ensureSprintsTable()          // must come after project_tasks sprint_id column added
    await ensureTaskCommentsTable()
    await ensureTaskActivityTable()
    console.log('[db] Team planner tables: OK')
  } catch (e) {
    console.error('[db] ensureTeamPlannerTables skipped/failed (non-fatal):', e.message || e)
  }
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
  resyncAdminPasswordFromEnvIfRequested,
  ensureInfluencersSnapshotTable,
  ensureInfluencerPerformanceRecordsTable,
  ensureInfluencerContractPaymentsTable,
  ensureDocumentExpiryTable,
  ensureNotificationSyncStateTable,
  ensureSubscriptionsTables,
  ensureItemReportGroupsTable,
  ensureItemReportGroupsImportLogTable,
  ensureAiBudgetAndUsageTables,
  ensureAmazonBulkListingTables,
  ensureTeamPlannerTables,
}
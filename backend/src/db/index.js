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
    await ensureItemReportGroupsTable()
  } catch (e) {
    console.error('[db] ensureItemReportGroupsTable skipped/failed (non-fatal):', e.message || e)
  }
  try {
    await ensureItemReportGroupsImportLogTable()
  } catch (e) {
    console.error('[db] ensureItemReportGroupsImportLogTable skipped/failed (non-fatal):', e.message || e)
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
  ensureDocumentExpiryTable,
  ensureItemReportGroupsTable,
  ensureItemReportGroupsImportLogTable,
}
/**
 * linearWorkspaceService.js
 * CRUD for all linear_* shared workspace tables.
 */
const { query } = require('../db')

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowISO() { return new Date().toISOString() }

function safe(rows) { return rows || [] }

function parseRow(row) {
  if (!row) return null
  return { ...row }
}

// ── Docs ─────────────────────────────────────────────────────────────────────

async function listDocs() {
  const { rows } = await query(
    'SELECT * FROM linear_docs ORDER BY updated_at DESC'
  )
  return safe(rows).map(parseRow)
}

async function getDoc(id) {
  const { rows } = await query('SELECT * FROM linear_docs WHERE id = $1', [id])
  return parseRow(rows[0]) || null
}

async function createDoc(data, userId) {
  const { title, category = null, tags = [], summary = null, content = null,
          related_project_id = null, related_labels = [] } = data
  const { rows } = await query(
    `INSERT INTO linear_docs
       (title, category, tags, summary, content, related_project_id, related_labels, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     RETURNING *`,
    [title, category, tags, summary, content, related_project_id, related_labels, userId || null]
  )
  return parseRow(rows[0])
}

async function updateDoc(id, data, userId) {
  const fields = []
  const vals   = []
  let   i      = 1
  const allowed = ['title','category','tags','summary','content','related_project_id','related_labels']
  for (const k of allowed) {
    if (data[k] !== undefined) {
      fields.push(`${k} = $${i++}`)
      vals.push(data[k])
    }
  }
  if (!fields.length) return getDoc(id)
  fields.push(`updated_by = $${i++}`, `updated_at = NOW()`)
  vals.push(userId || null, id)
  const { rows } = await query(
    `UPDATE linear_docs SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  )
  return parseRow(rows[0]) || null
}

async function deleteDoc(id) {
  await query('DELETE FROM linear_docs WHERE id = $1', [id])
}

// ── Intake ────────────────────────────────────────────────────────────────────

async function listIntake() {
  const { rows } = await query(
    'SELECT * FROM linear_intake_items ORDER BY created_at DESC'
  )
  return safe(rows)
}

async function createIntake(data, userId) {
  const cols = ['title','source','type','platform','status','priority_suggestion',
                'description','url_or_screen','customer_reference','labels',
                'template','structured_fields','linked_issue_id',
                'duplicate_of_intake_id','duplicate_reason']
  const allowed = {}
  for (const c of cols) if (data[c] !== undefined) allowed[c] = data[c]
  allowed.created_by = userId || null
  allowed.updated_by = userId || null

  const keys = Object.keys(allowed)
  const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ')
  const values = keys.map(k => allowed[k])
  const { rows } = await query(
    `INSERT INTO linear_intake_items (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  )
  return parseRow(rows[0])
}

async function updateIntake(id, data, userId) {
  const cols = ['title','source','type','platform','status','priority_suggestion',
                'description','url_or_screen','customer_reference','labels',
                'template','structured_fields','linked_issue_id',
                'duplicate_of_intake_id','duplicate_reason']
  const fields = []; const vals = []; let i = 1
  for (const k of cols) {
    if (data[k] !== undefined) { fields.push(`${k} = $${i++}`); vals.push(data[k]) }
  }
  if (!fields.length) { const { rows } = await query('SELECT * FROM linear_intake_items WHERE id = $1', [id]); return parseRow(rows[0]) }
  fields.push(`updated_by = $${i++}`, `updated_at = NOW()`)
  vals.push(userId || null, id)
  const { rows } = await query(
    `UPDATE linear_intake_items SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals
  )
  return parseRow(rows[0]) || null
}

async function deleteIntake(id) {
  await query('DELETE FROM linear_intake_items WHERE id = $1', [id])
}

// ── Mobile Releases ───────────────────────────────────────────────────────────

async function listMobileReleases() {
  const { rows } = await query('SELECT * FROM linear_mobile_releases ORDER BY created_at DESC')
  return safe(rows)
}

async function createMobileRelease(data, userId) {
  const cols = ['name','platform','version_number','build_number','status',
                'target_date','submitted_at','released_at','notes',
                'store_links','linked_issue_ids','checklist']
  const allowed = {}
  for (const c of cols) if (data[c] !== undefined) allowed[c] = data[c]
  allowed.created_by = userId || null; allowed.updated_by = userId || null
  const keys = Object.keys(allowed)
  const { rows } = await query(
    `INSERT INTO linear_mobile_releases (${keys.join(', ')})
     VALUES (${keys.map((_,i) => `$${i+1}`).join(', ')}) RETURNING *`,
    keys.map(k => allowed[k])
  )
  return parseRow(rows[0])
}

async function updateMobileRelease(id, data, userId) {
  const cols = ['name','platform','version_number','build_number','status',
                'target_date','submitted_at','released_at','notes',
                'store_links','linked_issue_ids','checklist']
  const fields = []; const vals = []; let i = 1
  for (const k of cols) {
    if (data[k] !== undefined) { fields.push(`${k} = $${i++}`); vals.push(data[k]) }
  }
  if (!fields.length) { const { rows } = await query('SELECT * FROM linear_mobile_releases WHERE id = $1', [id]); return parseRow(rows[0]) }
  fields.push(`updated_by = $${i++}`, `updated_at = NOW()`)
  vals.push(userId || null, id)
  const { rows } = await query(
    `UPDATE linear_mobile_releases SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals
  )
  return parseRow(rows[0]) || null
}

async function deleteMobileRelease(id) {
  await query('DELETE FROM linear_mobile_releases WHERE id = $1', [id])
}

// ── Deployments ───────────────────────────────────────────────────────────────

async function listDeployments() {
  const { rows } = await query('SELECT * FROM linear_deployments ORDER BY created_at DESC')
  return safe(rows)
}

async function createDeployment(data, userId) {
  const cols = ['name','deployment_type','environment','status','target_date',
                'started_at','deployed_at','verified_at','deployed_by','verified_by',
                'notes','rollback_notes','linked_issue_ids','checklist']
  const allowed = {}
  for (const c of cols) if (data[c] !== undefined) allowed[c] = data[c]
  allowed.created_by = userId || null; allowed.updated_by = userId || null
  const keys = Object.keys(allowed)
  const { rows } = await query(
    `INSERT INTO linear_deployments (${keys.join(', ')})
     VALUES (${keys.map((_,i) => `$${i+1}`).join(', ')}) RETURNING *`,
    keys.map(k => allowed[k])
  )
  return parseRow(rows[0])
}

async function updateDeployment(id, data, userId) {
  const cols = ['name','deployment_type','environment','status','target_date',
                'started_at','deployed_at','verified_at','deployed_by','verified_by',
                'notes','rollback_notes','linked_issue_ids','checklist']
  const fields = []; const vals = []; let i = 1
  for (const k of cols) {
    if (data[k] !== undefined) { fields.push(`${k} = $${i++}`); vals.push(data[k]) }
  }
  if (!fields.length) { const { rows } = await query('SELECT * FROM linear_deployments WHERE id = $1', [id]); return parseRow(rows[0]) }
  fields.push(`updated_by = $${i++}`, `updated_at = NOW()`)
  vals.push(userId || null, id)
  const { rows } = await query(
    `UPDATE linear_deployments SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals
  )
  return parseRow(rows[0]) || null
}

async function deleteDeployment(id) {
  await query('DELETE FROM linear_deployments WHERE id = $1', [id])
}

// ── Checklist Runs ────────────────────────────────────────────────────────────

async function listChecklistRuns({ context_type, context_id } = {}) {
  if (context_type && context_id) {
    const { rows } = await query(
      'SELECT * FROM linear_checklist_runs WHERE context_type = $1 AND context_id = $2 ORDER BY updated_at DESC',
      [context_type, context_id]
    )
    return safe(rows)
  }
  const { rows } = await query('SELECT * FROM linear_checklist_runs ORDER BY updated_at DESC')
  return safe(rows)
}

async function upsertChecklistRun(data, userId) {
  const { context_type, context_id, doc_id, doc_title, completed_items = {}, notes = '' } = data
  if (!context_type || !context_id) throw new Error('context_type and context_id are required')

  // Check if run exists for this context + doc
  const existing = await query(
    `SELECT id FROM linear_checklist_runs
     WHERE context_type = $1 AND context_id = $2
       AND COALESCE(doc_id, 0) = COALESCE($3, 0)`,
    [context_type, context_id, doc_id || null]
  )

  if (existing.rows.length > 0) {
    const { rows } = await query(
      `UPDATE linear_checklist_runs
       SET completed_items = $1, notes = $2, doc_title = $3, updated_by = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [completed_items, notes, doc_title || null, userId || null, existing.rows[0].id]
    )
    return parseRow(rows[0])
  }

  const { rows } = await query(
    `INSERT INTO linear_checklist_runs
       (context_type, context_id, doc_id, doc_title, completed_items, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     RETURNING *`,
    [context_type, context_id, doc_id || null, doc_title || null, completed_items, notes, userId || null]
  )
  return parseRow(rows[0])
}

async function deleteChecklistRun(id) {
  await query('DELETE FROM linear_checklist_runs WHERE id = $1', [id])
}

module.exports = {
  // Docs
  listDocs, getDoc, createDoc, updateDoc, deleteDoc,
  // Intake
  listIntake, createIntake, updateIntake, deleteIntake,
  // Mobile releases
  listMobileReleases, createMobileRelease, updateMobileRelease, deleteMobileRelease,
  // Deployments
  listDeployments, createDeployment, updateDeployment, deleteDeployment,
  // Checklist runs
  listChecklistRuns, upsertChecklistRun, deleteChecklistRun,
}

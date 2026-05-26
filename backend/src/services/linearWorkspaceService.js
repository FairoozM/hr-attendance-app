/**
 * linearWorkspaceService.js
 * CRUD for all linear_* shared workspace tables.
 */
const { query } = require('../db')
const { logLinearAudit } = require('./linearAuditService')

// ── Helpers ──────────────────────────────────────────────────────────────────

function safe(rows) { return rows || [] }

function parseRow(row) {
  if (!row) return null
  return { ...row }
}

function changedFields(before, after, fields = []) {
  const next = []
  for (const key of fields) {
    if (JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null)) {
      next.push(key)
    }
  }
  return next
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
  const doc = parseRow(rows[0])
  await logLinearAudit({
    entityType: 'doc',
    entityId: doc?.id,
    action: 'created',
    actorUserId: userId,
    summary: `Doc created: ${doc?.title || 'Untitled doc'}`,
    afterSnapshot: doc,
    metadata: {
      changedFields: ['title', 'category', 'tags', 'summary', 'content', 'related_project_id', 'related_labels'],
    },
  })
  return doc
}

async function updateDoc(id, data, userId) {
  const before = await getDoc(id)
  if (!before) return null
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
  const doc = parseRow(rows[0]) || null
  if (doc) {
    await logLinearAudit({
      entityType: 'doc',
      entityId: doc.id,
      action: 'updated',
      actorUserId: userId,
      summary: `Doc updated: ${doc.title || 'Untitled doc'}`,
      beforeSnapshot: before,
      afterSnapshot: doc,
      metadata: {
        changedFields: changedFields(before, doc, allowed),
      },
    })
  }
  return doc
}

async function deleteDoc(id, userId) {
  const before = await getDoc(id)
  await query('DELETE FROM linear_docs WHERE id = $1', [id])
  if (before) {
    await logLinearAudit({
      entityType: 'doc',
      entityId: before.id,
      action: 'deleted',
      actorUserId: userId,
      summary: `Doc deleted: ${before.title || 'Untitled doc'}`,
      beforeSnapshot: before,
    })
  }
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
  const item = parseRow(rows[0])
  await logLinearAudit({
    entityType: 'intake',
    entityId: item?.id,
    action: 'created',
    actorUserId: userId,
    summary: `Intake created: ${item?.title || 'Untitled item'}`,
    afterSnapshot: item,
    metadata: {
      changedFields: keys,
    },
  })
  return item
}

async function updateIntake(id, data, userId) {
  const beforeResult = await query('SELECT * FROM linear_intake_items WHERE id = $1', [id])
  const before = parseRow(beforeResult.rows[0])
  if (!before) return null
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
  const item = parseRow(rows[0]) || null
  if (item) {
    const delta = changedFields(before, item, cols)
    let action = 'updated'
    let summary = `Intake updated: ${item.title || 'Untitled item'}`
    if (before.linked_issue_id !== item.linked_issue_id && item.linked_issue_id != null) {
      action = 'linked'
      summary = `Intake linked to issue #${item.linked_issue_id}: ${item.title || 'Untitled item'}`
    } else if (
      before.status !== item.status &&
      ['dismissed', 'closed', 'canceled'].includes(String(item.status || '').toLowerCase())
    ) {
      action = 'dismissed'
      summary = `Intake dismissed: ${item.title || 'Untitled item'}`
    } else if (before.status !== item.status) {
      action = 'status_changed'
      summary = `Intake status changed to ${item.status || 'Updated'}: ${item.title || 'Untitled item'}`
    }

    await logLinearAudit({
      entityType: 'intake',
      entityId: item.id,
      action,
      actorUserId: userId,
      summary,
      beforeSnapshot: before,
      afterSnapshot: item,
      metadata: {
        changedFields: delta,
      },
    })
  }
  return item
}

async function deleteIntake(id, userId) {
  const { rows } = await query('SELECT * FROM linear_intake_items WHERE id = $1', [id])
  const before = parseRow(rows[0])
  await query('DELETE FROM linear_intake_items WHERE id = $1', [id])
  if (before) {
    await logLinearAudit({
      entityType: 'intake',
      entityId: before.id,
      action: 'deleted',
      actorUserId: userId,
      summary: `Intake deleted: ${before.title || 'Untitled item'}`,
      beforeSnapshot: before,
    })
  }
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
  const release = parseRow(rows[0])
  await logLinearAudit({
    entityType: 'mobile_release',
    entityId: release?.id,
    action: 'created',
    actorUserId: userId,
    summary: `Mobile release created: ${release?.name || 'Untitled release'}`,
    afterSnapshot: release,
    metadata: {
      changedFields: keys,
    },
  })
  return release
}

async function updateMobileRelease(id, data, userId) {
  const beforeResult = await query('SELECT * FROM linear_mobile_releases WHERE id = $1', [id])
  const before = parseRow(beforeResult.rows[0])
  if (!before) return null
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
  const release = parseRow(rows[0]) || null
  if (release) {
    const delta = changedFields(before, release, cols)
    const action = before.status !== release.status ? 'status_changed' : 'updated'
    const summary = before.status !== release.status
      ? `Mobile release status changed to ${release.status || 'Updated'}: ${release.name || 'Untitled release'}`
      : `Mobile release updated: ${release.name || 'Untitled release'}`
    await logLinearAudit({
      entityType: 'mobile_release',
      entityId: release.id,
      action,
      actorUserId: userId,
      summary,
      beforeSnapshot: before,
      afterSnapshot: release,
      metadata: {
        changedFields: delta,
      },
    })
  }
  return release
}

async function deleteMobileRelease(id, userId) {
  const { rows } = await query('SELECT * FROM linear_mobile_releases WHERE id = $1', [id])
  const before = parseRow(rows[0])
  await query('DELETE FROM linear_mobile_releases WHERE id = $1', [id])
  if (before) {
    await logLinearAudit({
      entityType: 'mobile_release',
      entityId: before.id,
      action: 'deleted',
      actorUserId: userId,
      summary: `Mobile release deleted: ${before.name || 'Untitled release'}`,
      beforeSnapshot: before,
    })
  }
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
  const deployment = parseRow(rows[0])
  await logLinearAudit({
    entityType: 'deployment',
    entityId: deployment?.id,
    action: 'created',
    actorUserId: userId,
    summary: `Deployment created: ${deployment?.name || 'Untitled deployment'}`,
    afterSnapshot: deployment,
    metadata: {
      changedFields: keys,
    },
  })
  return deployment
}

async function updateDeployment(id, data, userId) {
  const beforeResult = await query('SELECT * FROM linear_deployments WHERE id = $1', [id])
  const before = parseRow(beforeResult.rows[0])
  if (!before) return null
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
  const deployment = parseRow(rows[0]) || null
  if (deployment) {
    const delta = changedFields(before, deployment, cols)
    let action = 'updated'
    let summary = `Deployment updated: ${deployment.name || 'Untitled deployment'}`

    if (
      before.status !== deployment.status &&
      String(deployment.status || '').toLowerCase() === 'rolled back'
    ) {
      action = 'rolled_back'
      summary = `Deployment rolled back: ${deployment.name || 'Untitled deployment'}`
    } else if (
      before.verified_at !== deployment.verified_at &&
      deployment.verified_at
    ) {
      action = 'deployment_verified'
      summary = `Deployment verified: ${deployment.name || 'Untitled deployment'}`
    } else if (before.status !== deployment.status) {
      action = 'status_changed'
      summary = `Deployment status changed to ${deployment.status || 'Updated'}: ${deployment.name || 'Untitled deployment'}`
    }

    await logLinearAudit({
      entityType: 'deployment',
      entityId: deployment.id,
      action,
      actorUserId: userId,
      summary,
      beforeSnapshot: before,
      afterSnapshot: deployment,
      metadata: {
        changedFields: delta,
      },
    })
  }
  return deployment
}

async function deleteDeployment(id, userId) {
  const { rows } = await query('SELECT * FROM linear_deployments WHERE id = $1', [id])
  const before = parseRow(rows[0])
  await query('DELETE FROM linear_deployments WHERE id = $1', [id])
  if (before) {
    await logLinearAudit({
      entityType: 'deployment',
      entityId: before.id,
      action: 'deleted',
      actorUserId: userId,
      summary: `Deployment deleted: ${before.name || 'Untitled deployment'}`,
      beforeSnapshot: before,
    })
  }
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
    `SELECT * FROM linear_checklist_runs
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
    const run = parseRow(rows[0])
    const before = parseRow(existing.rows[0])
    await logLinearAudit({
      entityType: 'checklist_run',
      entityId: run?.id,
      action: 'checklist_updated',
      actorUserId: userId,
      summary: `Checklist updated for ${context_type} ${context_id}`,
      beforeSnapshot: before,
      afterSnapshot: run,
      metadata: {
        contextType: context_type,
        contextId: context_id,
        docId: doc_id || null,
        changedFields: changedFields(before, run, ['completed_items', 'notes', 'doc_title']),
      },
    })
    return run
  }

  const { rows } = await query(
    `INSERT INTO linear_checklist_runs
       (context_type, context_id, doc_id, doc_title, completed_items, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     RETURNING *`,
    [context_type, context_id, doc_id || null, doc_title || null, completed_items, notes, userId || null]
  )
  const run = parseRow(rows[0])
  await logLinearAudit({
    entityType: 'checklist_run',
    entityId: run?.id,
    action: 'created',
    actorUserId: userId,
    summary: `Checklist run created for ${context_type} ${context_id}`,
    afterSnapshot: run,
    metadata: {
      contextType: context_type,
      contextId: context_id,
      docId: doc_id || null,
    },
  })
  return run
}

async function deleteChecklistRun(id, userId) {
  const { rows } = await query('SELECT * FROM linear_checklist_runs WHERE id = $1', [id])
  const before = parseRow(rows[0])
  await query('DELETE FROM linear_checklist_runs WHERE id = $1', [id])
  if (before) {
    await logLinearAudit({
      entityType: 'checklist_run',
      entityId: before.id,
      action: 'reset',
      actorUserId: userId,
      summary: `Checklist reset for ${before.context_type} ${before.context_id}`,
      beforeSnapshot: before,
      metadata: {
        contextType: before.context_type,
        contextId: before.context_id,
        docId: before.doc_id || null,
      },
    })
  }
}

// ── Launch records ─────────────────────────────────────────────────────────────

async function listLaunchRecords() {
  const { rows } = await query('SELECT * FROM linear_launch_records ORDER BY created_at DESC, id DESC')
  return safe(rows).map(parseRow)
}

async function getLaunchRecord(id) {
  const { rows } = await query('SELECT * FROM linear_launch_records WHERE id = $1', [id])
  return parseRow(rows[0]) || null
}

async function createLaunchRecord(data, userId) {
  const cols = [
    'launch_name',
    'launch_type',
    'environment',
    'status',
    'linked_issue_ids',
    'linked_deployment_id',
    'linked_mobile_release_id',
    'readiness_snapshot',
    'health_snapshot',
    'smoke_snapshot',
    'checklist_snapshot',
    'qa_summary',
    'deployment_summary',
    'rollback_used',
    'incident_notes',
    'what_went_well',
    'what_went_wrong',
    'follow_up_actions',
    'reviewed_by',
    'reviewed_at',
  ]
  const allowed = {}
  for (const c of cols) if (data[c] !== undefined) allowed[c] = data[c]
  allowed.created_by = userId || null
  allowed.updated_by = userId || null
  const keys = Object.keys(allowed)

  const { rows } = await query(
    `INSERT INTO linear_launch_records (${keys.join(', ')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    keys.map((k) => allowed[k])
  )
  const record = parseRow(rows[0])
  await logLinearAudit({
    entityType: 'launch_record',
    entityId: record?.id,
    action: 'created',
    actorUserId: userId,
    summary: `Launch record created: ${record?.launch_name || 'Untitled launch'}`,
    afterSnapshot: record,
    metadata: {
      changedFields: keys,
    },
  })
  return record
}

async function updateLaunchRecord(id, data, userId) {
  const before = await getLaunchRecord(id)
  if (!before) return null

  const cols = [
    'launch_name',
    'launch_type',
    'environment',
    'status',
    'linked_issue_ids',
    'linked_deployment_id',
    'linked_mobile_release_id',
    'readiness_snapshot',
    'health_snapshot',
    'smoke_snapshot',
    'checklist_snapshot',
    'qa_summary',
    'deployment_summary',
    'rollback_used',
    'incident_notes',
    'what_went_well',
    'what_went_wrong',
    'follow_up_actions',
    'reviewed_by',
    'reviewed_at',
  ]
  const fields = []
  const vals = []
  let i = 1
  for (const k of cols) {
    if (data[k] !== undefined) {
      fields.push(`${k} = $${i++}`)
      vals.push(data[k])
    }
  }
  if (!fields.length) return getLaunchRecord(id)

  fields.push(`updated_by = $${i++}`, `updated_at = NOW()`)
  vals.push(userId || null, id)

  const { rows } = await query(
    `UPDATE linear_launch_records SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  )
  const record = parseRow(rows[0]) || null
  if (record) {
    const delta = changedFields(before, record, cols)
    const action = before.reviewed_at !== record.reviewed_at && record.reviewed_at ? 'reviewed' : 'updated'
    const summary = action === 'reviewed'
      ? `Launch record reviewed: ${record.launch_name || 'Untitled launch'}`
      : `Launch record updated: ${record.launch_name || 'Untitled launch'}`
    await logLinearAudit({
      entityType: 'launch_record',
      entityId: record.id,
      action,
      actorUserId: userId,
      summary,
      beforeSnapshot: before,
      afterSnapshot: record,
      metadata: {
        changedFields: delta,
      },
    })
  }
  return record
}

async function deleteLaunchRecord(id, userId) {
  const before = await getLaunchRecord(id)
  await query('DELETE FROM linear_launch_records WHERE id = $1', [id])
  if (before) {
    await logLinearAudit({
      entityType: 'launch_record',
      entityId: before.id,
      action: 'deleted',
      actorUserId: userId,
      summary: `Launch record deleted: ${before.launch_name || 'Untitled launch'}`,
      beforeSnapshot: before,
    })
  }
}

// ── Notification preferences ───────────────────────────────────────────────────

const NOTIFICATION_CATEGORY_DEFAULTS = {
  assignedToMe: true,
  comments: true,
  readyForRelease: true,
  qaApproved: true,
  releaseApproved: true,
  deploymentVerified: true,
  githubMerged: true,
  highPriority: true,
  overdue: true,
  intakeConverted: true,
  roleChanged: false,
}

const NOTIFICATION_PREFERENCE_DEFAULTS = {
  channel_in_app: true,
  channel_email: false,
  channel_whatsapp: false,
  email_address: null,
  whatsapp_number: null,
  digest_daily: false,
  digest_weekly: false,
  digest_release: false,
  daily_digest_time: '09:00',
  weekly_digest_day: 'Monday',
  categories: NOTIFICATION_CATEGORY_DEFAULTS,
}

const WEEKLY_DIGEST_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function normalizeText(value) {
  const text = String(value || '').trim()
  return text || null
}

function normalizeEmail(value) {
  const email = normalizeText(value)
  if (!email) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('Please enter a valid email address.')
    err.status = 400
    throw err
  }
  return email
}

function normalizeWhatsapp(value) {
  const phone = normalizeText(value)
  if (!phone) return null
  if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) {
    const err = new Error('Please enter a valid WhatsApp number.')
    err.status = 400
    throw err
  }
  return phone
}

function normalizeDailyDigestTime(value, fallback = NOTIFICATION_PREFERENCE_DEFAULTS.daily_digest_time) {
  const text = normalizeText(value) || fallback
  if (!/^\d{2}:\d{2}$/.test(text)) {
    const err = new Error('daily_digest_time must use HH:MM format.')
    err.status = 400
    throw err
  }
  const [hours, minutes] = text.split(':').map((part) => Number(part))
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    const err = new Error('daily_digest_time must be a valid 24-hour time.')
    err.status = 400
    throw err
  }
  return text
}

function normalizeWeeklyDigestDay(value, fallback = NOTIFICATION_PREFERENCE_DEFAULTS.weekly_digest_day) {
  const day = normalizeText(value) || fallback
  const match = WEEKLY_DIGEST_DAYS.find((candidate) => candidate.toLowerCase() === day.toLowerCase())
  if (!match) {
    const err = new Error('weekly_digest_day must be a valid weekday.')
    err.status = 400
    throw err
  }
  return match
}

function normalizeCategories(input, fallback = NOTIFICATION_CATEGORY_DEFAULTS) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const base = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
    ? fallback
    : NOTIFICATION_CATEGORY_DEFAULTS

  return Object.fromEntries(
    Object.keys(NOTIFICATION_CATEGORY_DEFAULTS).map((key) => [
      key,
      source[key] === undefined ? Boolean(base[key]) : Boolean(source[key]),
    ])
  )
}

async function ensurePreferencesUserExists(userId) {
  const { rows } = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [userId])
  if (!rows[0]) {
    const err = new Error('User not found')
    err.status = 404
    throw err
  }
}

function parseNotificationPreferences(row) {
  if (!row) return null
  return {
    ...parseRow(row),
    categories: normalizeCategories(row.categories, NOTIFICATION_CATEGORY_DEFAULTS),
  }
}

async function getNotificationPreferences(userId) {
  await ensurePreferencesUserExists(userId)
  const { rows } = await query(
    `INSERT INTO linear_notification_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId]
  )
  return parseNotificationPreferences(rows[0])
}

async function updateNotificationPreferences(userId, data = {}) {
  const current = await getNotificationPreferences(userId)
  const next = {
    channel_in_app: data.channel_in_app === undefined ? Boolean(current.channel_in_app) : Boolean(data.channel_in_app),
    channel_email: data.channel_email === undefined ? Boolean(current.channel_email) : Boolean(data.channel_email),
    channel_whatsapp: data.channel_whatsapp === undefined ? Boolean(current.channel_whatsapp) : Boolean(data.channel_whatsapp),
    email_address: data.email_address === undefined ? current.email_address : normalizeEmail(data.email_address),
    whatsapp_number: data.whatsapp_number === undefined ? current.whatsapp_number : normalizeWhatsapp(data.whatsapp_number),
    digest_daily: data.digest_daily === undefined ? Boolean(current.digest_daily) : Boolean(data.digest_daily),
    digest_weekly: data.digest_weekly === undefined ? Boolean(current.digest_weekly) : Boolean(data.digest_weekly),
    digest_release: data.digest_release === undefined ? Boolean(current.digest_release) : Boolean(data.digest_release),
    daily_digest_time: data.daily_digest_time === undefined
      ? normalizeDailyDigestTime(current.daily_digest_time)
      : normalizeDailyDigestTime(data.daily_digest_time),
    weekly_digest_day: data.weekly_digest_day === undefined
      ? normalizeWeeklyDigestDay(current.weekly_digest_day)
      : normalizeWeeklyDigestDay(data.weekly_digest_day),
    categories: normalizeCategories(data.categories, current.categories),
  }

  const { rows } = await query(
    `UPDATE linear_notification_preferences
        SET channel_in_app = $2,
            channel_email = $3,
            channel_whatsapp = $4,
            email_address = $5,
            whatsapp_number = $6,
            digest_daily = $7,
            digest_weekly = $8,
            digest_release = $9,
            daily_digest_time = $10,
            weekly_digest_day = $11,
            categories = $12::jsonb,
            updated_at = NOW()
      WHERE user_id = $1
      RETURNING *`,
    [
      userId,
      next.channel_in_app,
      next.channel_email,
      next.channel_whatsapp,
      next.email_address,
      next.whatsapp_number,
      next.digest_daily,
      next.digest_weekly,
      next.digest_release,
      next.daily_digest_time,
      next.weekly_digest_day,
      JSON.stringify(next.categories),
    ]
  )

  return parseNotificationPreferences(rows[0]) || current
}

// ── Digest outbox ──────────────────────────────────────────────────────────────

const DIGEST_OUTBOX_TYPES = ['daily', 'weekly', 'release', 'management', 'my_work', 'custom']
const DIGEST_OUTBOX_STATUSES = ['draft', 'copied', 'archived']
const DIGEST_OUTBOX_CHANNELS = ['manual', 'whatsapp', 'email']

const DIGEST_OUTBOX_SELECT = `
  SELECT
    o.*,
    COALESCE(NULLIF(TRIM(ce.full_name), ''), NULLIF(TRIM(cu.username), ''), CONCAT('User #', o.created_by)) AS created_by_name,
    COALESCE(NULLIF(TRIM(ue.full_name), ''), NULLIF(TRIM(uu.username), ''), CONCAT('User #', o.updated_by)) AS updated_by_name
  FROM linear_digest_outbox o
  LEFT JOIN users cu ON cu.id = o.created_by
  LEFT JOIN employees ce ON ce.id = cu.employee_id
  LEFT JOIN users uu ON uu.id = o.updated_by
  LEFT JOIN employees ue ON ue.id = uu.employee_id
`

function normalizeEnumValue(value, allowed, fieldName, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized && fallback != null) return fallback
  if (allowed.includes(normalized)) return normalized
  const err = new Error(`${fieldName} must be one of ${allowed.join(', ')}`)
  err.status = 400
  throw err
}

function normalizeDigestTitle(value) {
  const title = String(value || '').trim()
  if (!title) {
    const err = new Error('title is required')
    err.status = 400
    throw err
  }
  return title.slice(0, 220)
}

function normalizeDigestContent(value) {
  const content = String(value || '').trim()
  if (!content) {
    const err = new Error('content is required')
    err.status = 400
    throw err
  }
  return content
}

function parseDigestOutboxRow(row) {
  if (!row) return null
  return parseRow(row)
}

async function getDigestOutboxById(id) {
  const { rows } = await query(`${DIGEST_OUTBOX_SELECT} WHERE o.id = $1 LIMIT 1`, [id])
  return parseDigestOutboxRow(rows[0]) || null
}

async function listDigestOutbox({ viewerUserId, includeAll = false } = {}) {
  const params = []
  const where = []
  if (!includeAll) {
    params.push(viewerUserId)
    where.push(`o.created_by = $${params.length}`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const { rows } = await query(
    `${DIGEST_OUTBOX_SELECT}
     ${whereSql}
     ORDER BY o.updated_at DESC, o.id DESC`,
    params
  )
  return safe(rows).map(parseDigestOutboxRow)
}

async function createDigestOutbox(data, userId) {
  const digestType = normalizeEnumValue(data.digest_type, DIGEST_OUTBOX_TYPES, 'digest_type')
  const title = normalizeDigestTitle(data.title)
  const content = normalizeDigestContent(data.content)
  const status = data.status === undefined
    ? 'draft'
    : normalizeEnumValue(data.status, DIGEST_OUTBOX_STATUSES, 'status')
  const targetChannel = data.target_channel === undefined
    ? 'manual'
    : normalizeEnumValue(data.target_channel, DIGEST_OUTBOX_CHANNELS, 'target_channel')

  const { rows } = await query(
    `INSERT INTO linear_digest_outbox
       (digest_type, title, content, status, target_channel, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING *`,
    [digestType, title, content, status, targetChannel, userId || null]
  )

  const draft = await getDigestOutboxById(rows[0]?.id)
  await logLinearAudit({
    entityType: 'digest_outbox',
    entityId: draft?.id,
    action: 'digest_draft_created',
    actorUserId: userId,
    summary: `Digest draft created: ${draft?.title || 'Untitled digest'}`,
    afterSnapshot: draft,
    metadata: {
      digestType,
      targetChannel,
      status,
    },
  })
  return draft
}

async function updateDigestOutbox(id, data, userId) {
  const before = await getDigestOutboxById(id)
  if (!before) return null

  const nextValues = {
    digest_type: data.digest_type === undefined
      ? before.digest_type
      : normalizeEnumValue(data.digest_type, DIGEST_OUTBOX_TYPES, 'digest_type'),
    title: data.title === undefined ? before.title : normalizeDigestTitle(data.title),
    content: data.content === undefined ? before.content : normalizeDigestContent(data.content),
    status: data.status === undefined
      ? before.status
      : normalizeEnumValue(data.status, DIGEST_OUTBOX_STATUSES, 'status'),
    target_channel: data.target_channel === undefined
      ? before.target_channel
      : normalizeEnumValue(data.target_channel, DIGEST_OUTBOX_CHANNELS, 'target_channel'),
  }

  const { rows } = await query(
    `UPDATE linear_digest_outbox
        SET digest_type = $2,
            title = $3,
            content = $4,
            status = $5,
            target_channel = $6,
            updated_by = $7,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, nextValues.digest_type, nextValues.title, nextValues.content, nextValues.status, nextValues.target_channel, userId || null]
  )

  const draft = await getDigestOutboxById(rows[0]?.id || id)
  const changed = changedFields(before, draft, ['digest_type', 'title', 'content', 'status', 'target_channel'])

  let action = 'digest_updated'
  let summary = `Digest draft updated: ${draft?.title || before.title || 'Untitled digest'}`
  if (before.status !== draft?.status && draft?.status === 'copied') {
    action = 'digest_copied'
    summary = `Digest copied: ${draft?.title || before.title || 'Untitled digest'}`
  } else if (before.status !== draft?.status && draft?.status === 'archived') {
    action = 'digest_archived'
    summary = `Digest archived: ${draft?.title || before.title || 'Untitled digest'}`
  }

  await logLinearAudit({
    entityType: 'digest_outbox',
    entityId: draft?.id || id,
    action,
    actorUserId: userId,
    summary,
    beforeSnapshot: before,
    afterSnapshot: draft,
    metadata: {
      changedFields: changed,
      digestType: draft?.digest_type || before.digest_type,
      targetChannel: draft?.target_channel || before.target_channel,
      status: draft?.status || before.status,
    },
  })

  return draft
}

async function deleteDigestOutbox(id, userId) {
  const before = await getDigestOutboxById(id)
  if (!before) return false
  await query('DELETE FROM linear_digest_outbox WHERE id = $1', [id])
  await logLinearAudit({
    entityType: 'digest_outbox',
    entityId: before.id,
    action: 'digest_deleted',
    actorUserId: userId,
    summary: `Digest deleted: ${before.title || 'Untitled digest'}`,
    beforeSnapshot: before,
    metadata: {
      digestType: before.digest_type,
      targetChannel: before.target_channel,
      status: before.status,
    },
  })
  return true
}

// ── Global workspace search ───────────────────────────────────────────────────

const SEARCH_TYPES = ['all', 'issues', 'docs', 'intake', 'releases', 'deployments', 'audit']

function normalizeSearchType(value) {
  const type = String(value || 'all').trim().toLowerCase()
  return SEARCH_TYPES.includes(type) ? type : 'all'
}

function normalizeSearchLimit(value) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return 20
  return Math.min(Math.max(n, 1), 20)
}

function toILikePattern(value) {
  const escaped = String(value || '').replace(/[\\%_]/g, '\\$&')
  return `%${escaped}%`
}

function collapseText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncateText(value, limit = 220) {
  const text = collapseText(value)
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

function inferProjectPrefix(name) {
  const projectName = String(name || '').toLowerCase()
  if (projectName.includes('android')) return 'AND'
  if (projectName.includes('ios') || projectName.includes('iphone')) return 'IOS'
  if (projectName.includes('ux') || projectName.includes('ui') || projectName.includes('design')) return 'UX'
  if (projectName.includes('backend') || projectName.includes('api') || projectName.includes('server')) return 'API'
  if (projectName.includes('data') || projectName.includes('bi') || projectName.includes('analytics')) return 'BI'
  if (projectName.includes('payment') || projectName.includes('checkout')) return 'PAY'
  return 'WEB'
}

function bestSnippet(values, query) {
  const q = String(query || '').trim().toLowerCase()
  const candidates = values.map((value) => collapseText(value)).filter(Boolean)
  if (!candidates.length) return ''
  if (!q) return truncateText(candidates[0])
  const exact = candidates.find((value) => value.toLowerCase().includes(q))
  return truncateText(exact || candidates[0])
}

function scoreText(value, query, weight = 20) {
  const text = collapseText(value).toLowerCase()
  const q = String(query || '').trim().toLowerCase()
  if (!text || !q) return 0
  if (text === q) return weight * 4
  if (text.startsWith(q)) return weight * 3
  if (text.includes(q)) return weight * 2
  return 0
}

function scoreCombined(values, query, weights = []) {
  return values.reduce((sum, value, index) => sum + scoreText(value, query, weights[index] || 10), 0)
}

function encodeHashQuery(path, params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    query.set(key, String(value))
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return `#${path}${suffix}`
}

function normalizeSearchResult(result) {
  return {
    type: result.type,
    id: result.id,
    title: result.title,
    subtitle: result.subtitle || '',
    snippet: truncateText(result.snippet || '', 720),
    url: result.url,
    meta: result.meta || {},
    score: result.score || 0,
  }
}

async function searchIssues(queryText, limit) {
  const like = toILikePattern(queryText)
  const numericId = Number.parseInt(queryText, 10)
  const params = [like, Number.isFinite(numericId) ? numericId : null, limit]
  const prefixSql = `
    CASE
      WHEN lower(p.name) LIKE '%android%' THEN 'AND'
      WHEN lower(p.name) LIKE '%ios%' OR lower(p.name) LIKE '%iphone%' THEN 'IOS'
      WHEN lower(p.name) LIKE '%ux%' OR lower(p.name) LIKE '%ui%' OR lower(p.name) LIKE '%design%' THEN 'UX'
      WHEN lower(p.name) LIKE '%backend%' OR lower(p.name) LIKE '%api%' OR lower(p.name) LIKE '%server%' THEN 'API'
      WHEN lower(p.name) LIKE '%data%' OR lower(p.name) LIKE '%bi%' OR lower(p.name) LIKE '%analytics%' THEN 'BI'
      WHEN lower(p.name) LIKE '%payment%' OR lower(p.name) LIKE '%checkout%' THEN 'PAY'
      ELSE 'WEB'
    END
  `

  const { rows } = await query(
    `SELECT
       t.id,
       t.project_id,
       p.name AS project_name,
       t.title,
       t.description,
       t.status,
       t.priority,
       t.labels,
       t.dev_meta,
       t.created_at,
       t.updated_at,
       ${prefixSql} AS project_prefix
     FROM project_tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE (
       t.title ILIKE $1 ESCAPE '\\'
       OR COALESCE(t.description, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(p.name, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(t.status, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(t.priority, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(array_to_string(t.labels, ' '), '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(t.dev_meta->>'branchName', '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(t.dev_meta->>'prUrl', '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(t.dev_meta->>'prTitle', '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(t.dev_meta->>'repo', '') ILIKE $1 ESCAPE '\\'
       OR ($2::int IS NOT NULL AND t.id = $2::int)
       OR (${prefixSql} || '-' || t.id::text) ILIKE $1 ESCAPE '\\'
     )
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT $3`,
    params
  )

  return safe(rows).map((row) => {
    const issueKey = `${row.project_prefix || inferProjectPrefix(row.project_name)}-${row.id}`
    const devMeta = row.dev_meta && typeof row.dev_meta === 'object' ? row.dev_meta : {}
    return normalizeSearchResult({
      type: 'issue',
      id: row.id,
      title: issueKey,
      subtitle: `${row.title || 'Untitled issue'}${row.project_name ? ` • ${row.project_name}` : ''}`,
      snippet: bestSnippet([
        row.description,
        devMeta.prTitle,
        devMeta.prUrl,
        devMeta.repo,
        devMeta.branchName,
        Array.isArray(row.labels) ? row.labels.join(', ') : '',
      ], queryText),
      url: encodeHashQuery('/projects/linear', { issueId: row.id, projectId: row.project_id }),
      meta: {
        issueKey,
        issueTitle: row.title || 'Untitled issue',
        status: row.status || null,
        priority: row.priority || null,
        project: row.project_name || null,
        labels: Array.isArray(row.labels) ? row.labels.slice(0, 4) : [],
        branchName: devMeta.branchName || null,
        prUrl: devMeta.prUrl || null,
        prTitle: devMeta.prTitle || null,
        repo: devMeta.repo || null,
        updatedAt: row.updated_at || row.created_at || null,
      },
      score: scoreCombined([
        issueKey,
        row.title,
        row.description,
        row.project_name,
        row.status,
        row.priority,
        Array.isArray(row.labels) ? row.labels.join(' ') : '',
        devMeta.branchName,
        devMeta.prUrl,
        devMeta.prTitle,
        devMeta.repo,
      ], queryText, [40, 36, 14, 16, 12, 12, 10, 16, 18, 18, 18]),
    })
  })
}

async function searchDocs(queryText, limit) {
  const like = toILikePattern(queryText)
  const { rows } = await query(
    `SELECT id, title, summary, content, tags, category, created_at, updated_at
     FROM linear_docs
     WHERE (
       title ILIKE $1 ESCAPE '\\'
       OR COALESCE(summary, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(content, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(array_to_string(tags, ' '), '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(category, '') ILIKE $1 ESCAPE '\\'
     )
     ORDER BY updated_at DESC, id DESC
     LIMIT $2`,
    [like, limit]
  )

  return safe(rows).map((row) => normalizeSearchResult({
    type: 'doc',
    id: row.id,
    title: row.title || `Doc #${row.id}`,
    subtitle: row.category || 'Doc',
    snippet: bestSnippet([row.summary, row.content, Array.isArray(row.tags) ? row.tags.join(', ') : ''], queryText),
    url: '#/projects/linear/docs',
    meta: {
      category: row.category || null,
      tags: Array.isArray(row.tags) ? row.tags.slice(0, 4) : [],
      summary: row.summary || null,
      updatedAt: row.updated_at || row.created_at || null,
    },
    score: scoreCombined([
      row.title,
      row.summary,
      row.category,
      Array.isArray(row.tags) ? row.tags.join(' ') : '',
      row.content,
    ], queryText, [40, 22, 18, 18, 10]),
  }))
}

async function searchIntake(queryText, limit) {
  const like = toILikePattern(queryText)
  const { rows } = await query(
    `SELECT
       id,
       title,
       description,
       source,
       type,
       platform,
       customer_reference,
       url_or_screen,
       labels,
       created_at,
       updated_at
     FROM linear_intake_items
     WHERE (
       title ILIKE $1 ESCAPE '\\'
       OR COALESCE(description, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(source, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(type, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(platform, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(customer_reference, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(url_or_screen, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(array_to_string(labels, ' '), '') ILIKE $1 ESCAPE '\\'
     )
     ORDER BY updated_at DESC, id DESC
     LIMIT $2`,
    [like, limit]
  )

  return safe(rows).map((row) => normalizeSearchResult({
    type: 'intake',
    id: row.id,
    title: row.title || `Intake #${row.id}`,
    subtitle: [row.type, row.platform, row.source].filter(Boolean).join(' • ') || 'Intake item',
    snippet: bestSnippet([
      row.description,
      row.customer_reference,
      row.url_or_screen,
      Array.isArray(row.labels) ? row.labels.join(', ') : '',
    ], queryText),
    url: encodeHashQuery('/projects/linear/intake', { q: row.title || row.customer_reference || row.id, type: 'intake' }),
    meta: {
      source: row.source || null,
      platform: row.platform || null,
      customerReference: row.customer_reference || null,
      labels: Array.isArray(row.labels) ? row.labels.slice(0, 4) : [],
      updatedAt: row.updated_at || row.created_at || null,
    },
    score: scoreCombined([
      row.title,
      row.description,
      row.source,
      row.type,
      row.platform,
      row.customer_reference,
      row.url_or_screen,
      Array.isArray(row.labels) ? row.labels.join(' ') : '',
    ], queryText, [40, 18, 16, 16, 16, 18, 16, 12]),
  }))
}

async function searchMobileReleases(queryText, limit) {
  const like = toILikePattern(queryText)
  const { rows } = await query(
    `SELECT
       id,
       name,
       version_number,
       build_number,
       notes,
       linked_issue_ids,
       created_at,
       updated_at
     FROM linear_mobile_releases
     WHERE (
       name ILIKE $1 ESCAPE '\\'
       OR COALESCE(version_number, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(build_number, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(notes, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(array_to_string(linked_issue_ids, ' '), '') ILIKE $1 ESCAPE '\\'
     )
     ORDER BY updated_at DESC, id DESC
     LIMIT $2`,
    [like, limit]
  )

  return safe(rows).map((row) => normalizeSearchResult({
    type: 'mobile_release',
    id: row.id,
    title: row.name || `Release #${row.id}`,
    subtitle: [row.version_number, row.build_number].filter(Boolean).join(' • ') || 'Mobile release',
    snippet: bestSnippet([row.notes, Array.isArray(row.linked_issue_ids) ? row.linked_issue_ids.join(', ') : ''], queryText),
    url: '#/projects/linear/releases',
    meta: {
      version: row.version_number || null,
      build: row.build_number || null,
      linkedIssueIds: Array.isArray(row.linked_issue_ids) ? row.linked_issue_ids.slice(0, 5) : [],
      updatedAt: row.updated_at || row.created_at || null,
    },
    score: scoreCombined([
      row.name,
      row.version_number,
      row.build_number,
      row.notes,
      Array.isArray(row.linked_issue_ids) ? row.linked_issue_ids.join(' ') : '',
    ], queryText, [40, 22, 22, 14, 12]),
  }))
}

async function searchDeployments(queryText, limit) {
  const like = toILikePattern(queryText)
  const { rows } = await query(
    `SELECT
       id,
       name,
       notes,
       rollback_notes,
       environment,
       deployment_type,
       created_at,
       updated_at
     FROM linear_deployments
     WHERE (
       name ILIKE $1 ESCAPE '\\'
       OR COALESCE(notes, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(rollback_notes, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(environment, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(deployment_type, '') ILIKE $1 ESCAPE '\\'
     )
     ORDER BY updated_at DESC, id DESC
     LIMIT $2`,
    [like, limit]
  )

  return safe(rows).map((row) => normalizeSearchResult({
    type: 'deployment',
    id: row.id,
    title: row.name || `Deployment #${row.id}`,
    subtitle: [row.environment, row.deployment_type].filter(Boolean).join(' • ') || 'Deployment',
    snippet: bestSnippet([row.notes, row.rollback_notes], queryText),
    url: '#/projects/linear/releases',
    meta: {
      environment: row.environment || null,
      deploymentType: row.deployment_type || null,
      updatedAt: row.updated_at || row.created_at || null,
    },
    score: scoreCombined([
      row.name,
      row.environment,
      row.deployment_type,
      row.notes,
      row.rollback_notes,
    ], queryText, [40, 18, 18, 16, 14]),
  }))
}

async function searchAudit(queryText, limit) {
  const like = toILikePattern(queryText)
  const { rows } = await query(
    `SELECT id, summary, entity_type, action, actor_name, created_at
     FROM linear_audit_log
     WHERE (
       summary ILIKE $1 ESCAPE '\\'
       OR COALESCE(entity_type, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(action, '') ILIKE $1 ESCAPE '\\'
       OR COALESCE(actor_name, '') ILIKE $1 ESCAPE '\\'
     )
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [like, limit]
  )

  return safe(rows).map((row) => normalizeSearchResult({
    type: 'audit',
    id: row.id,
    title: row.summary || `${row.entity_type || 'Audit'} ${row.action || ''}`.trim(),
    subtitle: [row.actor_name, row.entity_type, row.action].filter(Boolean).join(' • ') || 'Audit entry',
    snippet: row.summary || '',
    url: encodeHashQuery('/projects/linear/audit', { search: queryText }),
    meta: {
      actor: row.actor_name || null,
      entityType: row.entity_type || null,
      action: row.action || null,
      createdAt: row.created_at || null,
    },
    score: scoreCombined([
      row.summary,
      row.actor_name,
      row.entity_type,
      row.action,
    ], queryText, [34, 18, 14, 14]),
  }))
}

async function searchLinearWorkspace({ q, type = 'all', limit = 20, includeAudit = false } = {}) {
  const queryText = collapseText(q)
  if (queryText.length < 2) return { results: [] }

  const normalizedType = normalizeSearchType(type)
  const safeLimit = normalizeSearchLimit(limit)
  const perTypeLimit = Math.min(Math.max(safeLimit, 6), 20)

  const jobs = []
  if (normalizedType === 'all' || normalizedType === 'issues') jobs.push(searchIssues(queryText, perTypeLimit))
  if (normalizedType === 'all' || normalizedType === 'docs') jobs.push(searchDocs(queryText, perTypeLimit))
  if (normalizedType === 'all' || normalizedType === 'intake') jobs.push(searchIntake(queryText, perTypeLimit))
  if (normalizedType === 'all' || normalizedType === 'releases') jobs.push(searchMobileReleases(queryText, perTypeLimit))
  if (normalizedType === 'all' || normalizedType === 'deployments') jobs.push(searchDeployments(queryText, perTypeLimit))
  if (includeAudit && (normalizedType === 'all' || normalizedType === 'audit')) jobs.push(searchAudit(queryText, perTypeLimit))

  const groups = await Promise.all(jobs)
  const results = groups
    .flat()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const aTime = a.meta?.updatedAt || a.meta?.createdAt || null
      const bTime = b.meta?.updatedAt || b.meta?.createdAt || null
      return new Date(bTime || 0).getTime() - new Date(aTime || 0).getTime()
    })
    .slice(0, safeLimit)

  return { results }
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
  // Launch records
  listLaunchRecords, getLaunchRecord, createLaunchRecord, updateLaunchRecord, deleteLaunchRecord,
  // Notification preferences
  getNotificationPreferences, updateNotificationPreferences,
  // Digest outbox
  listDigestOutbox, getDigestOutboxById, createDigestOutbox, updateDigestOutbox, deleteDigestOutbox,
  // Global search
  searchLinearWorkspace,
}

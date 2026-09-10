const { query } = require('../../db')
const notificationActionsService = require('../notificationActionsService')

const SOURCE_TYPE = 'iso_qms'

/**
 * Idempotent insert into iso_notification_dedupe.
 * Returns true if this is a newly recorded key (should notify), false if duplicate.
 */
async function claimDedupeKey(dedupeKey, notificationType, entityType = null, entityId = null, payload = null) {
  const key = String(dedupeKey || '').trim().slice(0, 512)
  if (!key) return false
  try {
    await query(
      `INSERT INTO iso_notification_dedupe (dedupe_key, notification_type, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        key,
        String(notificationType).slice(0, 128),
        entityType,
        entityId != null ? Number(entityId) : null,
        payload != null ? JSON.stringify(payload) : null,
      ]
    )
    return true
  } catch (err) {
    if (err && err.code === '23505') return false
    throw err
  }
}

function buildKey(parts) {
  return parts.filter((p) => p != null && p !== '').join(':')
}

/**
 * Scan ISO QMS entities and produce notification candidates (idempotent via dedupe table).
 * Integrates with notification_actions pattern used by document expiry.
 */
async function collectIsoNotifications({ today = notificationActionsService.todayIso() } = {}) {
  const notifications = []

  // Document review due
  {
    const res = await query(
      `SELECT id, title, document_code, review_date
       FROM iso_documents
       WHERE soft_deleted_at IS NULL
         AND review_date IS NOT NULL
         AND review_date <= $1::date
         AND status IN ('Approved','Current')`,
      [today]
    )
    for (const row of res.rows) {
      const key = buildKey(['iso_review', row.id, toIso(row.review_date)])
      if (!(await claimDedupeKey(key, 'document_review', 'iso_document', row.id))) continue
      notifications.push({
        notification_key: key,
        type: 'iso_document_review',
        title: row.title,
        message: `Document review due (${row.document_code || row.id})`,
        source_type: SOURCE_TYPE,
        source_id: String(row.id),
        due_date: toIso(row.review_date),
      })
    }
  }

  // Document expiry
  {
    const res = await query(
      `SELECT id, title, document_code, expiry_date
       FROM iso_documents
       WHERE soft_deleted_at IS NULL
         AND expiry_date IS NOT NULL
         AND expiry_date <= $1::date + INTERVAL '30 days'
         AND status IN ('Approved','Current','Draft','Under Review')`,
      [today]
    )
    for (const row of res.rows) {
      const key = buildKey(['iso_expiry', row.id, toIso(row.expiry_date)])
      if (!(await claimDedupeKey(key, 'document_expiry', 'iso_document', row.id))) continue
      notifications.push({
        notification_key: key,
        type: 'iso_document_expiry',
        title: row.title,
        message: `Document expiry approaching (${row.document_code || row.id})`,
        source_type: SOURCE_TYPE,
        source_id: String(row.id),
        due_date: toIso(row.expiry_date),
      })
    }
  }

  // Under review awaiting approval
  {
    const res = await query(
      `SELECT id, title, document_code, updated_at
       FROM iso_documents
       WHERE soft_deleted_at IS NULL AND status = 'Under Review'`
    )
    for (const row of res.rows) {
      const day = row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 10) : today
      const key = buildKey(['iso_approval', row.id, day])
      if (!(await claimDedupeKey(key, 'approval_pending', 'iso_document', row.id))) continue
      notifications.push({
        notification_key: key,
        type: 'iso_approval_pending',
        title: row.title,
        message: `Awaiting approval (${row.document_code || row.id})`,
        source_type: SOURCE_TYPE,
        source_id: String(row.id),
        due_date: day,
      })
    }
  }

  // Calibration due
  {
    const res = await query(
      `SELECT c.id, c.next_due_date, e.name AS equipment_name
       FROM iso_calibrations c
       LEFT JOIN iso_equipment e ON e.id = c.equipment_id
       WHERE c.next_due_date IS NOT NULL
         AND c.next_due_date <= $1::date + INTERVAL '30 days'
         AND c.status <> 'Completed'`,
      [today]
    )
    for (const row of res.rows) {
      const key = buildKey(['iso_calibration', row.id, toIso(row.next_due_date)])
      if (!(await claimDedupeKey(key, 'calibration_due', 'iso_calibration', row.id))) continue
      notifications.push({
        notification_key: key,
        type: 'iso_calibration_due',
        title: row.equipment_name || `Calibration #${row.id}`,
        message: 'Calibration due',
        source_type: SOURCE_TYPE,
        source_id: String(row.id),
        due_date: toIso(row.next_due_date),
      })
    }
  }

  // Upcoming audits
  {
    const res = await query(
      `SELECT id, audit_reference, planned_date, status
       FROM iso_audits
       WHERE planned_date IS NOT NULL
         AND planned_date <= $1::date + INTERVAL '30 days'
         AND status IN ('Draft','Planned','In Progress')`,
      [today]
    )
    for (const row of res.rows) {
      const key = buildKey(['iso_audit', row.id, toIso(row.planned_date)])
      if (!(await claimDedupeKey(key, 'audit_upcoming', 'iso_audit', row.id))) continue
      notifications.push({
        notification_key: key,
        type: 'iso_audit_upcoming',
        title: row.audit_reference || `Audit #${row.id}`,
        message: 'Upcoming audit',
        source_type: SOURCE_TYPE,
        source_id: String(row.id),
        due_date: toIso(row.planned_date),
      })
    }
  }

  // Overdue CAs
  {
    const res = await query(
      `SELECT id, ca_number, due_date, description
       FROM iso_corrective_actions
       WHERE due_date IS NOT NULL
         AND due_date < $1::date
         AND status NOT IN ('Closed','Cancelled')`,
      [today]
    )
    for (const row of res.rows) {
      const key = buildKey(['iso_ca_overdue', row.id, toIso(row.due_date)])
      if (!(await claimDedupeKey(key, 'ca_overdue', 'iso_corrective_action', row.id))) continue
      notifications.push({
        notification_key: key,
        type: 'iso_ca_overdue',
        title: row.ca_number || `CA #${row.id}`,
        message: 'Corrective action overdue',
        source_type: SOURCE_TYPE,
        source_id: String(row.id),
        due_date: toIso(row.due_date),
      })
    }
  }

  // Open risks past due
  {
    const res = await query(
      `SELECT id, risk_number, due_date, description
       FROM iso_risks
       WHERE due_date IS NOT NULL AND due_date < $1::date AND status = 'Open'`,
      [today]
    )
    for (const row of res.rows) {
      const key = buildKey(['iso_risk', row.id, toIso(row.due_date)])
      if (!(await claimDedupeKey(key, 'risk_due', 'iso_risk', row.id))) continue
      notifications.push({
        notification_key: key,
        type: 'iso_risk_due',
        title: row.risk_number || `Risk #${row.id}`,
        message: 'Risk action overdue',
        source_type: SOURCE_TYPE,
        source_id: String(row.id),
        due_date: toIso(row.due_date),
      })
    }
  }

  // MRM upcoming
  {
    const res = await query(
      `SELECT id, reference, next_review_date
       FROM iso_management_reviews
       WHERE next_review_date IS NOT NULL
         AND next_review_date <= $1::date + INTERVAL '30 days'`,
      [today]
    )
    for (const row of res.rows) {
      const key = buildKey(['iso_mrm', row.id, toIso(row.next_review_date)])
      if (!(await claimDedupeKey(key, 'mrm_upcoming', 'iso_management_review', row.id))) continue
      notifications.push({
        notification_key: key,
        type: 'iso_mrm_upcoming',
        title: row.reference || `MRM #${row.id}`,
        message: 'Management review upcoming',
        source_type: SOURCE_TYPE,
        source_id: String(row.id),
        due_date: toIso(row.next_review_date),
      })
    }
  }

  // External certs
  {
    const res = await query(
      `SELECT id, title, expiry_date
       FROM iso_external_certificates
       WHERE expiry_date IS NOT NULL
         AND expiry_date <= $1::date + INTERVAL '30 days'`,
      [today]
    )
    for (const row of res.rows) {
      const key = buildKey(['iso_cert', row.id, toIso(row.expiry_date)])
      if (!(await claimDedupeKey(key, 'certificate_expiry', 'iso_external_certificate', row.id))) continue
      notifications.push({
        notification_key: key,
        type: 'iso_certificate_expiry',
        title: row.title,
        message: 'External certificate expiring',
        source_type: SOURCE_TYPE,
        source_id: String(row.id),
        due_date: toIso(row.expiry_date),
      })
    }
  }

  return notifications
}

function toIso(v) {
  if (!v) return null
  return String(v).slice(0, 10)
}

async function listDueNotifications() {
  const candidates = await collectIsoNotifications()
  const keys = candidates.map((n) => n.notification_key)
  const actions = await notificationActionsService.findByKeys(keys)
  const today = notificationActionsService.todayIso()
  const visible = []
  for (const n of candidates) {
    const action = actions.get(n.notification_key)
    if (!notificationActionsService.isActionVisible(action, today)) continue
    visible.push({
      ...n,
      is_read: notificationActionsService.isActionRead(action),
      action_status: action?.status || 'active',
      snoozed_until: action?.snoozed_until || null,
    })
  }
  return visible
}

module.exports = {
  SOURCE_TYPE,
  claimDedupeKey,
  collectIsoNotifications,
  listDueNotifications,
  buildKey,
}

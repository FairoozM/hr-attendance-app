const { query } = require('../db')

const REMINDER_TYPE = 'shop_visit_main_shop_reminder'
const TRIGGER_PREFIX = 'shop_visit_reminder:'

function reminderTriggerKey(leaveId) {
  return `${TRIGGER_PREFIX}${leaveId}`
}

/**
 * Sync reminder rows for confirmed shop visits (5 calendar days before visit date).
 * Idempotent: upserts by trigger_key; removes stale rows.
 */
async function syncShopVisitReminders() {
  await query(
    `DELETE FROM notifications n
     WHERE n.trigger_key LIKE $1
       AND NOT EXISTS (
         SELECT 1 FROM annual_leave al
         WHERE al.id = n.annual_leave_id
           AND al.status = 'Approved'
           AND al.shop_visit_status IN ('Confirmed', 'MoneyCalculated')
           AND al.shop_visit_date IS NOT NULL
           AND al.shop_visit_status <> 'Completed'
       )`,
    [`${TRIGGER_PREFIX}%`]
  )

  const leaves = await query(
    `SELECT al.id, al.employee_id, al.shop_visit_date, e.full_name
     FROM annual_leave al
     JOIN employees e ON e.id = al.employee_id
     WHERE al.status = 'Approved'
       AND al.shop_visit_status IN ('Confirmed', 'MoneyCalculated')
       AND al.shop_visit_date IS NOT NULL
       AND al.shop_visit_status <> 'Completed'`
  )

  for (const row of leaves.rows) {
    const leaveId = row.id
    const visitDate = row.shop_visit_date
    const name = row.full_name || 'Employee'
    const schedResult = await query(`SELECT ($1::date - INTERVAL '5 days')::date AS d`, [visitDate])
    const scheduledFor = schedResult.rows[0]?.d
    if (!scheduledFor) continue

    const message =
      `Reminder: ${name}'s main shop visit is in 5 days (${String(visitDate).slice(0, 10)}). ` +
      `Inform the main shop for passport and money collection.`

    const triggerKey = reminderTriggerKey(leaveId)
    await query(
      `INSERT INTO notifications (
         type, title, message, scheduled_for, trigger_key, employee_id, annual_leave_id, meta
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (trigger_key) DO UPDATE SET
         message = EXCLUDED.message,
         scheduled_for = EXCLUDED.scheduled_for,
         employee_id = EXCLUDED.employee_id,
         annual_leave_id = EXCLUDED.annual_leave_id,
         meta = EXCLUDED.meta,
         updated_at = NOW(),
         is_read = CASE
           WHEN notifications.scheduled_for IS DISTINCT FROM EXCLUDED.scheduled_for THEN false
           ELSE notifications.is_read
         END,
         read_at = CASE
           WHEN notifications.scheduled_for IS DISTINCT FROM EXCLUDED.scheduled_for THEN NULL
           ELSE notifications.read_at
         END`,
      [
        REMINDER_TYPE,
        'Main shop visit reminder',
        message,
        scheduledFor,
        triggerKey,
        row.employee_id,
        leaveId,
        JSON.stringify({ shop_visit_date: String(visitDate).slice(0, 10) }),
      ]
    )
  }
}

/**
 * List notifications relevant today onward (scheduled day reached), newest first.
 */
async function listForAdmin({ limit = 50 } = {}) {
  await syncShopVisitReminders()
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200)
  const result = await query(
    `SELECT n.*
     FROM notifications n
     WHERE n.scheduled_for <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
     ORDER BY n.is_read ASC, n.scheduled_for DESC, n.id DESC
     LIMIT $1`,
    [lim]
  )
  return result.rows
}

async function unreadCountForAdmin() {
  await syncShopVisitReminders()
  const result = await query(
    `SELECT COUNT(*)::int AS c
     FROM notifications n
     WHERE n.is_read = false
       AND n.scheduled_for <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`
  )
  return result.rows[0]?.c ?? 0
}

async function markRead(id) {
  const nid = parseInt(String(id), 10)
  if (Number.isNaN(nid)) return null
  const result = await query(
    `UPDATE notifications
     SET is_read = true, read_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [nid]
  )
  return result.rows[0] || null
}

async function markAllRead() {
  await query(
    `UPDATE notifications
     SET is_read = true, read_at = NOW(), updated_at = NOW()
     WHERE is_read = false`
  )
}

module.exports = {
  syncShopVisitReminders,
  listForAdmin,
  unreadCountForAdmin,
  markRead,
  markAllRead,
  reminderTriggerKey,
  REMINDER_TYPE,
}

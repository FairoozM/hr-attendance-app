const os = require('os')
const { query, pool } = require('../db')
const documentExpiryNotificationsService = require('./documentExpiryNotificationsService')
const notificationActionsService = require('./notificationActionsService')
const subscriptionNotificationsService = require('./subscriptionNotificationsService')

const REMINDER_TYPE = 'shop_visit_main_shop_reminder'
const TRIGGER_PREFIX = 'shop_visit_reminder:'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
/** Both syncs rewrite whole key ranges; running them per request caused pointless write churn. */
const SYNC_MIN_INTERVAL_MS = 60_000

/**
 * Advisory lock namespace for notification syncs. Advisory locks are global to the database, so a
 * dedicated namespace keeps these from colliding with any future use elsewhere.
 */
const SYNC_LOCK_NAMESPACE = 4_242
const SYNC_LOCK_IDS = { shop_visit: 1, subscription: 2 }

/** Identifies which process claimed a sync slot, for debugging a multi-instance deployment. */
const PROCESS_TAG = `${os.hostname()}:${process.pid}`.slice(0, 128)

function reminderTriggerKey(leaveId) {
  return `${TRIGGER_PREFIX}${leaveId}`
}

function clampLimit(limit, fallback = DEFAULT_LIMIT) {
  const parsed = parseInt(String(limit), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

/**
 * Hold a session-level Postgres advisory lock for the duration of `run`.
 *
 * The lock must be taken and released on the *same* connection, hence the dedicated client rather
 * than the shared pool helper. Session locks are released automatically if the process dies, so a
 * crash mid-sync cannot wedge the fleet. (Session-level advisory locks require a direct connection;
 * they are not safe behind a transaction-pooling proxy such as PgBouncer in `transaction` mode.)
 *
 * @returns the result of `run`, or `null` when another process holds the lock.
 */
async function withDistributedLock(lockId, run) {
  const client = await pool.connect()
  try {
    const acquired = await client.query('SELECT pg_try_advisory_lock($1, $2) AS locked', [
      SYNC_LOCK_NAMESPACE,
      lockId,
    ])
    if (!acquired.rows[0]?.locked) return null
    try {
      return await run()
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [SYNC_LOCK_NAMESPACE, lockId])
    }
  } finally {
    client.release()
  }
}

/**
 * Atomically claim the sync slot for `syncName`. The conditional upsert means the interval is
 * enforced by the database, so it is shared by every process instead of living in one heap.
 *
 * @returns true when this caller won the slot and should perform the sync.
 */
async function claimSyncSlot(syncName, { force = false, intervalMs = SYNC_MIN_INTERVAL_MS } = {}) {
  if (force) {
    await query(
      `INSERT INTO notification_sync_state (sync_name, last_run_at, last_run_by)
       VALUES ($1, NOW(), $2)
       ON CONFLICT (sync_name) DO UPDATE
         SET last_run_at = NOW(), last_run_by = EXCLUDED.last_run_by`,
      [syncName, PROCESS_TAG]
    )
    return true
  }

  const result = await query(
    `INSERT INTO notification_sync_state (sync_name, last_run_at, last_run_by)
     VALUES ($1, NOW(), $3)
     ON CONFLICT (sync_name) DO UPDATE
       SET last_run_at = NOW(), last_run_by = EXCLUDED.last_run_by
       WHERE notification_sync_state.last_run_at <= NOW() - make_interval(secs => $2::double precision)
     RETURNING last_run_at`,
    [syncName, intervalMs / 1000, PROCESS_TAG]
  )
  return result.rowCount > 0
}

/**
 * Run `fn` at most once per `SYNC_MIN_INTERVAL_MS` across the whole deployment, never concurrently.
 *
 * Four layers, cheapest first:
 *  1. an in-process promise, so parallel requests in one worker share a single pass;
 *  2. an in-process timestamp, purely to avoid a pool checkout per request — it can only make this
 *     process *more* conservative, so it is an optimization and never the guarantee;
 *  3. a Postgres advisory lock, so only one process in the fleet runs the body at a time;
 *  4. a database-backed timestamp, so the interval is shared instead of per-process.
 *
 * The lock/claim helpers are injectable so the coordination logic can be unit tested without a
 * live database.
 *
 * @returns 'ran' | 'throttled' | 'locked-elsewhere' | 'failed'
 */
function createCoalescedSync(
  label,
  fn,
  {
    lockId = SYNC_LOCK_IDS[label],
    intervalMs = SYNC_MIN_INTERVAL_MS,
    lock = withDistributedLock,
    claim = claimSyncSlot,
    now = () => Date.now(),
  } = {}
) {
  let inFlight = null
  let knownFreshAt = 0

  async function runGuarded(force) {
    const outcome = await lock(lockId, async () => {
      if (!(await claim(label, { force, intervalMs }))) return 'throttled'
      await fn()
      return 'ran'
    })
    // `withDistributedLock` returns null when a peer holds the lock: it is already syncing.
    return outcome === null ? 'locked-elsewhere' : outcome
  }

  return async function run({ force = false } = {}) {
    if (inFlight) return inFlight
    if (!force && knownFreshAt && now() - knownFreshAt < intervalMs) return 'throttled'

    inFlight = (async () => {
      try {
        const outcome = await runGuarded(force)
        // 'throttled' also means the data is fresh — a peer just synced — so remember it and stop
        // paying for a round trip on every subsequent request.
        if (outcome === 'ran' || outcome === 'throttled') knownFreshAt = now()
        return outcome
      } catch (err) {
        console.error(`[notifications] ${label} sync failed:`, err?.message || err)
        return 'failed'
      } finally {
        inFlight = null
      }
    })()

    return inFlight
  }
}

/**
 * Sync reminder rows for confirmed shop visits (5 calendar days before visit date).
 * Idempotent: upserts by trigger_key; removes stale rows.
 */
async function syncShopVisitRemindersNow() {
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
    `SELECT al.id,
            al.employee_id,
            to_char(al.shop_visit_date, 'YYYY-MM-DD') AS shop_visit_date,
            to_char(al.shop_visit_date - INTERVAL '5 days', 'YYYY-MM-DD') AS scheduled_for,
            e.full_name
     FROM annual_leave al
     JOIN employees e ON e.id = al.employee_id
     WHERE al.status = 'Approved'
       AND al.shop_visit_status IN ('Confirmed', 'MoneyCalculated')
       AND al.shop_visit_date IS NOT NULL
       AND al.shop_visit_status <> 'Completed'
     ORDER BY al.id`
  )

  for (const row of leaves.rows) {
    const scheduledFor = row.scheduled_for
    if (!scheduledFor) continue
    const visitDate = row.shop_visit_date
    const name = row.full_name || 'Employee'

    const message =
      `Reminder: ${name}'s main shop visit is in 5 days (${visitDate}). ` +
      `Inform the main shop for passport and money collection.`

    await query(
      `INSERT INTO notifications (
         type, title, message, scheduled_for, trigger_key, employee_id, annual_leave_id, meta
       ) VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8::jsonb)
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
        reminderTriggerKey(row.id),
        row.employee_id,
        row.id,
        JSON.stringify({ shop_visit_date: visitDate }),
      ]
    )
  }
}

const syncShopVisitReminders = createCoalescedSync('shop_visit', syncShopVisitRemindersNow)
const syncSubscriptions = createCoalescedSync('subscription', () =>
  subscriptionNotificationsService.syncSubscriptionNotifications()
)

/** Both source syncs, coalesced and failure-isolated so the inbox still renders if one breaks. */
async function syncSources({ force = false } = {}) {
  await Promise.all([syncShopVisitReminders({ force }), syncSubscriptions({ force })])
}

/** Persisted notifications whose scheduled day has arrived, unread first. */
async function listSystemNotifications({ limit = DEFAULT_LIMIT } = {}) {
  const result = await query(
    `SELECT n.*
     FROM notifications n
     WHERE n.scheduled_for <= $2::date
     ORDER BY n.is_read ASC, n.scheduled_for DESC, n.id DESC
     LIMIT $1`,
    [clampLimit(limit), notificationActionsService.todayIso()]
  )
  return result.rows
}

async function countUnreadSystemNotifications() {
  const result = await query(
    `SELECT COUNT(*)::int AS c
     FROM notifications n
     WHERE n.is_read = false
       AND n.scheduled_for <= $1::date`,
    [notificationActionsService.todayIso()]
  )
  return result.rows[0]?.c ?? 0
}

/**
 * Everything the notification pane needs in one round trip: items plus the counts the badge and
 * the filter tabs are derived from. Previously the client fetched the list and the unread count
 * separately, which could disagree with each other and doubled the server work.
 */
async function getInbox({ limit = DEFAULT_LIMIT } = {}) {
  await syncSources()

  const lim = clampLimit(limit)
  const [docReminders, systemRows, systemUnread] = await Promise.all([
    documentExpiryNotificationsService.listVisibleReminders(),
    listSystemNotifications({ limit: lim }),
    countUnreadSystemNotifications(),
  ])

  const docUnread = docReminders.reduce((sum, r) => sum + (r.is_read ? 0 : 1), 0)

  return {
    items: [...docReminders, ...systemRows],
    counts: {
      total: docReminders.length + systemRows.length,
      unread: docUnread + systemUnread,
      documentReminders: docReminders.length,
      documentRemindersUnread: docUnread,
      system: systemRows.length,
      systemUnread,
    },
    limit: lim,
    generatedAt: new Date().toISOString(),
    today: notificationActionsService.todayIso(),
  }
}

async function listForAdmin({ limit = DEFAULT_LIMIT } = {}) {
  const inbox = await getInbox({ limit })
  return inbox.items
}

async function unreadCountForAdmin() {
  await syncSources()
  const [docReminders, systemUnread] = await Promise.all([
    documentExpiryNotificationsService.listVisibleReminders(),
    countUnreadSystemNotifications(),
  ])
  const docUnread = docReminders.reduce((sum, r) => sum + (r.is_read ? 0 : 1), 0)
  return docUnread + systemUnread
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

async function markUnread(id) {
  const nid = parseInt(String(id), 10)
  if (Number.isNaN(nid)) return null
  const result = await query(
    `UPDATE notifications
     SET is_read = false, read_at = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [nid]
  )
  return result.rows[0] || null
}

/**
 * Mark a mixed selection read. Persisted rows are addressed by numeric id, dynamic document
 * reminders by notification key.
 */
async function markManyRead({ ids = [], keys = [], userId = null, read = true } = {}) {
  const numericIds = [...new Set((Array.isArray(ids) ? ids : []).map((v) => parseInt(String(v), 10)))]
    .filter((v) => Number.isFinite(v))

  const [systemResult, keyCount] = await Promise.all([
    numericIds.length
      ? query(
          read
            ? `UPDATE notifications
               SET is_read = true, read_at = NOW(), updated_at = NOW()
               WHERE id = ANY($1::int[])`
            : `UPDATE notifications
               SET is_read = false, read_at = NULL, updated_at = NOW()
               WHERE id = ANY($1::int[])`,
          [numericIds]
        )
      : Promise.resolve({ rowCount: 0 }),
    notificationActionsService.markKeysRead({
      keys,
      userId,
      sourceType: documentExpiryNotificationsService.SOURCE_TYPE,
      read,
    }),
  ])

  return { system: systemResult.rowCount || 0, reminders: keyCount }
}

/**
 * Clears the badge for real: persisted rows *and* every visible document reminder.
 * Scoped to notifications the user can actually see — marking future-dated rows read would silence
 * them permanently, so they would never appear as unread on the day they come due.
 */
async function markAllRead({ userId = null } = {}) {
  const [systemResult, reminders] = await Promise.all([
    query(
      `UPDATE notifications
       SET is_read = true, read_at = NOW(), updated_at = NOW()
       WHERE is_read = false
         AND scheduled_for <= $1::date`,
      [notificationActionsService.todayIso()]
    ),
    documentExpiryNotificationsService.markAllRemindersRead({ userId }),
  ])
  return { system: systemResult.rowCount || 0, reminders }
}

module.exports = {
  syncShopVisitReminders,
  syncSubscriptions,
  syncSources,
  getInbox,
  listForAdmin,
  unreadCountForAdmin,
  listSystemNotifications,
  countUnreadSystemNotifications,
  markRead,
  markUnread,
  markManyRead,
  markAllRead,
  reminderTriggerKey,
  clampLimit,
  createCoalescedSync,
  REMINDER_TYPE,
}

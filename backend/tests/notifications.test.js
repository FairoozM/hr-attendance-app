const test = require('node:test')
const assert = require('node:assert/strict')

const docNotifs = require('../src/services/documentExpiryNotificationsService')
const actions = require('../src/services/notificationActionsService')
const { createCoalescedSync, clampLimit } = require('../src/services/notificationsService')

const TODAY = '2026-07-25'

test('day arithmetic is calendar-based and free of timezone drift', () => {
  assert.equal(docNotifs.daysBetween('2026-07-25', '2026-07-25'), 0)
  assert.equal(docNotifs.daysBetween('2026-07-25', '2026-07-26'), 1)
  assert.equal(docNotifs.daysBetween('2026-07-25', '2025-12-26'), -211)
  // Spans a DST transition in most northern-hemisphere zones.
  assert.equal(docNotifs.daysBetween('2026-03-01', '2026-04-01'), 31)
  assert.equal(docNotifs.addDaysIso('2026-03-01', 31), '2026-04-01')
  assert.equal(docNotifs.addDaysIso('2026-01-01', -1), '2025-12-31')
})

test('getDaysLeft treats the expiry day as zero, not as expired', () => {
  assert.equal(docNotifs.getDaysLeft(TODAY, TODAY), 0)
  assert.equal(docNotifs.getDaysLeft('2026-07-26', TODAY), 1)
  assert.equal(docNotifs.getDaysLeft('2026-07-24', TODAY), -1)
  assert.equal(docNotifs.getDaysLeft(null, TODAY), null)
  assert.equal(docNotifs.getDaysLeft('not-a-date', TODAY), null)
})

test('reminder date defaults to 30 days when reminder_days is unusable', () => {
  assert.equal(docNotifs.getReminderDate('2026-08-01', 30), '2026-07-02')
  assert.equal(docNotifs.getReminderDate('2026-08-01', '7'), '2026-07-25')
  assert.equal(docNotifs.getReminderDate('2026-08-01', null), '2026-07-02')
  assert.equal(docNotifs.getReminderDate('2026-08-01', ''), '2026-07-02')
  assert.equal(docNotifs.getReminderDate('2026-08-01', 'abc'), '2026-07-02')
  assert.equal(docNotifs.getReminderDate(null, 30), null)
  // Number(null) is 0, so a missing value must be rejected before the numeric coercion.
  assert.equal(docNotifs.normalizeReminderDays(null), 30)
  assert.equal(docNotifs.normalizeReminderDays(0), 0)
  assert.equal(docNotifs.normalizeReminderDays(-5), 30)
})

test('urgency and message match the expiry distance', () => {
  assert.equal(docNotifs.mapUrgency('2026-07-24', TODAY), 'expired')
  assert.equal(docNotifs.mapUrgency(TODAY, TODAY), 'urgent')
  assert.equal(docNotifs.mapUrgency('2026-08-01', TODAY), 'urgent')
  assert.equal(docNotifs.mapUrgency('2026-08-02', TODAY), 'due-soon')

  assert.equal(docNotifs.buildMessage('2025-12-26', TODAY), 'Expired 211 days ago — action required.')
  assert.equal(docNotifs.buildMessage('2026-07-24', TODAY), 'Expired 1 day ago — action required.')
  assert.equal(docNotifs.buildMessage(TODAY, TODAY), 'Expires today — immediate action required.')
  assert.equal(docNotifs.buildMessage('2026-07-26', TODAY), 'Expires in 1 day on 26/07/2026.')
  assert.equal(docNotifs.buildMessage('2026-07-30', TODAY), 'Expires in 5 days on 30/07/2026.')
})

test('date formatting does not depend on server ICU locale', () => {
  assert.equal(docNotifs.formatDmy('2025-12-26'), '26/12/2025')
  assert.equal(docNotifs.formatDmy(''), '')
})

test('notification keys are stable and change when the expiry date changes', () => {
  const doc = { id: 5, document_type: 'Trade License', expiry_date: '2025-12-26' }
  assert.equal(docNotifs.buildNotificationKey(doc), 'document_expiry:trade_license:5:2025-12-26')
  assert.notEqual(
    docNotifs.buildNotificationKey({ ...doc, expiry_date: '2026-12-26' }),
    docNotifs.buildNotificationKey(doc)
  )
  assert.equal(docNotifs.docTypeSlug('VAT Filing'), 'vat_filing')
  assert.equal(docNotifs.docTypeSlug('Employee Visa / Emirates ID'), 'visa_emirates_id')
  assert.equal(docNotifs.docTypeSlug(''), 'document')
})

test('pg Date objects at local midnight are normalized without shifting the day', () => {
  const localMidnight = new Date(2025, 11, 26)
  assert.equal(actions.toIsoDate(localMidnight), '2025-12-26')
  assert.equal(actions.toIsoDate('2025-12-26T00:00:00.000Z'), '2025-12-26')
  assert.equal(actions.toIsoDate(''), null)
  assert.equal(actions.toIsoDate('26/12/2025'), null)
})

test('only documents inside their reminder window become candidates', () => {
  const docs = [
    { id: 1, expiry_date: '2026-08-20', reminder_days: 30 }, // window opened 2026-07-21
    { id: 2, expiry_date: '2026-12-01', reminder_days: 30 }, // still far away
    { id: 3, expiry_date: '2025-12-26', reminder_days: 30 }, // long expired
    { id: 4, expiry_date: null, reminder_days: 30 }, // no expiry recorded
  ]
  const due = docNotifs.selectDueDocuments(docs, TODAY).map((d) => d.id)
  assert.deepEqual(due, [1, 3])
})

test('ignored and resolved reminders stay hidden, elapsed snoozes come back', () => {
  assert.equal(actions.isActionVisible(null, TODAY), true)
  assert.equal(actions.isActionVisible({ status: 'active' }, TODAY), true)
  assert.equal(actions.isActionVisible({ status: 'ignored' }, TODAY), false)
  assert.equal(actions.isActionVisible({ status: 'resolved' }, TODAY), false)
  assert.equal(
    actions.isActionVisible({ status: 'snoozed', snoozed_until: '2026-07-26' }, TODAY),
    false
  )
  assert.equal(
    actions.isActionVisible({ status: 'snoozed', snoozed_until: TODAY }, TODAY),
    true,
    'a snooze ending today is over'
  )
  assert.equal(
    actions.isActionVisible({ status: 'snoozed', snoozed_until: '2026-07-01' }, TODAY),
    true
  )
})

test('read state is independent of action status so the badge can be cleared', () => {
  assert.equal(actions.isActionRead(null), false)
  assert.equal(actions.isActionRead({ status: 'active' }), false)
  assert.equal(actions.isActionRead({ status: 'active', read_at: new Date() }), true)
  assert.equal(actions.isActionRead({ status: 'snoozed', read_at: new Date() }), true)
})

test('reminders sort unread first, then by urgency', () => {
  const rows = [
    { is_read: false, urgency: 'due-soon', scheduled_for: '2026-08-10' },
    { is_read: true, urgency: 'expired', scheduled_for: '2025-01-01' },
    { is_read: false, urgency: 'expired', scheduled_for: '2025-12-26' },
    { is_read: false, urgency: 'urgent', scheduled_for: '2026-07-28' },
  ]
  const sorted = [...rows].sort(docNotifs.compareReminders)
  assert.deepEqual(
    sorted.map((r) => `${r.is_read ? 'read' : 'unread'}:${r.urgency}`),
    ['unread:expired', 'unread:urgent', 'unread:due-soon', 'read:expired']
  )
})

test('limit is clamped to a sane range', () => {
  assert.equal(clampLimit(undefined), 50)
  assert.equal(clampLimit('40'), 40)
  assert.equal(clampLimit(0), 1)
  assert.equal(clampLimit(9999), 200)
  assert.equal(clampLimit('abc'), 50)
})

/**
 * Stands in for the shared database so the coordination logic can be tested without one.
 * `lock` models a session-level `pg_try_advisory_lock` (non-blocking, one holder at a time) and
 * `claim` models the conditional upsert on notification_sync_state.
 */
function createFakeCluster() {
  const heldLocks = new Set()
  const lastRunAt = new Map()
  const state = { now: 1_700_000_000_000, claimCalls: 0 }

  return {
    state,
    lockHeld: () => heldLocks.size > 0,
    /** Spread into createCoalescedSync so every worker shares this fake database and clock. */
    wiring(lockId) {
      return {
        lockId,
        intervalMs: 60_000,
        lock: this.lock,
        claim: this.claim,
        now: () => state.now,
      }
    },
    lock: async (lockId, run) => {
      if (heldLocks.has(lockId)) return null
      heldLocks.add(lockId)
      try {
        return await run()
      } finally {
        heldLocks.delete(lockId)
      }
    },
    claim: async (syncName, { force, intervalMs }) => {
      state.claimCalls += 1
      const previous = lastRunAt.get(syncName)
      if (!force && previous != null && state.now - previous < intervalMs) return false
      lastRunAt.set(syncName, state.now)
      return true
    },
  }
}

test('coalesced sync runs once for concurrent callers in one process', async () => {
  const cluster = createFakeCluster()
  let runs = 0
  const sync = createCoalescedSync(
    'test',
    async () => {
      runs += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
    },
    cluster.wiring(1)
  )

  // The bell fires list + unread-count in parallel, which used to trigger two full syncs.
  const outcomes = await Promise.all([sync(), sync(), sync()])
  assert.equal(runs, 1)
  assert.deepEqual(outcomes, ['ran', 'ran', 'ran'], 'parallel callers share one pass')

  assert.equal(await sync(), 'throttled')
  assert.equal(runs, 1, 'throttled within the minimum interval')

  assert.equal(await sync({ force: true }), 'ran')
  assert.equal(runs, 2, 'force bypasses the throttle')

  cluster.state.now += 60_000
  assert.equal(await sync(), 'ran')
  assert.equal(runs, 3, 'runs again once the interval has elapsed')
})

test('the throttle is shared across processes, not per-process', async () => {
  // Two coalescers over one fake database == two workers/containers against one Postgres.
  const cluster = createFakeCluster()
  const runsByWorker = [0, 0]
  const workers = runsByWorker.map((_, index) =>
    createCoalescedSync(
      'subscription',
      async () => {
        runsByWorker[index] += 1
      },
      cluster.wiring(2)
    )
  )

  assert.equal(await workers[0](), 'ran')
  // A fresh process starts with an empty heap, so an in-memory throttle would let this one through
  // and it would perform its own delete-and-reinsert pass.
  assert.equal(await workers[1](), 'throttled')
  assert.deepEqual(runsByWorker, [1, 0], 'only one pass across the fleet per interval')

  cluster.state.now += 60_000
  assert.equal(await workers[1](), 'ran')
  assert.deepEqual(runsByWorker, [1, 1])
})

test('the advisory lock keeps two processes from syncing at the same time', async () => {
  const cluster = createFakeCluster()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })

  const slow = createCoalescedSync('subscription', () => gate, cluster.wiring(2))
  let peerRuns = 0
  const peer = createCoalescedSync(
    'subscription',
    async () => {
      peerRuns += 1
    },
    cluster.wiring(2)
  )

  const slowRun = slow()
  await new Promise((resolve) => setImmediate(resolve))

  // `force` bypasses the interval but must never bypass mutual exclusion, or the snapshot-based
  // DELETE in the subscription sync could remove rows the in-flight pass just wrote.
  assert.equal(await peer({ force: true }), 'locked-elsewhere')
  assert.equal(peerRuns, 0)

  release()
  assert.equal(await slowRun, 'ran')
  assert.equal(cluster.lockHeld(), false, 'lock released after the sync finishes')
})

test('a failing sync is isolated, releases the lock, and does not reject the caller', async () => {
  const cluster = createFakeCluster()
  const sync = createCoalescedSync(
    'boom',
    async () => {
      throw new Error('nope')
    },
    cluster.wiring(3)
  )

  assert.equal(await sync({ force: true }), 'failed')
  await assert.doesNotReject(() => sync({ force: true }))
  assert.equal(cluster.lockHeld(), false, 'a thrown error must not wedge the fleet')
})

test('a throttled process stops hitting the database on every request', async () => {
  const cluster = createFakeCluster()
  const sync = createCoalescedSync('test', async () => {}, cluster.wiring(1))

  assert.equal(await sync(), 'ran')
  const afterFirstRun = cluster.state.claimCalls

  // Each inbox request calls this; without a local fast path every one costs a pool checkout.
  for (let i = 0; i < 5; i += 1) assert.equal(await sync(), 'throttled')
  assert.equal(cluster.state.claimCalls, afterFirstRun, 'no extra round trips while known fresh')

  cluster.state.now += 60_000
  assert.equal(await sync(), 'ran')
  assert.equal(cluster.state.claimCalls, afterFirstRun + 1)
})

'use strict'

/**
 * Local reconciliation records for Stripe → Zoho invoice clearing.
 * One row per PaymentIntent and per Zoho invoice; every status change is logged.
 */

const CLEARING_STATUS = Object.freeze({
  READY: 'READY',
  POSTING: 'POSTING',
  POSTED: 'POSTED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  // Zoho may hold a payment we could not confirm; never re-posted automatically.
  FAILED_NEEDS_REVIEW: 'FAILED_NEEDS_REVIEW',
  // The Zoho payment was removed in Zoho after posting; the row and its history are kept.
  REVERSED_EXTERNALLY: 'REVERSED_EXTERNALLY',
})

// Gross-only, one payment per PaymentIntent. Superseded by payout clearing.
const CLEARING_MODEL_GROSS_V1 = 'GROSS_V1'

const STATUS_LIST_SQL = "'READY', 'POSTING', 'POSTED', 'FAILED', 'BLOCKED', 'FAILED_NEEDS_REVIEW', 'REVERSED_EXTERNALLY'"

// States from which a fresh, fully re-validated posting attempt may start.
const RETRYABLE = [CLEARING_STATUS.READY, CLEARING_STATUS.FAILED, CLEARING_STATUS.BLOCKED]

// Two-key advisory locks live in a separate key space from single bigint locks.
const LOCK_NAMESPACE = 0x53545243 // "STRC"

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS stripe_payment_clearings (
  id BIGSERIAL PRIMARY KEY,
  stripe_payment_intent_id TEXT NOT NULL,
  stripe_charge_id TEXT,
  stripe_livemode BOOLEAN NOT NULL,
  website_order_id TEXT NOT NULL,
  website_order_number TEXT NOT NULL,
  zoho_invoice_id TEXT NOT NULL,
  zoho_invoice_number TEXT NOT NULL,
  zoho_customer_id TEXT NOT NULL,
  zoho_account_id TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  payment_date DATE NOT NULL,
  stripe_created_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL,
  zoho_payment_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  CONSTRAINT uq_stripe_payment_clearings_intent UNIQUE (stripe_payment_intent_id),
  CONSTRAINT uq_stripe_payment_clearings_invoice UNIQUE (zoho_invoice_id),
  CONSTRAINT ck_stripe_payment_clearings_posted
    CHECK (status <> 'POSTED' OR (zoho_payment_id IS NOT NULL AND posted_at IS NOT NULL))
)`

// Older databases carry the original inline status check; replace it only when it lacks the new state.
const STATUS_CHECK_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_payment_clearings'::regclass
      AND conname = 'stripe_payment_clearings_status_check'
      AND pg_get_constraintdef(oid) LIKE '%REVERSED_EXTERNALLY%'
  ) THEN
    ALTER TABLE stripe_payment_clearings DROP CONSTRAINT IF EXISTS stripe_payment_clearings_status_check;
    ALTER TABLE stripe_payment_clearings
      ADD CONSTRAINT stripe_payment_clearings_status_check CHECK (status IN (${STATUS_LIST_SQL}));
  END IF;
END $$`

const SCHEMA_SQL = [
  TABLE_SQL,
  STATUS_CHECK_SQL,
  `ALTER TABLE stripe_payment_clearings ADD COLUMN IF NOT EXISTS clearing_model VARCHAR(16) NOT NULL DEFAULT '${CLEARING_MODEL_GROSS_V1}'`,
  'ALTER TABLE stripe_payment_clearings ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ',
  'ALTER TABLE stripe_payment_clearings ADD COLUMN IF NOT EXISTS reversal_detail TEXT',
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_payment_clearings_zoho_payment
     ON stripe_payment_clearings (zoho_payment_id) WHERE zoho_payment_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_payment_clearings_status
     ON stripe_payment_clearings (status)`,
  `CREATE TABLE IF NOT EXISTS stripe_payment_clearing_events (
     id BIGSERIAL PRIMARY KEY,
     clearing_id BIGINT NOT NULL REFERENCES stripe_payment_clearings(id),
     from_status VARCHAR(32),
     to_status VARCHAR(32) NOT NULL,
     detail TEXT,
     actor TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_payment_clearing_events_clearing
     ON stripe_payment_clearing_events (clearing_id, created_at)`,
]

async function ensureStripeClearingTables(query) {
  for (const sql of SCHEMA_SQL) await query(sql)
}

function clearingError(status, code, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  err.code = code
  Object.assign(err, extra)
  return err
}

function mapRow(row) {
  if (!row) return null
  return {
    id: String(row.id),
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeChargeId: row.stripe_charge_id || null,
    stripeLivemode: row.stripe_livemode === true,
    websiteOrderId: row.website_order_id,
    websiteOrderNumber: row.website_order_number,
    zohoInvoiceId: row.zoho_invoice_id,
    zohoInvoiceNumber: row.zoho_invoice_number,
    zohoCustomerId: row.zoho_customer_id,
    zohoAccountId: row.zoho_account_id,
    amount: Number(row.amount),
    currency: String(row.currency || '').trim(),
    paymentDate: row.payment_date instanceof Date ? row.payment_date.toISOString().slice(0, 10) : String(row.payment_date || ''),
    stripeCreatedAt: row.stripe_created_at ? new Date(row.stripe_created_at).toISOString() : null,
    status: row.status,
    zohoPaymentId: row.zoho_payment_id || null,
    attemptCount: Number(row.attempt_count) || 0,
    lastError: row.last_error || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
    clearingModel: row.clearing_model || CLEARING_MODEL_GROSS_V1,
    reversedAt: row.reversed_at ? new Date(row.reversed_at).toISOString() : null,
    reversalDetail: row.reversal_detail || null,
  }
}

/**
 * Session-level advisory lock for one PaymentIntent on a dedicated connection.
 * A second request for the same PaymentIntent fails fast instead of waiting.
 */
async function acquireIntentLock(pool, paymentIntentId) {
  const client = await pool.connect()
  let locked = false
  try {
    const { rows } = await client.query(
      'SELECT pg_try_advisory_lock($1::int, hashtext($2)) AS locked',
      [LOCK_NAMESPACE, paymentIntentId],
    )
    locked = rows[0] && rows[0].locked === true
  } catch (err) {
    client.release()
    throw err
  }
  if (!locked) {
    client.release()
    throw clearingError(409, 'CLEARING_IN_PROGRESS', `Another request is already clearing ${paymentIntentId}.`)
  }
  return {
    db: client,
    async release() {
      try {
        await client.query('SELECT pg_advisory_unlock($1::int, hashtext($2))', [LOCK_NAMESPACE, paymentIntentId])
      } finally {
        client.release()
      }
    },
  }
}

async function inTransaction(db, fn) {
  await db.query('BEGIN')
  try {
    const out = await fn()
    await db.query('COMMIT')
    return out
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  }
}

async function logEvent(db, clearingId, fromStatus, toStatus, detail, actor) {
  await db.query(
    `INSERT INTO stripe_payment_clearing_events (clearing_id, from_status, to_status, detail, actor)
     VALUES ($1, $2, $3, $4, $5)`,
    [clearingId, fromStatus, toStatus, detail || null, actor || null],
  )
}

async function getByIntent(db, paymentIntentId) {
  const { rows } = await db.query('SELECT * FROM stripe_payment_clearings WHERE stripe_payment_intent_id = $1', [paymentIntentId])
  return mapRow(rows[0])
}

async function getByIntents(db, paymentIntentIds) {
  if (!paymentIntentIds.length) return new Map()
  const { rows } = await db.query(
    'SELECT * FROM stripe_payment_clearings WHERE stripe_payment_intent_id = ANY($1::text[])',
    [paymentIntentIds],
  )
  return new Map(rows.map((row) => [row.stripe_payment_intent_id, mapRow(row)]))
}

async function listEvents(db, clearingId) {
  const { rows } = await db.query(
    `SELECT from_status, to_status, detail, actor, created_at
     FROM stripe_payment_clearing_events WHERE clearing_id = $1 ORDER BY created_at ASC, id ASC`,
    [clearingId],
  )
  return rows.map((row) => ({
    fromStatus: row.from_status,
    toStatus: row.to_status,
    detail: row.detail,
    actor: row.actor,
    at: new Date(row.created_at).toISOString(),
  }))
}

function fieldParams(fields) {
  return [
    fields.stripePaymentIntentId,
    fields.stripeChargeId || null,
    fields.stripeLivemode === true,
    fields.websiteOrderId,
    fields.websiteOrderNumber,
    fields.zohoInvoiceId,
    fields.zohoInvoiceNumber,
    fields.zohoCustomerId,
    fields.zohoAccountId,
    fields.amount,
    fields.currency,
    fields.paymentDate,
    fields.stripeCreatedAt || null,
  ]
}

async function insertRow(db, fields, status, actor, patch = {}) {
  const { rows } = await db.query(
    `INSERT INTO stripe_payment_clearings (
       stripe_payment_intent_id, stripe_charge_id, stripe_livemode, website_order_id, website_order_number,
       zoho_invoice_id, zoho_invoice_number, zoho_customer_id, zoho_account_id, amount, currency,
       payment_date, stripe_created_at, status, zoho_payment_id, posted_at, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [...fieldParams(fields), status, patch.zohoPaymentId || null, patch.postedAt || null, actor || null],
  )
  return rows[0]
}

async function refreshFields(db, id, fields, status, patch = {}) {
  const { rows } = await db.query(
    `UPDATE stripe_payment_clearings SET
       stripe_payment_intent_id = $1, stripe_charge_id = $2, stripe_livemode = $3, website_order_id = $4,
       website_order_number = $5, zoho_invoice_id = $6, zoho_invoice_number = $7, zoho_customer_id = $8,
       zoho_account_id = $9, amount = $10, currency = $11, payment_date = $12, stripe_created_at = $13,
       status = $14,
       attempt_count = attempt_count + $15,
       zoho_payment_id = COALESCE($16, zoho_payment_id),
       posted_at = COALESCE($17, posted_at),
       updated_at = NOW()
     WHERE id = $18
     RETURNING *`,
    [...fieldParams(fields), status, patch.incrementAttempt ? 1 : 0, patch.zohoPaymentId || null, patch.postedAt || null, id],
  )
  return rows[0]
}

function isUniqueViolation(err) {
  return err && err.code === '23505'
}

/**
 * Move a PaymentIntent into POSTING with freshly validated fields.
 * New rows are created as READY first so the history shows both steps.
 * @returns {Promise<{ claimed: true, row: object } | { claimed: false, row: object|null, conflict: string }>}
 */
async function claimForPosting(db, fields, actor) {
  try {
    return await inTransaction(db, async () => {
      const { rows } = await db.query(
        'SELECT * FROM stripe_payment_clearings WHERE stripe_payment_intent_id = $1 FOR UPDATE',
        [fields.stripePaymentIntentId],
      )
      const current = rows[0]
      if (current && !RETRYABLE.includes(current.status)) {
        return { claimed: false, row: mapRow(current), conflict: `STATUS_${current.status}` }
      }
      const invoiceOwner = await db.query(
        'SELECT * FROM stripe_payment_clearings WHERE zoho_invoice_id = $1 AND stripe_payment_intent_id <> $2 FOR UPDATE',
        [fields.zohoInvoiceId, fields.stripePaymentIntentId],
      )
      if (invoiceOwner.rows[0]) {
        return { claimed: false, row: mapRow(invoiceOwner.rows[0]), conflict: 'INVOICE_CLAIMED' }
      }
      let base = current
      if (!base) {
        base = await insertRow(db, fields, CLEARING_STATUS.READY, actor)
        await logEvent(db, base.id, null, CLEARING_STATUS.READY, 'Validated live and queued for posting.', actor)
      }
      const row = await refreshFields(db, base.id, fields, CLEARING_STATUS.POSTING, { incrementAttempt: true })
      await logEvent(db, row.id, base.status, CLEARING_STATUS.POSTING, 'Posting customer payment to Zoho.', actor)
      return { claimed: true, row: mapRow(row) }
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { claimed: false, row: null, conflict: err.constraint || 'UNIQUE_VIOLATION' }
    }
    throw err
  }
}

/**
 * Guarded status change: only succeeds from one of `fromStatuses`, never silently.
 * `lastError` is only replaced when a new one is given, so an earlier reason survives.
 */
async function transition(db, id, fromStatuses, toStatus, patch = {}, detail, actor) {
  return inTransaction(db, async () => {
    const current = await db.query('SELECT status FROM stripe_payment_clearings WHERE id = $1 FOR UPDATE', [id])
    const previous = current.rows[0] ? current.rows[0].status : null
    if (!fromStatuses.includes(previous)) {
      throw clearingError(409, 'CLEARING_STATE_CONFLICT', `Clearing ${id} is ${previous || 'missing'}, not ${fromStatuses.join('/')}; refusing to set ${toStatus}.`)
    }
    const { rows } = await db.query(
      `UPDATE stripe_payment_clearings SET
         status = $1,
         zoho_payment_id = COALESCE($2, zoho_payment_id),
         last_error = COALESCE($3, last_error),
         posted_at = COALESCE($4, posted_at),
         updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [toStatus, patch.zohoPaymentId || null, patch.lastError || null, patch.postedAt || null, id],
    )
    await logEvent(db, id, previous, toStatus, detail || patch.lastError, actor)
    return mapRow(rows[0])
  })
}

/**
 * Record a Zoho payment that already carries this PaymentIntent reference
 * (created outside this request). Only allowed when nothing is in flight.
 */
async function recordExistingPosted(db, fields, zohoPaymentId, postedAt, detail, actor) {
  try {
    return await inTransaction(db, async () => {
      const { rows } = await db.query(
        'SELECT * FROM stripe_payment_clearings WHERE stripe_payment_intent_id = $1 FOR UPDATE',
        [fields.stripePaymentIntentId],
      )
      const current = rows[0]
      if (current && !RETRYABLE.includes(current.status)) {
        return { recorded: false, row: mapRow(current), conflict: `STATUS_${current.status}` }
      }
      const patch = { zohoPaymentId, postedAt }
      const row = current
        ? await refreshFields(db, current.id, fields, CLEARING_STATUS.POSTED, patch)
        : await insertRow(db, fields, CLEARING_STATUS.POSTED, actor, patch)
      await logEvent(db, row.id, current ? current.status : null, CLEARING_STATUS.POSTED, detail, actor)
      return { recorded: true, row: mapRow(row) }
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { recorded: false, row: null, conflict: err.constraint || 'UNIQUE_VIOLATION' }
    }
    throw err
  }
}

/**
 * GROSS_V1 POSTED → REVERSED_EXTERNALLY after the Zoho payment was removed in Zoho.
 * Keeps the original payment ID, posting time and history; adds one event.
 */
async function markReversedExternally(db, id, expectedZohoPaymentId, detail, actor) {
  return inTransaction(db, async () => {
    const { rows } = await db.query('SELECT * FROM stripe_payment_clearings WHERE id = $1 FOR UPDATE', [id])
    const current = rows[0]
    if (!current) throw clearingError(404, 'CLEARING_NOT_FOUND', `Clearing ${id} does not exist.`)
    if (current.status !== CLEARING_STATUS.POSTED) {
      throw clearingError(409, 'CLEARING_STATE_CONFLICT', `Clearing ${id} is ${current.status}, not POSTED.`)
    }
    if ((current.clearing_model || CLEARING_MODEL_GROSS_V1) !== CLEARING_MODEL_GROSS_V1) {
      throw clearingError(409, 'CLEARING_MODEL_CONFLICT', `Clearing ${id} is not a ${CLEARING_MODEL_GROSS_V1} record.`)
    }
    if (current.zoho_payment_id !== expectedZohoPaymentId) {
      throw clearingError(409, 'ZOHO_PAYMENT_ID_MISMATCH', `Clearing ${id} records Zoho payment ${current.zoho_payment_id}, not ${expectedZohoPaymentId}.`)
    }
    const updated = await db.query(
      `UPDATE stripe_payment_clearings SET
         status = $1, reversed_at = NOW(), reversal_detail = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [CLEARING_STATUS.REVERSED_EXTERNALLY, detail, id],
    )
    await logEvent(db, id, CLEARING_STATUS.POSTED, CLEARING_STATUS.REVERSED_EXTERNALLY, detail, actor)
    return mapRow(updated.rows[0])
  })
}

module.exports = {
  CLEARING_STATUS,
  CLEARING_MODEL_GROSS_V1,
  RETRYABLE,
  LOCK_NAMESPACE,
  SCHEMA_SQL,
  ensureStripeClearingTables,
  acquireIntentLock,
  getByIntent,
  getByIntents,
  listEvents,
  claimForPosting,
  transition,
  recordExistingPosted,
  markReversedExternally,
  mapRow,
}

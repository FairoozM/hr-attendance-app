'use strict'

/**
 * Local workflow records for payout-level clearing.
 *
 * - stripe_customer_advance_cases: one confirmed-or-candidate customer overpayment per
 *   Stripe charge, owned by payout + customer. PaymentIntent/charge are traceability only.
 * - stripe_payout_clearing_components: NET / FEE / CUSTOMER_ADVANCE (and later
 *   CUSTOMER_ADVANCE_REFUND) per payout + customer, tracked independently.
 * - stripe_payout_clearing_events: audit history for both.
 *
 * Nothing here talks to Zoho or Stripe.
 */

const CASE_STATUS = Object.freeze({
  REVIEW_REQUIRED: 'CUSTOMER_ADVANCE_REVIEW_REQUIRED',
  CONFIRMED: 'CONFIRMED',
  ADVANCE_POSTED: 'ADVANCE_POSTED',
  REFUNDED: 'REFUNDED',
  REJECTED: 'REJECTED',
})

const REFUND_STATUS = Object.freeze({
  NOT_REFUNDED: 'NOT_REFUNDED',
  REFUND_MATCHED: 'REFUND_MATCHED',
  REFUNDED: 'REFUNDED',
  REFUND_MISMATCH: 'REFUND_MISMATCH',
})

const COMPONENT_TYPE = Object.freeze({
  NET: 'NET',
  FEE: 'FEE',
  CUSTOMER_ADVANCE: 'CUSTOMER_ADVANCE',
  CUSTOMER_ADVANCE_REFUND: 'CUSTOMER_ADVANCE_REFUND',
})

const COMPONENT_STATUS = Object.freeze({
  PLANNED: 'PLANNED',
  POSTING: 'POSTING',
  POSTED: 'POSTED',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
})

// A component may only be (re)planned while nothing is in flight or recorded in Zoho.
const REPLANNABLE = [COMPONENT_STATUS.PLANNED, COMPONENT_STATUS.FAILED]

const ENTITY = Object.freeze({ ADVANCE_CASE: 'ADVANCE_CASE', COMPONENT: 'COMPONENT' })

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS stripe_customer_advance_cases (
     id BIGSERIAL PRIMARY KEY,
     payout_id TEXT NOT NULL,
     zoho_customer_id TEXT NOT NULL,
     customer_name TEXT NOT NULL,
     order_number TEXT NOT NULL,
     invoice_id TEXT NOT NULL,
     invoice_number TEXT NOT NULL,
     payment_intent_id TEXT,
     charge_id TEXT NOT NULL,
     balance_transaction_id TEXT,
     currency CHAR(3) NOT NULL,
     stripe_gross NUMERIC(14, 2) NOT NULL,
     stripe_net NUMERIC(14, 2) NOT NULL,
     stripe_fee NUMERIC(14, 2) NOT NULL,
     invoice_total NUMERIC(14, 2) NOT NULL,
     overpayment_amount NUMERIC(14, 2) NOT NULL CHECK (overpayment_amount > 0),
     net_allocation NUMERIC(14, 2) NOT NULL CHECK (net_allocation > 0),
     customer_advance_account_id TEXT NOT NULL,
     customer_advance_account_code TEXT NOT NULL,
     advance_reference TEXT NOT NULL,
     reason TEXT,
     status VARCHAR(40) NOT NULL CHECK (status IN (
       'CUSTOMER_ADVANCE_REVIEW_REQUIRED', 'CONFIRMED', 'ADVANCE_POSTED', 'REFUNDED', 'REJECTED')),
     admin_confirmed BOOLEAN NOT NULL DEFAULT false,
     confirmed_by TEXT,
     confirmed_at TIMESTAMPTZ,
     refund_required BOOLEAN NOT NULL DEFAULT true,
     refund_status VARCHAR(24) NOT NULL DEFAULT 'NOT_REFUNDED' CHECK (refund_status IN (
       'NOT_REFUNDED', 'REFUND_MATCHED', 'REFUNDED', 'REFUND_MISMATCH')),
     refund_payout_id TEXT,
     refund_balance_transaction_id TEXT,
     refund_amount NUMERIC(14, 2),
     zoho_journal_id TEXT,
     refund_zoho_journal_id TEXT,
     created_by TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     resolved_at TIMESTAMPTZ,
     CONSTRAINT uq_stripe_customer_advance_cases_charge UNIQUE (charge_id),
     CONSTRAINT ck_stripe_customer_advance_gross CHECK (stripe_gross = invoice_total + overpayment_amount),
     CONSTRAINT ck_stripe_customer_advance_net CHECK (stripe_gross = stripe_net + stripe_fee),
     CONSTRAINT ck_stripe_customer_advance_split CHECK (net_allocation + overpayment_amount = stripe_net),
     CONSTRAINT ck_stripe_customer_advance_confirmed CHECK (
       status IN ('CUSTOMER_ADVANCE_REVIEW_REQUIRED', 'REJECTED')
       OR (admin_confirmed AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_customer_advance_cases_payout
     ON stripe_customer_advance_cases (payout_id, zoho_customer_id)`,
  `CREATE TABLE IF NOT EXISTS stripe_payout_clearing_components (
     id BIGSERIAL PRIMARY KEY,
     payout_id TEXT NOT NULL,
     zoho_customer_id TEXT NOT NULL,
     component VARCHAR(32) NOT NULL CHECK (component IN ('NET', 'FEE', 'CUSTOMER_ADVANCE', 'CUSTOMER_ADVANCE_REFUND')),
     zoho_record_type VARCHAR(24) NOT NULL CHECK (zoho_record_type IN ('customer_payment', 'journal')),
     amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
     currency CHAR(3) NOT NULL,
     deposit_account_id TEXT,
     debit_account_id TEXT,
     credit_account_id TEXT,
     reference TEXT NOT NULL,
     allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
     advance_case_ids BIGINT[] NOT NULL DEFAULT '{}',
     status VARCHAR(24) NOT NULL CHECK (status IN ('PLANNED', 'POSTING', 'POSTED', 'VERIFIED', 'FAILED', 'NEEDS_REVIEW')),
     zoho_record_id TEXT,
     zoho_journal_id TEXT,
     attempt_count INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     posted_at TIMESTAMPTZ,
     verified_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT uq_stripe_payout_clearing_component UNIQUE (payout_id, zoho_customer_id, component),
     CONSTRAINT ck_stripe_payout_component_verified
       CHECK (status <> 'VERIFIED' OR (zoho_record_id IS NOT NULL AND verified_at IS NOT NULL)),
     CONSTRAINT ck_stripe_payout_component_journal
       CHECK (zoho_record_type <> 'journal' OR zoho_record_id IS NULL OR zoho_journal_id = zoho_record_id)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_payout_clearing_component_record
     ON stripe_payout_clearing_components (zoho_record_id) WHERE zoho_record_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS stripe_payout_clearing_events (
     id BIGSERIAL PRIMARY KEY,
     entity_type VARCHAR(24) NOT NULL CHECK (entity_type IN ('ADVANCE_CASE', 'COMPONENT')),
     entity_id BIGINT NOT NULL,
     payout_id TEXT NOT NULL,
     zoho_customer_id TEXT,
     from_status VARCHAR(40),
     to_status VARCHAR(40) NOT NULL,
     detail TEXT,
     actor TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_payout_clearing_events_entity
     ON stripe_payout_clearing_events (entity_type, entity_id, created_at)`,
]

async function ensureStripePayoutClearingTables(query) {
  for (const sql of SCHEMA_SQL) await query(sql)
}

function storeError(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function iso(value) {
  return value ? new Date(value).toISOString() : null
}

function num(value) {
  return value == null ? null : Number(value)
}

function mapCase(row) {
  if (!row) return null
  return {
    id: String(row.id),
    payoutId: row.payout_id,
    zohoCustomerId: row.zoho_customer_id,
    customerName: row.customer_name,
    orderNumber: row.order_number,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    paymentIntentId: row.payment_intent_id || null,
    chargeId: row.charge_id,
    balanceTransactionId: row.balance_transaction_id || null,
    currency: String(row.currency || '').trim(),
    stripeGross: num(row.stripe_gross),
    stripeNet: num(row.stripe_net),
    stripeFee: num(row.stripe_fee),
    invoiceTotal: num(row.invoice_total),
    overpaymentAmount: num(row.overpayment_amount),
    netAllocation: num(row.net_allocation),
    customerAdvanceAccountId: row.customer_advance_account_id,
    customerAdvanceAccountCode: row.customer_advance_account_code,
    advanceReference: row.advance_reference,
    reason: row.reason || null,
    status: row.status,
    adminConfirmed: row.admin_confirmed === true,
    confirmedBy: row.confirmed_by || null,
    confirmedAt: iso(row.confirmed_at),
    refundRequired: row.refund_required === true,
    refundStatus: row.refund_status,
    refundPayoutId: row.refund_payout_id || null,
    refundBalanceTransactionId: row.refund_balance_transaction_id || null,
    refundAmount: num(row.refund_amount),
    zohoJournalId: row.zoho_journal_id || null,
    refundZohoJournalId: row.refund_zoho_journal_id || null,
    createdBy: row.created_by || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    resolvedAt: iso(row.resolved_at),
  }
}

function mapComponent(row) {
  if (!row) return null
  return {
    id: String(row.id),
    payoutId: row.payout_id,
    zohoCustomerId: row.zoho_customer_id,
    component: row.component,
    zohoRecordType: row.zoho_record_type,
    amount: num(row.amount),
    currency: String(row.currency || '').trim(),
    depositAccountId: row.deposit_account_id || null,
    debitAccountId: row.debit_account_id || null,
    creditAccountId: row.credit_account_id || null,
    reference: row.reference,
    allocations: Array.isArray(row.allocations) ? row.allocations : [],
    advanceCaseIds: (row.advance_case_ids || []).map(String),
    status: row.status,
    zohoRecordId: row.zoho_record_id || null,
    zohoJournalId: row.zoho_journal_id || null,
    attemptCount: Number(row.attempt_count) || 0,
    lastError: row.last_error || null,
    postedAt: iso(row.posted_at),
    verifiedAt: iso(row.verified_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
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

async function logEvent(db, entry) {
  await db.query(
    `INSERT INTO stripe_payout_clearing_events
       (entity_type, entity_id, payout_id, zoho_customer_id, from_status, to_status, detail, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [entry.entityType, entry.entityId, entry.payoutId, entry.zohoCustomerId || null, entry.fromStatus || null, entry.toStatus, entry.detail || null, entry.actor || null],
  )
}

async function listEvents(db, entityType, entityIds) {
  if (!entityIds.length) return []
  const { rows } = await db.query(
    `SELECT entity_type, entity_id, payout_id, zoho_customer_id, from_status, to_status, detail, actor, created_at
     FROM stripe_payout_clearing_events
     WHERE entity_type = $1 AND entity_id = ANY($2::bigint[])
     ORDER BY created_at ASC, id ASC`,
    [entityType, entityIds],
  )
  return rows.map((row) => ({
    entityType: row.entity_type,
    entityId: String(row.entity_id),
    payoutId: row.payout_id,
    zohoCustomerId: row.zoho_customer_id || null,
    fromStatus: row.from_status || null,
    toStatus: row.to_status,
    detail: row.detail || null,
    actor: row.actor || null,
    at: iso(row.created_at),
  }))
}

async function listCasesForPayout(db, payoutId) {
  const { rows } = await db.query('SELECT * FROM stripe_customer_advance_cases WHERE payout_id = $1 ORDER BY id', [payoutId])
  return rows.map(mapCase)
}

async function listCasesByChargeIds(db, chargeIds) {
  if (!chargeIds.length) return []
  const { rows } = await db.query('SELECT * FROM stripe_customer_advance_cases WHERE charge_id = ANY($1::text[]) ORDER BY id', [chargeIds])
  return rows.map(mapCase)
}

// Money fields that must agree exactly between a stored case and a fresh candidate.
const CASE_FIGURES = [
  ['payout_id', 'payoutId'],
  ['zoho_customer_id', 'zohoCustomerId'],
  ['invoice_id', 'invoiceId'],
  ['invoice_number', 'invoiceNumber'],
  ['order_number', 'orderNumber'],
  ['stripe_gross', 'stripeGross'],
  ['stripe_net', 'stripeNet'],
  ['stripe_fee', 'stripeFee'],
  ['invoice_total', 'invoiceTotal'],
  ['overpayment_amount', 'overpaymentAmount'],
  ['net_allocation', 'netAllocation'],
]

function caseDifferences(row, candidate) {
  const out = []
  for (const [col, key] of CASE_FIGURES) {
    const stored = row[col]
    const fresh = candidate[key]
    const same = typeof fresh === 'number' ? Math.round(Number(stored) * 100) === Math.round(fresh * 100) : String(stored) === String(fresh)
    if (!same) out.push(`${key}: stored ${stored}, now ${fresh}`)
  }
  return out
}

async function insertCandidate(db, candidate, actor) {
  const { rows } = await db.query(
    `INSERT INTO stripe_customer_advance_cases (
       payout_id, zoho_customer_id, customer_name, order_number, invoice_id, invoice_number,
       payment_intent_id, charge_id, balance_transaction_id, currency, stripe_gross, stripe_net, stripe_fee,
       invoice_total, overpayment_amount, net_allocation, customer_advance_account_id,
       customer_advance_account_code, advance_reference, status, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     RETURNING *`,
    [
      candidate.payoutId, candidate.zohoCustomerId, candidate.customerName, candidate.orderNumber,
      candidate.invoiceId, candidate.invoiceNumber, candidate.paymentIntentId || null, candidate.chargeId,
      candidate.balanceTransactionId || null, candidate.currency, candidate.stripeGross, candidate.stripeNet,
      candidate.stripeFee, candidate.invoiceTotal, candidate.overpaymentAmount, candidate.netAllocation,
      candidate.customerAdvanceAccountId, candidate.customerAdvanceAccountCode, candidate.advanceReference,
      CASE_STATUS.REVIEW_REQUIRED, actor || null,
    ],
  )
  return rows[0]
}

/**
 * Record (if new) and confirm one customer-advance candidate. Local only.
 * A stored case whose figures differ from the fresh candidate is never confirmed.
 * @returns {Promise<{ case: object, alreadyConfirmed: boolean }>}
 */
async function confirmCase(db, candidate, { actor, reason }) {
  return inTransaction(db, async () => {
    const found = await db.query('SELECT * FROM stripe_customer_advance_cases WHERE charge_id = $1 FOR UPDATE', [candidate.chargeId])
    let row = found.rows[0]
    if (!row) {
      row = await insertCandidate(db, candidate, actor)
      await logEvent(db, {
        entityType: ENTITY.ADVANCE_CASE,
        entityId: row.id,
        payoutId: row.payout_id,
        zohoCustomerId: row.zoho_customer_id,
        toStatus: CASE_STATUS.REVIEW_REQUIRED,
        detail: `Candidate: Stripe ${candidate.stripeGross} vs invoice ${candidate.invoiceNumber} ${candidate.invoiceTotal}; overpayment ${candidate.overpaymentAmount}.`,
        actor,
      })
    }
    const differences = caseDifferences(row, candidate)
    if (differences.length > 0) {
      throw storeError(409, 'ADVANCE_CASE_CHANGED', `Stored customer advance case differs from Stripe/Zoho now: ${differences.join('; ')}.`)
    }
    if (row.status !== CASE_STATUS.REVIEW_REQUIRED) {
      return { case: mapCase(row), alreadyConfirmed: true }
    }
    const updated = await db.query(
      `UPDATE stripe_customer_advance_cases SET
         status = $1, admin_confirmed = true, confirmed_by = $2, confirmed_at = NOW(), reason = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [CASE_STATUS.CONFIRMED, actor, reason, row.id],
    )
    await logEvent(db, {
      entityType: ENTITY.ADVANCE_CASE,
      entityId: row.id,
      payoutId: row.payout_id,
      zohoCustomerId: row.zoho_customer_id,
      fromStatus: CASE_STATUS.REVIEW_REQUIRED,
      toStatus: CASE_STATUS.CONFIRMED,
      detail: `Admin confirmed customer overpayment of ${candidate.overpaymentAmount}. Reason: ${reason}. Local status only; nothing was posted to Zoho.`,
      actor,
    })
    return { case: mapCase(updated.rows[0]), alreadyConfirmed: false }
  })
}

async function listComponents(db, payoutId) {
  const { rows } = await db.query('SELECT * FROM stripe_payout_clearing_components WHERE payout_id = $1 ORDER BY id', [payoutId])
  return rows.map(mapComponent)
}

/**
 * Create or refresh a planned component. Components already in flight, posted,
 * verified or under review are returned unchanged.
 */
async function upsertPlannedComponent(db, c, actor) {
  return inTransaction(db, async () => {
    const found = await db.query(
      'SELECT * FROM stripe_payout_clearing_components WHERE payout_id = $1 AND zoho_customer_id = $2 AND component = $3 FOR UPDATE',
      [c.payoutId, c.zohoCustomerId, c.component],
    )
    const current = found.rows[0]
    const params = [
      c.zohoRecordType, c.amount, c.currency, c.depositAccountId || null, c.debitAccountId || null,
      c.creditAccountId || null, c.reference, JSON.stringify(c.allocations || []), (c.advanceCaseIds || []).map(Number),
    ]
    if (current && !REPLANNABLE.includes(current.status)) return { component: mapComponent(current), changed: false }
    if (current) {
      const { rows } = await db.query(
        `UPDATE stripe_payout_clearing_components SET
           zoho_record_type = $1, amount = $2, currency = $3, deposit_account_id = $4, debit_account_id = $5,
           credit_account_id = $6, reference = $7, allocations = $8::jsonb, advance_case_ids = $9::bigint[], updated_at = NOW()
         WHERE id = $10 RETURNING *`,
        [...params, current.id],
      )
      return { component: mapComponent(rows[0]), changed: true }
    }
    const { rows } = await db.query(
      `INSERT INTO stripe_payout_clearing_components (
         zoho_record_type, amount, currency, deposit_account_id, debit_account_id, credit_account_id,
         reference, allocations, advance_case_ids, payout_id, zoho_customer_id, component, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::bigint[], $10, $11, $12, $13)
       RETURNING *`,
      [...params, c.payoutId, c.zohoCustomerId, c.component, COMPONENT_STATUS.PLANNED],
    )
    await logEvent(db, {
      entityType: ENTITY.COMPONENT,
      entityId: rows[0].id,
      payoutId: c.payoutId,
      zohoCustomerId: c.zohoCustomerId,
      toStatus: COMPONENT_STATUS.PLANNED,
      detail: `${c.component} ${c.amount} planned (${c.reference}).`,
      actor,
    })
    return { component: mapComponent(rows[0]), changed: true }
  })
}

/** Guarded component status change; `lastError` is only replaced when a new one is given. */
async function transitionComponent(db, id, fromStatuses, toStatus, patch = {}, detail, actor) {
  return inTransaction(db, async () => {
    const found = await db.query('SELECT * FROM stripe_payout_clearing_components WHERE id = $1 FOR UPDATE', [id])
    const current = found.rows[0]
    if (!current || !fromStatuses.includes(current.status)) {
      throw storeError(409, 'COMPONENT_STATE_CONFLICT', `Component ${id} is ${current ? current.status : 'missing'}, not ${fromStatuses.join('/')}; refusing to set ${toStatus}.`)
    }
    const journalId = current.zoho_record_type === 'journal' ? patch.zohoRecordId || null : null
    const { rows } = await db.query(
      `UPDATE stripe_payout_clearing_components SET
         status = $1,
         zoho_record_id = COALESCE($2, zoho_record_id),
         zoho_journal_id = COALESCE($3, zoho_journal_id),
         attempt_count = attempt_count + $4,
         last_error = COALESCE($5, last_error),
         posted_at = COALESCE($6, posted_at),
         verified_at = COALESCE($7, verified_at),
         updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [toStatus, patch.zohoRecordId || null, journalId, patch.incrementAttempt ? 1 : 0, patch.lastError || null, patch.postedAt || null, patch.verifiedAt || null, id],
    )
    await logEvent(db, {
      entityType: ENTITY.COMPONENT,
      entityId: id,
      payoutId: current.payout_id,
      zohoCustomerId: current.zoho_customer_id,
      fromStatus: current.status,
      toStatus,
      detail: detail || patch.lastError,
      actor,
    })
    return mapComponent(rows[0])
  })
}

module.exports = {
  CASE_STATUS,
  REFUND_STATUS,
  COMPONENT_TYPE,
  COMPONENT_STATUS,
  ENTITY,
  SCHEMA_SQL,
  ensureStripePayoutClearingTables,
  listCasesForPayout,
  listCasesByChargeIds,
  confirmCase,
  listComponents,
  upsertPlannedComponent,
  transitionComponent,
  listEvents,
  mapCase,
  mapComponent,
}

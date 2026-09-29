'use strict'

/**
 * Admin-confirmed mappings of a Stripe charge to an existing Zoho invoice:
 * - DIRECT_PAYMENT: the charge never had a website order (e.g. a Payment Link);
 * - REASSIGNED_PAYMENT: the charge paid a website order that was later cancelled without a
 *   refund, and the same funds were reused for a replacement invoice. The original order and
 *   invoice are kept as audit evidence only.
 * - MANUAL_INVOICE_MAPPING: the permanent fallback for any other charge the matcher could not
 *   resolve (missing/wrong PaymentIntent, replacement or migrated order, status mismatch, …).
 *   The matcher's status and reason before the override are kept for audit.
 *
 * One ACTIVE mapping per PaymentIntent, per charge and per Zoho invoice. A mapping is never
 * edited: it is released (kept for audit) and a new one confirmed, and only while no accounting
 * exists for its payout customer. Nothing here talks to Zoho or Stripe.
 */

const MAPPING_TYPE = Object.freeze({
  DIRECT_PAYMENT: 'DIRECT_PAYMENT',
  REASSIGNED_PAYMENT: 'REASSIGNED_PAYMENT',
  MANUAL_INVOICE_MAPPING: 'MANUAL_INVOICE_MAPPING',
})
const MAPPING_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', RELEASED: 'RELEASED' })
const CUSTOMER_KEY = Object.freeze({ WEBSITE: 'WEBSITE', SHOP: 'SHOP' })

// 055: reassigned payments (same statements as migrations/055_stripe_reassigned_payment_mapping.sql).
const REASSIGNED_SCHEMA_SQL = [
  `ALTER TABLE stripe_direct_payment_mappings
     ADD COLUMN IF NOT EXISTS original_order_id TEXT,
     ADD COLUMN IF NOT EXISTS original_order_number TEXT,
     ADD COLUMN IF NOT EXISTS original_order_status TEXT,
     ADD COLUMN IF NOT EXISTS original_invoice_id TEXT,
     ADD COLUMN IF NOT EXISTS original_invoice_number TEXT`,
  // Older databases carry the 054 inline check that allows DIRECT_PAYMENT only.
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'stripe_direct_payment_mappings'::regclass
         AND conname = 'stripe_direct_payment_mappings_mapping_type_check'
         AND pg_get_constraintdef(oid) LIKE '%REASSIGNED_PAYMENT%'
     ) THEN
       ALTER TABLE stripe_direct_payment_mappings DROP CONSTRAINT IF EXISTS stripe_direct_payment_mappings_mapping_type_check;
       ALTER TABLE stripe_direct_payment_mappings
         ADD CONSTRAINT stripe_direct_payment_mappings_mapping_type_check
         CHECK (mapping_type IN ('DIRECT_PAYMENT', 'REASSIGNED_PAYMENT'));
     END IF;
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'stripe_direct_payment_mappings'::regclass
         AND conname = 'ck_stripe_direct_payment_original_order'
     ) THEN
       ALTER TABLE stripe_direct_payment_mappings
         ADD CONSTRAINT ck_stripe_direct_payment_original_order
         CHECK ((mapping_type = 'REASSIGNED_PAYMENT') = (original_order_number IS NOT NULL AND btrim(original_order_number) <> ''));
     END IF;
   END $$`,
]

// 056: manual invoice mappings (same statements as migrations/056_stripe_manual_invoice_mapping.sql).
// The original-order check keeps its 055 name so the 055 statements above stay no-ops.
const MANUAL_SCHEMA_SQL = [
  `ALTER TABLE stripe_direct_payment_mappings
     ADD COLUMN IF NOT EXISTS matcher_status TEXT,
     ADD COLUMN IF NOT EXISTS matcher_reason TEXT`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'stripe_direct_payment_mappings'::regclass
         AND conname = 'stripe_direct_payment_mappings_mapping_type_check'
         AND pg_get_constraintdef(oid) LIKE '%MANUAL_INVOICE_MAPPING%'
     ) THEN
       ALTER TABLE stripe_direct_payment_mappings DROP CONSTRAINT IF EXISTS stripe_direct_payment_mappings_mapping_type_check;
       ALTER TABLE stripe_direct_payment_mappings
         ADD CONSTRAINT stripe_direct_payment_mappings_mapping_type_check
         CHECK (mapping_type IN ('DIRECT_PAYMENT', 'REASSIGNED_PAYMENT', 'MANUAL_INVOICE_MAPPING'));
     END IF;
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'stripe_direct_payment_mappings'::regclass
         AND conname = 'ck_stripe_direct_payment_original_order'
         AND pg_get_constraintdef(oid) LIKE '%DIRECT_PAYMENT%'
     ) THEN
       ALTER TABLE stripe_direct_payment_mappings DROP CONSTRAINT IF EXISTS ck_stripe_direct_payment_original_order;
       ALTER TABLE stripe_direct_payment_mappings
         ADD CONSTRAINT ck_stripe_direct_payment_original_order
         CHECK ((mapping_type <> 'REASSIGNED_PAYMENT' OR (original_order_number IS NOT NULL AND btrim(original_order_number) <> ''))
           AND (mapping_type <> 'DIRECT_PAYMENT' OR original_order_number IS NULL));
     END IF;
   END $$`,
]

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS stripe_direct_payment_mappings (
     id BIGSERIAL PRIMARY KEY,
     stripe_payment_intent_id TEXT NOT NULL CHECK (stripe_payment_intent_id LIKE 'pi\\_%'),
     stripe_charge_id TEXT CHECK (stripe_charge_id IS NULL OR stripe_charge_id LIKE 'ch\\_%'),
     zoho_invoice_id TEXT NOT NULL CHECK (zoho_invoice_id <> ''),
     zoho_invoice_number TEXT NOT NULL CHECK (zoho_invoice_number <> ''),
     zoho_customer_id TEXT NOT NULL CHECK (zoho_customer_id <> ''),
     customer_key VARCHAR(16) NOT NULL CHECK (customer_key IN ('WEBSITE', 'SHOP')),
     payout_id TEXT NOT NULL CHECK (payout_id LIKE 'po\\_%'),
     mapping_type VARCHAR(24) NOT NULL DEFAULT 'DIRECT_PAYMENT' CHECK (mapping_type IN ('DIRECT_PAYMENT')),
     status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
     currency CHAR(3) NOT NULL,
     stripe_gross NUMERIC(14, 2) NOT NULL CHECK (stripe_gross > 0),
     invoice_reference TEXT,
     evidence TEXT,
     reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
     mapped_by TEXT NOT NULL CHECK (mapped_by <> ''),
     mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     released_by TEXT,
     released_at TIMESTAMPTZ,
     release_reason TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT ck_stripe_direct_payment_released
       CHECK ((status = 'RELEASED') = (released_at IS NOT NULL AND released_by IS NOT NULL AND release_reason IS NOT NULL))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_direct_payment_intent_active
     ON stripe_direct_payment_mappings (stripe_payment_intent_id) WHERE status = 'ACTIVE'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_direct_payment_charge_active
     ON stripe_direct_payment_mappings (stripe_charge_id) WHERE status = 'ACTIVE' AND stripe_charge_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_direct_payment_invoice_active
     ON stripe_direct_payment_mappings (zoho_invoice_id) WHERE status = 'ACTIVE'`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_direct_payment_payout
     ON stripe_direct_payment_mappings (payout_id)`,
  ...REASSIGNED_SCHEMA_SQL,
  ...MANUAL_SCHEMA_SQL,
]

async function ensureStripeDirectPaymentTables(query) {
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

function mapMapping(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    paymentIntentId: row.stripe_payment_intent_id,
    chargeId: row.stripe_charge_id || null,
    zohoInvoiceId: row.zoho_invoice_id,
    zohoInvoiceNumber: row.zoho_invoice_number,
    zohoCustomerId: row.zoho_customer_id,
    customerKey: row.customer_key,
    payoutId: row.payout_id,
    mappingType: row.mapping_type,
    status: row.status,
    currency: String(row.currency || '').trim(),
    stripeGross: Number(row.stripe_gross),
    invoiceReference: row.invoice_reference || null,
    evidence: row.evidence || null,
    originalOrderId: row.original_order_id || null,
    originalOrderNumber: row.original_order_number || null,
    originalOrderStatus: row.original_order_status || null,
    originalInvoiceId: row.original_invoice_id || null,
    originalInvoiceNumber: row.original_invoice_number || null,
    matcherStatus: row.matcher_status || null,
    matcherReason: row.matcher_reason || null,
    reason: row.reason,
    mappedBy: row.mapped_by,
    mappedAt: iso(row.mapped_at),
    releasedBy: row.released_by || null,
    releasedAt: iso(row.released_at),
    releaseReason: row.release_reason || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

/** ACTIVE mappings for these PaymentIntents. */
async function listActiveByIntents(db, paymentIntentIds) {
  if (!paymentIntentIds || paymentIntentIds.length === 0) return []
  const { rows } = await db.query(
    `SELECT * FROM stripe_direct_payment_mappings
     WHERE status = 'ACTIVE' AND stripe_payment_intent_id = ANY($1::text[])`,
    [paymentIntentIds],
  )
  return rows.map(mapMapping)
}

/** ACTIVE mapping of one Zoho invoice, if any. */
async function getActiveByInvoice(db, zohoInvoiceId) {
  const { rows } = await db.query(
    `SELECT * FROM stripe_direct_payment_mappings WHERE status = 'ACTIVE' AND zoho_invoice_id = $1`,
    [zohoInvoiceId],
  )
  return mapMapping(rows[0])
}

/** Every mapping (active and released) of one PaymentIntent, newest first, for the audit view. */
async function listHistoryByIntent(db, paymentIntentId) {
  const { rows } = await db.query(
    `SELECT * FROM stripe_direct_payment_mappings WHERE stripe_payment_intent_id = $1 ORDER BY id DESC`,
    [paymentIntentId],
  )
  return rows.map(mapMapping)
}

/**
 * Local payout components that already allocate this invoice or PaymentIntent, in any payout.
 * Allocations are stored as [{ invoiceId, paymentIntentId, amount, … }].
 */
async function listComponentsAllocating(db, { zohoInvoiceId, paymentIntentId }) {
  const params = []
  if (zohoInvoiceId) params.push(JSON.stringify([{ invoiceId: zohoInvoiceId }]))
  if (paymentIntentId) params.push(JSON.stringify([{ paymentIntentId }]))
  if (params.length === 0) return []
  const { rows } = await db.query(
    `SELECT id, payout_id, zoho_customer_id, component, status FROM stripe_payout_clearing_components
     WHERE ${params.map((_, i) => `allocations @> $${i + 1}::jsonb`).join(' OR ')}
     ORDER BY id`,
    params,
  )
  return rows.map((r) => ({ id: Number(r.id), payoutId: r.payout_id, zohoCustomerId: r.zoho_customer_id, component: r.component, status: r.status }))
}

/** Local components of one payout customer (any status): their existence freezes the mapping. */
async function countPayoutCustomerComponents(db, payoutId, zohoCustomerId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS c FROM stripe_payout_clearing_components WHERE payout_id = $1 AND zoho_customer_id = $2`,
    [payoutId, zohoCustomerId],
  )
  return rows[0].c
}

/**
 * Insert one ACTIVE mapping. A second ACTIVE mapping for the same PaymentIntent, charge or
 * invoice is refused by the partial unique indexes and reported as a conflict.
 */
async function insertMapping(db, m) {
  try {
    const { rows } = await db.query(
      `INSERT INTO stripe_direct_payment_mappings (stripe_payment_intent_id, stripe_charge_id, zoho_invoice_id, zoho_invoice_number,
         zoho_customer_id, customer_key, payout_id, mapping_type, currency, stripe_gross, invoice_reference, evidence, reason, mapped_by,
         original_order_id, original_order_number, original_order_status, original_invoice_id, original_invoice_number, matcher_status, matcher_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       RETURNING *`,
      [m.paymentIntentId, m.chargeId || null, m.zohoInvoiceId, m.zohoInvoiceNumber, m.zohoCustomerId, m.customerKey, m.payoutId,
        m.mappingType || MAPPING_TYPE.DIRECT_PAYMENT, m.currency, m.stripeGross, m.invoiceReference || null, m.evidence || null, m.reason, m.mappedBy,
        m.originalOrderId || null, m.originalOrderNumber || null, m.originalOrderStatus || null, m.originalInvoiceId || null, m.originalInvoiceNumber || null,
        m.matcherStatus || null, m.matcherReason || null],
    )
    return mapMapping(rows[0])
  } catch (err) {
    if (err && err.code === '23505') {
      throw storeError(409, 'DIRECT_MAPPING_EXISTS', 'An active Stripe payment mapping already exists for this PaymentIntent, charge or Zoho invoice.')
    }
    throw err
  }
}

/**
 * Release an ACTIVE mapping, only while its payout customer has no local component at all.
 * The check and the update are one statement, so a component created meanwhile wins.
 */
async function releaseMapping(db, id, { actor, reason }) {
  const { rows } = await db.query(
    `UPDATE stripe_direct_payment_mappings m
     SET status = 'RELEASED', released_by = $2, released_at = NOW(), release_reason = $3, updated_at = NOW()
     WHERE m.id = $1 AND m.status = 'ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM stripe_payout_clearing_components c
         WHERE c.payout_id = m.payout_id AND c.zoho_customer_id = m.zoho_customer_id
       )
     RETURNING *`,
    [id, actor, reason],
  )
  if (rows.length === 0) {
    throw storeError(409, 'DIRECT_MAPPING_LOCKED', 'The mapping is not active or accounting already exists for its payout customer; it cannot be released.')
  }
  return mapMapping(rows[0])
}

module.exports = {
  MAPPING_TYPE,
  MAPPING_STATUS,
  CUSTOMER_KEY,
  SCHEMA_SQL,
  ensureStripeDirectPaymentTables,
  listActiveByIntents,
  getActiveByInvoice,
  listHistoryByIntent,
  listComponentsAllocating,
  countPayoutCustomerComponents,
  insertMapping,
  releaseMapping,
  mapMapping,
}

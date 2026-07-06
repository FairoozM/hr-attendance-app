const { query, pool } = require('../db')
const { isNonOrderLinkedAmazonFee } = require('./amazonPaymentClearingCategoryService')
const { isSettlementReturnRow } = require('./amazonPaymentClearingOrderBreakdownService')

async function ensureAmazonPaymentClearingTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_payment_clearing_batches (
      id BIGSERIAL PRIMARY KEY,
      marketplace VARCHAR(16) NOT NULL DEFAULT 'KSA',
      report_id VARCHAR(128),
      report_document_id VARCHAR(256),
      settlement_id VARCHAR(128),
      status VARCHAR(32) NOT NULL DEFAULT 'previewed',
      totals JSONB NOT NULL DEFAULT '{}'::jsonb,
      pivot JSONB NOT NULL DEFAULT '[]'::jsonb,
      settlement_level_fees JSONB NOT NULL DEFAULT '[]'::jsonb,
      non_order_linked_amazon_fee_mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
      refund_return_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
      matched_returns JSONB NOT NULL DEFAULT '[]'::jsonb,
      missing_credit_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
      credit_note_blocking_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
      adjustment_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
      reconciliation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      matched_orders JSONB NOT NULL DEFAULT '[]'::jsonb,
      unmatched_orders JSONB NOT NULL DEFAULT '[]'::jsonb,
      report_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by INTEGER NULL,
      approved_by INTEGER NULL,
      approved_at TIMESTAMPTZ NULL,
      posted_by INTEGER NULL,
      posted_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS settlement_level_fees JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS non_order_linked_amazon_fee_mappings JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS refund_return_rows JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS matched_returns JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS missing_credit_notes JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS credit_note_blocking_rows JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS adjustment_rows JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS reconciliation_summary JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS matched_orders JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS unmatched_orders JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS report_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS approved_by INTEGER NULL`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS posted_by INTEGER NULL`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ NULL`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS all_rows JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS blocking_issues JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS amount_differences JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS posted_to_zoho BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS posting_summary JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS zoho_customer_id VARCHAR(128)`)
  await query(`ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS zoho_customer_name VARCHAR(256)`)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_payment_clearing_rows (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES amazon_payment_clearing_batches(id) ON DELETE CASCADE,
      order_id VARCHAR(128),
      transaction_type VARCHAR(128),
      amount_type VARCHAR(128),
      amount_description TEXT,
      category VARCHAR(128),
      row_class VARCHAR(32),
      amount NUMERIC(16, 4) NOT NULL DEFAULT 0,
      currency VARCHAR(8),
      zoho_invoice_id VARCHAR(128),
      zoho_invoice_number VARCHAR(200),
      zoho_credit_note_id VARCHAR(128),
      zoho_credit_note_number VARCHAR(200),
      credit_note_amount NUMERIC(16, 4),
      credit_note_status VARCHAR(64),
      credit_note_difference NUMERIC(16, 4),
      blocking_reason TEXT,
      match_status VARCHAR(32) NOT NULL DEFAULT 'unmatched',
      raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE amazon_payment_clearing_rows ADD COLUMN IF NOT EXISTS row_class VARCHAR(32)`)
  await query(`ALTER TABLE amazon_payment_clearing_rows ADD COLUMN IF NOT EXISTS zoho_credit_note_id VARCHAR(128)`)
  await query(`ALTER TABLE amazon_payment_clearing_rows ADD COLUMN IF NOT EXISTS zoho_credit_note_number VARCHAR(200)`)
  await query(`ALTER TABLE amazon_payment_clearing_rows ADD COLUMN IF NOT EXISTS credit_note_amount NUMERIC(16, 4)`)
  await query(`ALTER TABLE amazon_payment_clearing_rows ADD COLUMN IF NOT EXISTS credit_note_status VARCHAR(64)`)
  await query(`ALTER TABLE amazon_payment_clearing_rows ADD COLUMN IF NOT EXISTS credit_note_difference NUMERIC(16, 4)`)
  await query(`ALTER TABLE amazon_payment_clearing_rows ADD COLUMN IF NOT EXISTS blocking_reason TEXT`)
  await query(`ALTER TABLE amazon_payment_clearing_rows ADD COLUMN IF NOT EXISTS row_number INTEGER`)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_payment_clearing_audit (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES amazon_payment_clearing_batches(id) ON DELETE CASCADE,
      action VARCHAR(64) NOT NULL,
      reason TEXT,
      actor_user_id INTEGER NULL,
      previous_zoho_payment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_payment_clearing_payment_previews (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES amazon_payment_clearing_batches(id) ON DELETE CASCADE,
      summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      payments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      refund_return_applications_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      adjustment_clearings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      amazon_fee_journal_lines_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'previewed',
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE amazon_payment_clearing_payment_previews ADD COLUMN IF NOT EXISTS refund_return_applications_json JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_payment_previews ADD COLUMN IF NOT EXISTS adjustment_clearings_json JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_payment_previews ADD COLUMN IF NOT EXISTS amazon_fee_journal_lines_json JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_payment_clearing_postings (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES amazon_payment_clearing_batches(id) ON DELETE CASCADE,
      invoice_id VARCHAR(128),
      order_id VARCHAR(128),
      payment_type VARCHAR(64) NOT NULL,
      posting_group_key VARCHAR(128),
      zoho_payment_id VARCHAR(128),
      amount NUMERIC(16, 4) NOT NULL DEFAULT 0,
      account_code VARCHAR(32),
      invoice_allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'posted',
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE amazon_payment_clearing_postings ALTER COLUMN payment_type TYPE VARCHAR(64)`)
  await query(`ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS posting_group_key VARCHAR(128)`)
  await query(`ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS invoice_allocations JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS reference_number VARCHAR(128)`)
  await query(`ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS description TEXT`)
  await query(`ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS zoho_journal_number VARCHAR(128)`)
  await query(`ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS notes TEXT`)
  await query(`ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS mapping_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_payment_clearing_account_mappings (
      account_code VARCHAR(32) PRIMARY KEY,
      account_name TEXT,
      account_id VARCHAR(128) NOT NULL,
      source VARCHAR(128) NOT NULL DEFAULT 'chartofaccounts',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_payment_clearing_fee_journal_mappings (
      id BIGSERIAL PRIMARY KEY,
      marketplace VARCHAR(16) NOT NULL DEFAULT 'KSA',
      normalized_fee_type VARCHAR(64) NOT NULL,
      raw_transaction_type VARCHAR(128),
      description_pattern TEXT,
      debit_account_name TEXT,
      debit_account_id VARCHAR(128),
      credit_account_name TEXT,
      credit_account_id VARCHAR(128),
      is_active BOOLEAN NOT NULL DEFAULT true,
      priority INTEGER NOT NULL DEFAULT 100,
      created_by INTEGER NULL,
      updated_by INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NULL
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_payment_clearing_batches_created
     ON amazon_payment_clearing_batches (created_at DESC)`
  )
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_amz_payment_clearing_batches_report_document
     ON amazon_payment_clearing_batches (marketplace, report_document_id)
     WHERE report_document_id IS NOT NULL AND report_document_id <> ''`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_payment_clearing_batches_settlement
     ON amazon_payment_clearing_batches (marketplace, settlement_id)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_payment_clearing_audit_batch
     ON amazon_payment_clearing_audit (batch_id, created_at DESC)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_payment_clearing_rows_batch
     ON amazon_payment_clearing_rows (batch_id, order_id)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_payment_clearing_payment_previews_batch
     ON amazon_payment_clearing_payment_previews (batch_id, created_at DESC)`
  )
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_amz_payment_clearing_postings_key
     ON amazon_payment_clearing_postings (batch_id, invoice_id, payment_type)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_payment_clearing_postings_batch
     ON amazon_payment_clearing_postings (batch_id, created_at DESC)`
  )
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_amz_payment_clearing_postings_group
     ON amazon_payment_clearing_postings (batch_id, payment_type)
     WHERE posting_group_key IS NOT NULL`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_fee_journal_mappings_lookup
     ON amazon_payment_clearing_fee_journal_mappings (marketplace, normalized_fee_type, is_active, priority DESC)`
  )
  // Collapse any historical duplicate statements down to one per settlement
  // period before any further reads/writes happen.
  await dedupeBatches().catch(() => {})
}

/**
 * Stable key identifying a single settlement period: the Amazon settlement id
 * when present, otherwise the settlement date range, otherwise the row id so
 * unrelated rows are never merged.
 */
const SETTLEMENT_KEY_SQL = `COALESCE(
  NULLIF(settlement_id, ''),
  NULLIF(NULLIF(report_snapshot->>'settlementStartDate', '') || '|' || COALESCE(report_snapshot->>'settlementEndDate', ''), '|'),
  NULLIF(report_document_id, ''),
  'id:' || id::text
)`

/**
 * Keep a single batch per settlement period (per marketplace) and delete the
 * rest. Prefers posted, then approved, then the most recently updated batch.
 * Child rows/previews/postings/audit cascade via ON DELETE CASCADE.
 */
async function dedupeBatches() {
  const result = await query(`
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY marketplace, ${SETTLEMENT_KEY_SQL}
          ORDER BY (status = 'posted' OR posted_to_zoho = true) DESC,
                   (status = 'approved') DESC,
                   updated_at DESC, created_at DESC, id DESC
        ) AS rn
      FROM amazon_payment_clearing_batches
    )
    DELETE FROM amazon_payment_clearing_batches b
    USING ranked r
    WHERE b.id = r.id AND r.rn > 1
  `)
  return result.rowCount || 0
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function safeJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function mapBatch(row) {
  if (!row) return null
  return {
    batchId: row.id == null ? null : Number(row.id),
    marketplace: row.marketplace,
    reportId: row.report_id || '',
    reportDocumentId: row.report_document_id || '',
    settlementId: row.settlement_id || '',
    status: row.status,
    totals: safeJson(row.totals, {}),
    pivot: safeJson(row.pivot, []),
    settlementLevelFees: safeJson(row.settlement_level_fees, []),
    nonOrderLinkedAmazonFeeMappings: safeJson(row.non_order_linked_amazon_fee_mappings, []),
    refundReturnRows: safeJson(row.refund_return_rows, []),
    matchedReturns: safeJson(row.matched_returns, []),
    missingCreditNotes: safeJson(row.missing_credit_notes, []),
    creditNoteBlockingRows: safeJson(row.credit_note_blocking_rows, []),
    adjustmentRows: safeJson(row.adjustment_rows, []),
    reconciliationSummary: safeJson(row.reconciliation_summary, {}),
    matchedOrders: safeJson(row.matched_orders, []),
    unmatchedOrders: safeJson(row.unmatched_orders, []),
    allRows: safeJson(row.all_rows, []),
    blockingIssues: safeJson(row.blocking_issues, []),
    amountDifferences: safeJson(row.amount_differences, []),
    report: safeJson(row.report_snapshot, {}),
    warnings: safeJson(row.warnings, []),
    zohoCustomerId: row.zoho_customer_id || '',
    zohoCustomerName: row.zoho_customer_name || '',
    postedToZoho: row.posted_to_zoho === true || row.posted_to_zoho === 't',
    postingSummary: safeJson(row.posting_summary, {}),
    createdBy: row.created_by == null ? null : Number(row.created_by),
    approvedBy: row.approved_by == null ? null : Number(row.approved_by),
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    postedBy: row.posted_by == null ? null : Number(row.posted_by),
    postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

function mapPosting(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    batchId: Number(row.batch_id),
    invoiceId: row.invoice_id || '',
    orderId: row.order_id || '',
    paymentType: row.payment_type || '',
    postingGroupKey: row.posting_group_key || '',
    zohoPaymentId: row.zoho_payment_id || '',
    amount: num(row.amount),
    accountCode: row.account_code || '',
    invoiceAllocations: safeJson(row.invoice_allocations, []),
    referenceNumber: row.reference_number || '',
    description: row.description || '',
    zohoJournalNumber: row.zoho_journal_number || '',
    notes: row.notes || '',
    mappingSnapshot: safeJson(row.mapping_snapshot, {}),
    status: row.status || '',
    errorMessage: row.error_message || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

function mapFeeJournalMapping(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    marketplace: row.marketplace || 'KSA',
    normalizedFeeType: row.normalized_fee_type || '',
    rawTransactionType: row.raw_transaction_type || '',
    descriptionPattern: row.description_pattern || '',
    debitAccountName: row.debit_account_name || '',
    debitAccountId: row.debit_account_id || '',
    creditAccountName: row.credit_account_name || '',
    creditAccountId: row.credit_account_id || '',
    isActive: row.is_active === true || row.is_active === 't',
    priority: num(row.priority),
    createdBy: row.created_by == null ? null : Number(row.created_by),
    updatedBy: row.updated_by == null ? null : Number(row.updated_by),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  }
}

async function insertClearingRows(client, batchId, preview, rows, report) {
  const invoiceByOrder = new Map()
  for (const order of preview.matchedOrders || []) {
    invoiceByOrder.set(order.orderId, order)
  }
  let rowNumber = 0
  for (const row of Array.isArray(rows) ? rows : []) {
    rowNumber += 1
    const isReturnRow = isSettlementReturnRow(row)
    const order = !isReturnRow && row.orderId ? invoiceByOrder.get(row.orderId) : null
    const creditNoteRow = (preview.matchedReturns || preview.missingCreditNotes || []).find(
      (candidate) =>
        candidate.orderId === row.orderId &&
        candidate.amountType === row.amountType &&
        candidate.amountDescription === row.amountDescription &&
        num(candidate.amazonRefundAmount) === Math.abs(num(row.amount))
    )
    await client.query(
      `INSERT INTO amazon_payment_clearing_rows (
        batch_id, row_number, order_id, transaction_type, amount_type, amount_description,
        category, row_class, amount, currency, zoho_invoice_id, zoho_invoice_number,
        zoho_credit_note_id, zoho_credit_note_number, credit_note_amount,
        credit_note_status, credit_note_difference, blocking_reason,
        match_status, raw_row, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,NOW())`,
      [
        batchId,
        rowNumber,
        row.orderId || null,
        row.transactionType || null,
        row.amountType || null,
        row.amountDescription || null,
        row.category || null,
        isNonOrderLinkedAmazonFee(row) ? 'NON_ORDER_LINKED_AMAZON_FEE' : (row.rowClass || null),
        num(row.amount),
        row.currency || report.currency || 'SAR',
        creditNoteRow?.zohoInvoiceId || order?.zohoInvoiceId || null,
        creditNoteRow?.zohoInvoiceNumber || order?.zohoInvoiceNumber || null,
        creditNoteRow?.zohoCreditNoteId || null,
        creditNoteRow?.zohoCreditNoteNumber || null,
        creditNoteRow?.creditNoteAmount == null ? null : num(creditNoteRow.creditNoteAmount),
        creditNoteRow?.creditNoteStatus || null,
        creditNoteRow?.creditNoteDifference == null ? null : num(creditNoteRow.creditNoteDifference),
        creditNoteRow?.blockingReason || null,
        creditNoteRow
          ? creditNoteRow.status
          : isReturnRow
            ? 'review'
            : order
              ? order.matchType || 'matched'
              : isNonOrderLinkedAmazonFee(row)
                ? 'account_level_fee'
                : row.orderId
                  ? 'unmatched'
                  : 'missing_order_id',
        JSON.stringify(row.originalRawRow || row),
      ]
    )
  }
}

function batchColumnValues(preview, createdBy) {
  const report = preview.report || {}
  return [
    preview.marketplace || 'KSA',
    report.reportId || null,
    report.reportDocumentId || null,
    report.settlementId || null,
    JSON.stringify(preview.totals || {}),
    JSON.stringify(preview.pivot || []),
    JSON.stringify(preview.settlementLevelFees || []),
    JSON.stringify(preview.nonOrderLinkedAmazonFeeMappings || []),
    JSON.stringify(preview.refundReturnRows || []),
    JSON.stringify(preview.matchedReturns || []),
    JSON.stringify(preview.missingCreditNotes || []),
    JSON.stringify(preview.creditNoteBlockingRows || []),
    JSON.stringify(preview.adjustmentRows || []),
    JSON.stringify(preview.reconciliationSummary || {}),
    JSON.stringify(preview.matchedOrders || []),
    JSON.stringify(preview.unmatchedOrders || []),
    JSON.stringify(preview.allRows || []),
    JSON.stringify(preview.blockingIssues || []),
    JSON.stringify(preview.amountDifferences || []),
    JSON.stringify(preview.report || {}),
    JSON.stringify(preview.warnings || []),
    preview.zohoCustomerId || null,
    preview.zohoCustomerName || null,
    createdBy == null ? null : Number(createdBy),
  ]
}

async function savePreviewBatch({ preview, rows, createdBy, existingBatchId = null }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const report = preview.report || {}
    let batchResult
    if (existingBatchId != null) {
      batchResult = await client.query(
        `UPDATE amazon_payment_clearing_batches SET
          marketplace = $1, report_id = $2, report_document_id = $3, settlement_id = $4,
          status = 'previewed', totals = $5::jsonb, pivot = $6::jsonb, settlement_level_fees = $7::jsonb,
          non_order_linked_amazon_fee_mappings = $8::jsonb,
          refund_return_rows = $9::jsonb, matched_returns = $10::jsonb, missing_credit_notes = $11::jsonb,
          credit_note_blocking_rows = $12::jsonb, adjustment_rows = $13::jsonb, reconciliation_summary = $14::jsonb,
          matched_orders = $15::jsonb, unmatched_orders = $16::jsonb, all_rows = $17::jsonb,
          blocking_issues = $18::jsonb, amount_differences = $19::jsonb, report_snapshot = $20::jsonb,
          warnings = $21::jsonb, zoho_customer_id = $22, zoho_customer_name = $23,
          created_by = COALESCE($24, created_by),
          approved_by = NULL, approved_at = NULL, posted_by = NULL, posted_at = NULL,
          posted_to_zoho = false, posting_summary = '{}'::jsonb, updated_at = NOW()
        WHERE id = $25
        RETURNING *`,
        [...batchColumnValues(preview, createdBy), Number(existingBatchId)]
      )
      await client.query(`DELETE FROM amazon_payment_clearing_rows WHERE batch_id = $1`, [Number(existingBatchId)])
    } else {
      batchResult = await client.query(
        `INSERT INTO amazon_payment_clearing_batches (
          marketplace, report_id, report_document_id, settlement_id, status,
          totals, pivot, settlement_level_fees, non_order_linked_amazon_fee_mappings, refund_return_rows, matched_returns,
          missing_credit_notes, credit_note_blocking_rows, adjustment_rows, reconciliation_summary,
          matched_orders, unmatched_orders, all_rows, blocking_issues, amount_differences,
          report_snapshot, warnings, zoho_customer_id, zoho_customer_name, created_by, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,'previewed',$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22,$23,$24,NOW(),NOW())
        RETURNING *`,
        batchColumnValues(preview, createdBy)
      )
    }
    const batchId = Number(batchResult.rows[0].id)
    await insertClearingRows(client, batchId, preview, rows, report)
    await client.query('COMMIT')
    return mapBatch(batchResult.rows[0])
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

function mapStoredRow(row) {
  return {
    rowNumber: row.row_number == null ? null : Number(row.row_number),
    orderId: row.order_id || '',
    transactionType: row.transaction_type || '',
    amountType: row.amount_type || '',
    amountDescription: row.amount_description || '',
    category: row.category || '',
    rowClass: row.row_class || '',
    amount: num(row.amount),
    currency: row.currency || '',
    zohoInvoiceId: row.zoho_invoice_id || '',
    zohoInvoiceNumber: row.zoho_invoice_number || '',
    zohoCreditNoteId: row.zoho_credit_note_id || '',
    zohoCreditNoteNumber: row.zoho_credit_note_number || '',
    creditNoteAmount: row.credit_note_amount == null ? null : num(row.credit_note_amount),
    creditNoteStatus: row.credit_note_status || '',
    creditNoteDifference: row.credit_note_difference == null ? null : num(row.credit_note_difference),
    blockingReason: row.blocking_reason || '',
    matchStatus: row.match_status || '',
    rawRow: safeJson(row.raw_row, {}),
  }
}

async function listRowsForBatch(batchId) {
  const result = await query(
    `SELECT * FROM amazon_payment_clearing_rows
     WHERE batch_id = $1
     ORDER BY row_number ASC NULLS LAST, id ASC`,
    [Number(batchId)]
  )
  return result.rows.map(mapStoredRow)
}

async function updateRowsMatchStatus(batchId, rowNumbers, matchStatus) {
  const ids = (Array.isArray(rowNumbers) ? rowNumbers : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (!ids.length) return 0
  const result = await query(
    `UPDATE amazon_payment_clearing_rows
     SET match_status = $3,
         row_class = CASE WHEN $3 = 'account_level_fee' THEN 'NON_ORDER_LINKED_AMAZON_FEE' ELSE row_class END,
         blocking_reason = CASE
           WHEN $3 = 'account_level_fee' THEN 'Order ID not required for this Amazon fee.'
           ELSE blocking_reason
         END
     WHERE batch_id = $1 AND row_number = ANY($2::int[])`,
    [Number(batchId), ids, String(matchStatus)]
  )
  return result.rowCount || 0
}

async function updateBatchPreviewSnapshot(batchId, preview) {
  const result = await query(
    `UPDATE amazon_payment_clearing_batches SET
      totals = $1::jsonb,
      pivot = $2::jsonb,
      settlement_level_fees = $3::jsonb,
      non_order_linked_amazon_fee_mappings = $4::jsonb,
      refund_return_rows = $5::jsonb,
      matched_returns = $6::jsonb,
      missing_credit_notes = $7::jsonb,
      credit_note_blocking_rows = $8::jsonb,
      adjustment_rows = $9::jsonb,
      reconciliation_summary = $10::jsonb,
      matched_orders = $11::jsonb,
      unmatched_orders = $12::jsonb,
      all_rows = $13::jsonb,
      blocking_issues = $14::jsonb,
      amount_differences = $15::jsonb,
      warnings = $16::jsonb,
      updated_at = NOW()
    WHERE id = $17
    RETURNING *`,
    [
      JSON.stringify(preview.totals || {}),
      JSON.stringify(preview.pivot || []),
      JSON.stringify(preview.settlementLevelFees || []),
      JSON.stringify(preview.nonOrderLinkedAmazonFeeMappings || []),
      JSON.stringify(preview.refundReturnRows || []),
      JSON.stringify(preview.matchedReturns || []),
      JSON.stringify(preview.missingCreditNotes || []),
      JSON.stringify(preview.creditNoteBlockingRows || []),
      JSON.stringify(preview.adjustmentRows || []),
      JSON.stringify(preview.reconciliationSummary || {}),
      JSON.stringify(preview.matchedOrders || []),
      JSON.stringify(preview.unmatchedOrders || []),
      JSON.stringify(preview.allRows || []),
      JSON.stringify(preview.blockingIssues || []),
      JSON.stringify(preview.amountDifferences || []),
      JSON.stringify(preview.warnings || []),
      Number(batchId),
    ]
  )
  return mapBatch(result.rows[0])
}

async function findBatchByReport({ reportId, reportDocumentId, settlementId, marketplace = 'KSA' } = {}) {
  const docId = reportDocumentId == null ? '' : String(reportDocumentId).trim()
  if (docId) {
    const result = await query(
      `SELECT * FROM amazon_payment_clearing_batches
       WHERE marketplace = $1 AND report_document_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [marketplace, docId]
    )
    if (result.rows[0]) return mapBatch(result.rows[0])
  }
  const rid = reportId == null ? '' : String(reportId).trim()
  if (rid) {
    const result = await query(
      `SELECT * FROM amazon_payment_clearing_batches
       WHERE marketplace = $1 AND report_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [marketplace, rid]
    )
    if (result.rows[0]) return mapBatch(result.rows[0])
  }
  const sid = settlementId == null ? '' : String(settlementId).trim()
  if (sid) {
    const result = await query(
      `SELECT * FROM amazon_payment_clearing_batches
       WHERE marketplace = $1 AND settlement_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [marketplace, sid]
    )
    if (result.rows[0]) return mapBatch(result.rows[0])
  }
  return null
}

/**
 * Find the single saved batch for an Amazon settlement id, preferring posted,
 * then approved, then the most recently updated. Used to reuse one statement
 * per settlement period even when Amazon issues a fresh report id/document id.
 */
async function findBatchBySettlement(settlementId, marketplace = 'KSA') {
  const sid = settlementId == null ? '' : String(settlementId).trim()
  if (!sid) return null
  const result = await query(
    `SELECT * FROM amazon_payment_clearing_batches
     WHERE marketplace = $1 AND settlement_id = $2
     ORDER BY (status = 'posted' OR posted_to_zoho = true) DESC,
              (status = 'approved') DESC,
              updated_at DESC, id DESC
     LIMIT 1`,
    [marketplace, sid]
  )
  return mapBatch(result.rows[0])
}

async function insertClearingAudit({ batchId, action, reason, actorUserId, previousZohoPaymentIds = [], details = {} }) {
  const result = await query(
    `INSERT INTO amazon_payment_clearing_audit (
      batch_id, action, reason, actor_user_id, previous_zoho_payment_ids, details, created_at
    ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,NOW())
    RETURNING id, created_at`,
    [
      Number(batchId),
      String(action),
      reason || null,
      actorUserId == null ? null : Number(actorUserId),
      JSON.stringify(Array.isArray(previousZohoPaymentIds) ? previousZohoPaymentIds : []),
      JSON.stringify(details || {}),
    ]
  )
  return {
    auditId: Number(result.rows[0].id),
    createdAt: result.rows[0].created_at ? new Date(result.rows[0].created_at).toISOString() : null,
  }
}

async function listClearingAudit(batchId) {
  const result = await query(
    `SELECT * FROM amazon_payment_clearing_audit WHERE batch_id = $1 ORDER BY created_at DESC, id DESC`,
    [Number(batchId)]
  )
  return result.rows.map((row) => ({
    id: Number(row.id),
    batchId: Number(row.batch_id),
    action: row.action || '',
    reason: row.reason || '',
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    previousZohoPaymentIds: safeJson(row.previous_zoho_payment_ids, []),
    details: safeJson(row.details, {}),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }))
}

async function clearPostingsForBatch(batchId) {
  await query(`DELETE FROM amazon_payment_clearing_postings WHERE batch_id = $1`, [Number(batchId)])
}

async function listRecentBatches(limit = 10) {
  const n = Math.min(50, Math.max(1, Number(limit) || 10))
  const result = await query(
    `SELECT * FROM amazon_payment_clearing_batches ORDER BY created_at DESC LIMIT $1`,
    [n]
  )
  return result.rows.map(mapBatch)
}

async function getBatchById(id) {
  const result = await query(
    `SELECT * FROM amazon_payment_clearing_batches WHERE id = $1`,
    [Number(id)]
  )
  return mapBatch(result.rows[0])
}

async function approveBatch(id, approvedBy) {
  const existing = await getBatchById(id)
  if (!existing) {
    const err = new Error('Payment clearing batch not found.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_NOT_FOUND'
    err.status = 404
    throw err
  }
  if (existing.status === 'posted') {
    const err = new Error('Settlement has already been posted.')
    err.code = 'AMAZON_PAYMENT_CLEARING_BATCH_ALREADY_POSTED'
    err.status = 409
    throw err
  }
  if (existing.status === 'approved') {
    return existing
  }
  const result = await query(
    `UPDATE amazon_payment_clearing_batches
     SET status = 'approved',
         approved_by = $2,
         approved_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND status <> 'approved'
     RETURNING *`,
    [Number(id), approvedBy == null ? null : Number(approvedBy)]
  )
  return mapBatch(result.rows[0])
}

async function savePaymentPreview({ batchId, preview, createdBy }) {
  const result = await query(
    `INSERT INTO amazon_payment_clearing_payment_previews (
      batch_id, summary_json, payments_json, refund_return_applications_json,
      adjustment_clearings_json, amazon_fee_journal_lines_json, status, created_by, created_at
    ) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,NOW())
    RETURNING id, created_at`,
    [
      Number(batchId),
      JSON.stringify(preview.paymentPlanSummary || {}),
      JSON.stringify(preview.payments || []),
      JSON.stringify(preview.refundReturnCreditNoteApplications || []),
      JSON.stringify(preview.adjustmentClearings || []),
      JSON.stringify(preview.amazonFeeJournalLines || []),
      preview.status || 'previewed',
      createdBy == null ? null : Number(createdBy),
    ]
  )
  return {
    paymentPreviewId: Number(result.rows[0].id),
    createdAt: result.rows[0].created_at ? new Date(result.rows[0].created_at).toISOString() : null,
  }
}

async function getLatestPaymentPreviewForBatch(batchId) {
  const result = await query(
    `SELECT *
     FROM amazon_payment_clearing_payment_previews
     WHERE batch_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [Number(batchId)]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    paymentPreviewId: Number(row.id),
    batchId: Number(row.batch_id),
    paymentPlanSummary: safeJson(row.summary_json, {}),
    payments: safeJson(row.payments_json, []),
    refundReturnCreditNoteApplications: safeJson(row.refund_return_applications_json, []),
    adjustmentClearings: safeJson(row.adjustment_clearings_json, []),
    amazonFeeJournalLines: safeJson(row.amazon_fee_journal_lines_json, []),
    status: row.status || '',
    createdBy: row.created_by == null ? null : Number(row.created_by),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

async function getAccountMappings() {
  const result = await query(
    `SELECT account_code, account_name, account_id, source, updated_at
     FROM amazon_payment_clearing_account_mappings
     ORDER BY account_code ASC`
  )
  return result.rows.map((row) => ({
    accountCode: row.account_code,
    accountName: row.account_name || '',
    accountId: row.account_id || '',
    source: row.source || '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }))
}

async function getAccountMappingByCode(accountCode) {
  const result = await query(
    `SELECT account_code, account_name, account_id, source, updated_at
     FROM amazon_payment_clearing_account_mappings
     WHERE account_code = $1`,
    [String(accountCode)]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    accountCode: row.account_code,
    accountName: row.account_name || '',
    accountId: row.account_id || '',
    source: row.source || '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

async function upsertAccountMapping({ accountCode, accountName, accountId, source }) {
  const result = await query(
    `INSERT INTO amazon_payment_clearing_account_mappings (
      account_code, account_name, account_id, source, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,NOW(),NOW())
    ON CONFLICT (account_code) DO UPDATE
    SET account_name = EXCLUDED.account_name,
        account_id = EXCLUDED.account_id,
        source = EXCLUDED.source,
        updated_at = NOW()
    RETURNING account_code, account_name, account_id, source, updated_at`,
    [String(accountCode), accountName || null, String(accountId), source || 'chartofaccounts']
  )
  const row = result.rows[0]
  return {
    accountCode: row.account_code,
    accountName: row.account_name || '',
    accountId: row.account_id || '',
    source: row.source || '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

async function listFeeJournalMappings({ marketplace = 'KSA', includeInactive = false } = {}) {
  const result = await query(
    `SELECT *
     FROM amazon_payment_clearing_fee_journal_mappings
     WHERE marketplace = $1
       AND ($2::boolean = true OR is_active = true)
     ORDER BY normalized_fee_type ASC, priority DESC, id ASC`,
    [String(marketplace || 'KSA').toUpperCase(), Boolean(includeInactive)]
  )
  return result.rows.map(mapFeeJournalMapping)
}

async function upsertFeeJournalMapping(mapping = {}) {
  const id = mapping.id == null ? null : Number(mapping.id)
  const values = [
    String(mapping.marketplace || 'KSA').toUpperCase(),
    String(mapping.normalizedFeeType || '').trim(),
    mapping.rawTransactionType ? String(mapping.rawTransactionType).trim() : null,
    mapping.descriptionPattern ? String(mapping.descriptionPattern).trim() : null,
    mapping.debitAccountName ? String(mapping.debitAccountName).trim() : null,
    mapping.debitAccountId ? String(mapping.debitAccountId).trim() : null,
    mapping.creditAccountName ? String(mapping.creditAccountName).trim() : null,
    mapping.creditAccountId ? String(mapping.creditAccountId).trim() : null,
    mapping.isActive !== false,
    Number(mapping.priority) || 100,
    mapping.actorUserId == null ? null : Number(mapping.actorUserId),
  ]
  if (id) {
    const result = await query(
      `UPDATE amazon_payment_clearing_fee_journal_mappings
       SET marketplace = $1,
           normalized_fee_type = $2,
           raw_transaction_type = $3,
           description_pattern = $4,
           debit_account_name = $5,
           debit_account_id = $6,
           credit_account_name = $7,
           credit_account_id = $8,
           is_active = $9,
           priority = $10,
           updated_by = $11,
           updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [...values, id]
    )
    return mapFeeJournalMapping(result.rows[0])
  }
  const result = await query(
    `INSERT INTO amazon_payment_clearing_fee_journal_mappings (
      marketplace, normalized_fee_type, raw_transaction_type, description_pattern,
      debit_account_name, debit_account_id, credit_account_name, credit_account_id,
      is_active, priority, created_by, updated_by, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,NOW(),NOW())
    RETURNING *`,
    values
  )
  return mapFeeJournalMapping(result.rows[0])
}

async function markFeeJournalMappingsUsed(ids = []) {
  const cleanIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean)))
  if (!cleanIds.length) return 0
  const result = await query(
    `UPDATE amazon_payment_clearing_fee_journal_mappings
     SET last_used_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::bigint[])`,
    [cleanIds]
  )
  return result.rowCount || 0
}

async function listPostingsForBatch(batchId) {
  const result = await query(
    `SELECT * FROM amazon_payment_clearing_postings WHERE batch_id = $1 ORDER BY created_at ASC, id ASC`,
    [Number(batchId)]
  )
  return result.rows.map(mapPosting)
}

async function findPosting(batchId, invoiceId, paymentType) {
  const result = await query(
    `SELECT * FROM amazon_payment_clearing_postings
     WHERE batch_id = $1 AND invoice_id = $2 AND payment_type = $3
     LIMIT 1`,
    [Number(batchId), String(invoiceId), String(paymentType)]
  )
  return mapPosting(result.rows[0])
}

async function findGroupedPosting(batchId, paymentType) {
  const result = await query(
    `SELECT * FROM amazon_payment_clearing_postings
     WHERE batch_id = $1 AND payment_type = $2 AND posting_group_key IS NOT NULL
     LIMIT 1`,
    [Number(batchId), String(paymentType)]
  )
  return mapPosting(result.rows[0])
}

async function insertPosting(row) {
  const result = await query(
    `INSERT INTO amazon_payment_clearing_postings (
      batch_id, invoice_id, order_id, payment_type, posting_group_key, zoho_payment_id,
      amount, account_code, invoice_allocations, reference_number, description,
      zoho_journal_number, notes, mapping_snapshot, status, error_message, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16,NOW())
    ON CONFLICT (batch_id, invoice_id, payment_type) DO NOTHING
    RETURNING *`,
    [
      Number(row.batchId),
      row.invoiceId ? String(row.invoiceId) : null,
      row.orderId || null,
      String(row.paymentType),
      row.postingGroupKey || null,
      row.zohoPaymentId || null,
      num(row.amount),
      row.accountCode || null,
      JSON.stringify(row.invoiceAllocations || []),
      row.referenceNumber || null,
      row.description || null,
      row.zohoJournalNumber || null,
      row.notes || null,
      JSON.stringify(row.mappingSnapshot || {}),
      row.status || 'posted',
      row.errorMessage || null,
    ]
  )
  if (result.rows[0]) return mapPosting(result.rows[0])
  if (row.postingGroupKey) return findGroupedPosting(row.batchId, row.paymentType)
  return findPosting(row.batchId, row.invoiceId, row.paymentType)
}

async function markBatchPosted(batchId, postedBy, postingSummary = null) {
  const result = await query(
    `UPDATE amazon_payment_clearing_batches
     SET status = 'posted',
         posted_to_zoho = true,
         posted_by = $2,
         posted_at = NOW(),
         posting_summary = COALESCE($3::jsonb, posting_summary),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      Number(batchId),
      postedBy == null ? null : Number(postedBy),
      postingSummary == null ? null : JSON.stringify(postingSummary),
    ]
  )
  return mapBatch(result.rows[0])
}

async function withBatchPostingLock(batchId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [Number(batchId)])
    const result = await fn()
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  ensureAmazonPaymentClearingTables,
  savePreviewBatch,
  listRecentBatches,
  getBatchById,
  listRowsForBatch,
  updateRowsMatchStatus,
  updateBatchPreviewSnapshot,
  findBatchByReport,
  findBatchBySettlement,
  dedupeBatches,
  insertClearingAudit,
  listClearingAudit,
  clearPostingsForBatch,
  approveBatch,
  savePaymentPreview,
  getLatestPaymentPreviewForBatch,
  getAccountMappings,
  getAccountMappingByCode,
  upsertAccountMapping,
  listFeeJournalMappings,
  upsertFeeJournalMapping,
  markFeeJournalMappingsUsed,
  listPostingsForBatch,
  findPosting,
  findGroupedPosting,
  insertPosting,
  markBatchPosted,
  withBatchPostingLock,
}

const { query, pool } = require('../db')

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
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_payment_clearing_payment_previews (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES amazon_payment_clearing_batches(id) ON DELETE CASCADE,
      summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      payments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      refund_return_applications_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      adjustment_clearings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'previewed',
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE amazon_payment_clearing_payment_previews ADD COLUMN IF NOT EXISTS refund_return_applications_json JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`ALTER TABLE amazon_payment_clearing_payment_previews ADD COLUMN IF NOT EXISTS adjustment_clearings_json JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_payment_clearing_postings (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES amazon_payment_clearing_batches(id) ON DELETE CASCADE,
      invoice_id VARCHAR(128),
      order_id VARCHAR(128),
      payment_type VARCHAR(32) NOT NULL,
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
  await query(`ALTER TABLE amazon_payment_clearing_postings ALTER COLUMN invoice_id DROP NOT NULL`)
  await query(`ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS posting_group_key VARCHAR(128)`)
  await query(`ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS invoice_allocations JSONB NOT NULL DEFAULT '[]'::jsonb`)
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
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_payment_clearing_batches_created
     ON amazon_payment_clearing_batches (created_at DESC)`
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
    refundReturnRows: safeJson(row.refund_return_rows, []),
    matchedReturns: safeJson(row.matched_returns, []),
    missingCreditNotes: safeJson(row.missing_credit_notes, []),
    creditNoteBlockingRows: safeJson(row.credit_note_blocking_rows, []),
    adjustmentRows: safeJson(row.adjustment_rows, []),
    reconciliationSummary: safeJson(row.reconciliation_summary, {}),
    matchedOrders: safeJson(row.matched_orders, []),
    unmatchedOrders: safeJson(row.unmatched_orders, []),
    report: safeJson(row.report_snapshot, {}),
    warnings: safeJson(row.warnings, []),
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
    status: row.status || '',
    errorMessage: row.error_message || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

async function savePreviewBatch({ preview, rows, createdBy }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const report = preview.report || {}
    const batchResult = await client.query(
      `INSERT INTO amazon_payment_clearing_batches (
        marketplace, report_id, report_document_id, settlement_id, status,
        totals, pivot, settlement_level_fees, refund_return_rows, matched_returns,
        missing_credit_notes, credit_note_blocking_rows, adjustment_rows, reconciliation_summary,
        matched_orders, unmatched_orders, report_snapshot, warnings, created_by, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,'previewed',$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,NOW(),NOW())
      RETURNING *`,
      [
        preview.marketplace || 'KSA',
        report.reportId || null,
        report.reportDocumentId || null,
        report.settlementId || null,
        JSON.stringify(preview.totals || {}),
        JSON.stringify(preview.pivot || []),
        JSON.stringify(preview.settlementLevelFees || []),
        JSON.stringify(preview.refundReturnRows || []),
        JSON.stringify(preview.matchedReturns || []),
        JSON.stringify(preview.missingCreditNotes || []),
        JSON.stringify(preview.creditNoteBlockingRows || []),
        JSON.stringify(preview.adjustmentRows || []),
        JSON.stringify(preview.reconciliationSummary || {}),
        JSON.stringify(preview.matchedOrders || []),
        JSON.stringify(preview.unmatchedOrders || []),
        JSON.stringify(preview.report || {}),
        JSON.stringify(preview.warnings || []),
        createdBy == null ? null : Number(createdBy),
      ]
    )
    const batchId = Number(batchResult.rows[0].id)
    const invoiceByOrder = new Map()
    for (const order of preview.matchedOrders || []) {
      invoiceByOrder.set(order.orderId, order)
    }
    for (const row of Array.isArray(rows) ? rows : []) {
      const order = row.orderId ? invoiceByOrder.get(row.orderId) : null
      const creditNoteRow = (preview.matchedReturns || preview.missingCreditNotes || []).find(
        (candidate) =>
          candidate.orderId === row.orderId &&
          candidate.amountType === row.amountType &&
          candidate.amountDescription === row.amountDescription &&
          num(candidate.amazonRefundAmount) === Math.abs(num(row.amount))
      )
      await client.query(
        `INSERT INTO amazon_payment_clearing_rows (
          batch_id, order_id, transaction_type, amount_type, amount_description,
          category, row_class, amount, currency, zoho_invoice_id, zoho_invoice_number,
          zoho_credit_note_id, zoho_credit_note_number, credit_note_amount,
          credit_note_status, credit_note_difference, blocking_reason,
          match_status, raw_row, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,NOW())`,
        [
          batchId,
          row.orderId || null,
          row.transactionType || null,
          row.amountType || null,
          row.amountDescription || null,
          row.category || null,
          row.rowClass || null,
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
          creditNoteRow ? creditNoteRow.status : order ? order.matchType || 'matched' : row.orderId ? 'unmatched' : 'missing_order_id',
          JSON.stringify(row.originalRawRow || row),
        ]
      )
    }
    await client.query('COMMIT')
    return mapBatch(batchResult.rows[0])
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
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
      adjustment_clearings_json, status, created_by, created_at
    ) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,NOW())
    RETURNING id, created_at`,
    [
      Number(batchId),
      JSON.stringify(preview.paymentPlanSummary || {}),
      JSON.stringify(preview.payments || []),
      JSON.stringify(preview.refundReturnCreditNoteApplications || []),
      JSON.stringify(preview.adjustmentClearings || []),
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
      amount, account_code, invoice_allocations, status, error_message, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NOW())
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
      row.status || 'posted',
      row.errorMessage || null,
    ]
  )
  if (result.rows[0]) return mapPosting(result.rows[0])
  if (row.postingGroupKey) return findGroupedPosting(row.batchId, row.paymentType)
  return findPosting(row.batchId, row.invoiceId, row.paymentType)
}

async function markBatchPosted(batchId, postedBy) {
  const result = await query(
    `UPDATE amazon_payment_clearing_batches
     SET status = 'posted',
         posted_by = $2,
         posted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [Number(batchId), postedBy == null ? null : Number(postedBy)]
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
  approveBatch,
  savePaymentPreview,
  getLatestPaymentPreviewForBatch,
  getAccountMappings,
  getAccountMappingByCode,
  upsertAccountMapping,
  listPostingsForBatch,
  findPosting,
  findGroupedPosting,
  insertPosting,
  markBatchPosted,
  withBatchPostingLock,
}

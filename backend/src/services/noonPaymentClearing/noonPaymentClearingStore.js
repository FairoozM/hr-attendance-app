const { query, pool } = require('../../db')

async function ensureNoonPaymentClearingTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS noon_payment_clearing_batches (
      id BIGSERIAL PRIMARY KEY,
      marketplace VARCHAR(16) NOT NULL DEFAULT 'AE',
      reference_nr VARCHAR(128),
      contract VARCHAR(128),
      contract_type VARCHAR(64),
      status VARCHAR(32) NOT NULL DEFAULT 'previewed',
      totals JSONB NOT NULL DEFAULT '{}'::jsonb,
      hierarchy JSONB NOT NULL DEFAULT '{}'::jsonb,
      reconciliation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      matched_orders JSONB NOT NULL DEFAULT '[]'::jsonb,
      unmatched_orders JSONB NOT NULL DEFAULT '[]'::jsonb,
      multiple_match_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      parent_charges JSONB NOT NULL DEFAULT '[]'::jsonb,
      adjustments JSONB NOT NULL DEFAULT '[]'::jsonb,
      statement_fees JSONB NOT NULL DEFAULT '[]'::jsonb,
      fee_journal_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
      all_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
      blocking_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
      report_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      zoho_customer_id VARCHAR(128),
      zoho_customer_name VARCHAR(256),
      posted_to_zoho BOOLEAN NOT NULL DEFAULT false,
      posting_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER NULL,
      approved_by INTEGER NULL,
      approved_at TIMESTAMPTZ NULL,
      posted_by INTEGER NULL,
      posted_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS noon_payment_clearing_rows (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES noon_payment_clearing_batches(id) ON DELETE CASCADE,
      row_number INTEGER,
      parent_order_id VARCHAR(128),
      item_order_id VARCHAR(128),
      order_nr VARCHAR(128),
      item_nr VARCHAR(128),
      sku VARCHAR(128),
      partner_sku VARCHAR(128),
      transaction_type VARCHAR(64),
      row_class VARCHAR(64),
      net_proceed NUMERIC(16, 4) NOT NULL DEFAULT 0,
      referral_fee NUMERIC(16, 4) NOT NULL DEFAULT 0,
      fulfillment_fee NUMERIC(16, 4) NOT NULL DEFAULT 0,
      shipping_charges NUMERIC(16, 4) NOT NULL DEFAULT 0,
      total NUMERIC(16, 4) NOT NULL DEFAULT 0,
      currency VARCHAR(8),
      zoho_invoice_id VARCHAR(128),
      zoho_invoice_number VARCHAR(200),
      match_status VARCHAR(32) NOT NULL DEFAULT 'unmatched',
      blocking_reason TEXT,
      raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS noon_payment_clearing_payment_previews (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES noon_payment_clearing_batches(id) ON DELETE CASCADE,
      summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      payments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      fee_journal_lines_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'previewed',
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS noon_payment_clearing_postings (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES noon_payment_clearing_batches(id) ON DELETE CASCADE,
      invoice_id VARCHAR(128),
      item_order_id VARCHAR(128),
      payment_type VARCHAR(64) NOT NULL,
      posting_group_key VARCHAR(128),
      zoho_payment_id VARCHAR(128),
      zoho_journal_number VARCHAR(128),
      amount NUMERIC(16, 4) NOT NULL DEFAULT 0,
      account_code VARCHAR(32),
      invoice_allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
      reference_number VARCHAR(128),
      description TEXT,
      mapping_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(32) NOT NULL DEFAULT 'posted',
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS noon_payment_clearing_fee_journal_mappings (
      id BIGSERIAL PRIMARY KEY,
      marketplace VARCHAR(16) NOT NULL DEFAULT 'AE',
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
  await query(`
    CREATE TABLE IF NOT EXISTS noon_payment_clearing_audit (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT NOT NULL REFERENCES noon_payment_clearing_batches(id) ON DELETE CASCADE,
      action VARCHAR(64) NOT NULL,
      reason TEXT,
      actor_user_id INTEGER NULL,
      previous_zoho_payment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_noon_payment_clearing_batches_reference
     ON noon_payment_clearing_batches (marketplace, reference_nr)
     WHERE reference_nr IS NOT NULL AND reference_nr <> ''`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_noon_payment_clearing_batches_created
     ON noon_payment_clearing_batches (created_at DESC)`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_noon_payment_clearing_rows_batch
     ON noon_payment_clearing_rows (batch_id, parent_order_id, item_order_id)`
  )
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_noon_payment_clearing_postings_group
     ON noon_payment_clearing_postings (batch_id, payment_type)
     WHERE posting_group_key IS NOT NULL`
  )
  await query(
    `CREATE INDEX IF NOT EXISTS idx_noon_fee_journal_mappings_lookup
     ON noon_payment_clearing_fee_journal_mappings (marketplace, normalized_fee_type, is_active, priority DESC)`
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
    marketplace: row.marketplace || 'AE',
    referenceNr: row.reference_nr || '',
    contract: row.contract || '',
    contractType: row.contract_type || '',
    status: row.status,
    totals: safeJson(row.totals, {}),
    hierarchy: safeJson(row.hierarchy, {}),
    reconciliationSummary: safeJson(row.reconciliation_summary, {}),
    matchedOrders: safeJson(row.matched_orders, []),
    unmatchedOrders: safeJson(row.unmatched_orders, []),
    multipleMatchItems: safeJson(row.multiple_match_items, []),
    parentCharges: safeJson(row.parent_charges, []),
    adjustments: safeJson(row.adjustments, []),
    statementFees: safeJson(row.statement_fees, []),
    feeJournalLines: safeJson(row.fee_journal_lines, []),
    allRows: safeJson(row.all_rows, []),
    blockingIssues: safeJson(row.blocking_issues, []),
    reportSnapshot: safeJson(row.report_snapshot, {}),
    metadata: safeJson(row.report_snapshot, {}),
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

function mapFeeJournalMapping(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    marketplace: row.marketplace || 'AE',
    normalizedFeeType: row.normalized_fee_type || '',
    rawTransactionType: row.raw_transaction_type || '',
    descriptionPattern: row.description_pattern || '',
    debitAccountName: row.debit_account_name || '',
    debitAccountId: row.debit_account_id || '',
    creditAccountName: row.credit_account_name || '',
    creditAccountId: row.credit_account_id || '',
    isActive: row.is_active === true || row.is_active === 't',
    priority: num(row.priority),
  }
}

function mapPosting(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    batchId: Number(row.batch_id),
    invoiceId: row.invoice_id || '',
    itemOrderId: row.item_order_id || '',
    paymentType: row.payment_type || '',
    postingGroupKey: row.posting_group_key || '',
    zohoPaymentId: row.zoho_payment_id || '',
    zohoJournalNumber: row.zoho_journal_number || '',
    amount: num(row.amount),
    accountCode: row.account_code || '',
    invoiceAllocations: safeJson(row.invoice_allocations, []),
    referenceNumber: row.reference_number || '',
    description: row.description || '',
    mappingSnapshot: safeJson(row.mapping_snapshot, {}),
    status: row.status || '',
    errorMessage: row.error_message || '',
  }
}

async function findBatchByReference(referenceNr, marketplace = 'AE') {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `SELECT * FROM noon_payment_clearing_batches
     WHERE marketplace = $1 AND reference_nr = $2
     ORDER BY id DESC LIMIT 1`,
    [marketplace, String(referenceNr || '').trim()]
  )
  return mapBatch(result.rows[0])
}

async function getBatchById(batchId) {
  await ensureNoonPaymentClearingTables()
  const result = await query(`SELECT * FROM noon_payment_clearing_batches WHERE id = $1`, [batchId])
  return mapBatch(result.rows[0])
}

async function listSavedBatches(limit = 50, marketplace = 'AE') {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `SELECT id, marketplace, reference_nr, contract_type, status, totals, reconciliation_summary,
            matched_orders, unmatched_orders, blocking_issues, zoho_customer_name,
            posted_to_zoho, posting_summary, report_snapshot, approved_at, posted_at, created_at, updated_at
     FROM noon_payment_clearing_batches
     WHERE marketplace = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [marketplace, Math.min(Number(limit) || 50, 200)]
  )
  return result.rows.map((row) => {
    const batch = mapBatch(row)
    return {
      batchId: batch.batchId,
      marketplace: batch.marketplace,
      referenceNr: batch.referenceNr,
      contractType: batch.contractType,
      status: batch.status,
      settlementTotal: batch.totals?.settlementTotal ?? batch.reconciliationSummary?.calculatedSettlement ?? 0,
      matchedItemCount: Array.isArray(batch.matchedOrders) ? batch.matchedOrders.length : 0,
      unmatchedItemCount: Array.isArray(batch.unmatchedOrders) ? batch.unmatchedOrders.length : 0,
      blockerCount: Array.isArray(batch.blockingIssues) ? batch.blockingIssues.length : 0,
      zohoCustomerName: batch.zohoCustomerName,
      postedToZoho: batch.postedToZoho,
      statementStartDate: batch.reportSnapshot?.statementStartDate || '',
      statementEndDate: batch.reportSnapshot?.statementEndDate || '',
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    }
  })
}

async function insertRows(client, batchId, rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    await client.query(
      `INSERT INTO noon_payment_clearing_rows (
        batch_id, row_number, parent_order_id, item_order_id, order_nr, item_nr,
        sku, partner_sku, transaction_type, row_class, net_proceed, referral_fee,
        fulfillment_fee, shipping_charges, total, currency, zoho_invoice_id,
        zoho_invoice_number, match_status, blocking_reason, raw_row
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)`,
      [
        batchId,
        row.rowNumber || null,
        row.parentOrderId || null,
        row.itemOrderId || null,
        row.orderNr || null,
        row.itemNr || null,
        row.sku || null,
        row.partnerSku || null,
        row.transactionType || null,
        row.rowClass || null,
        num(row.netProceed),
        num(row.referralFee),
        num(row.fulfillmentFee),
        num(row.shippingCharges),
        num(row.total),
        row.currency || 'AED',
        row.zohoInvoiceId || null,
        row.zohoInvoiceNumber || null,
        row.matchStatus || 'unmatched',
        row.blockingReason || null,
        JSON.stringify(row.originalRawRow || row),
      ]
    )
  }
}

async function savePreviewBatch(preview, createdBy = null) {
  await ensureNoonPaymentClearingTables()
  const metadata = preview.metadata || {}
  const referenceNr = String(metadata.referenceNr || '').trim()
  const marketplace = metadata.marketplace || 'AE'

  if (referenceNr) {
    const existing = await findBatchByReference(referenceNr, marketplace)
    if (existing) {
      if (existing.status === 'posted' || existing.postedToZoho) {
        const err = new Error(
          `Noon statement ${referenceNr} is already posted (batch ${existing.batchId}). Use force repost to rewrite.`
        )
        err.code = 'NOON_PAYMENT_CLEARING_BATCH_ALREADY_POSTED'
        err.status = 409
        err.batchId = existing.batchId
        throw err
      }
      // Replace non-posted batch contents
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(`DELETE FROM noon_payment_clearing_rows WHERE batch_id = $1`, [existing.batchId])
        await client.query(`DELETE FROM noon_payment_clearing_payment_previews WHERE batch_id = $1`, [
          existing.batchId,
        ])
        await client.query(
          `UPDATE noon_payment_clearing_batches SET
            contract = $2, contract_type = $3, status = 'previewed',
            totals = $4::jsonb, hierarchy = $5::jsonb, reconciliation_summary = $6::jsonb,
            matched_orders = $7::jsonb, unmatched_orders = $8::jsonb, multiple_match_items = $9::jsonb,
            parent_charges = $10::jsonb, adjustments = $11::jsonb, statement_fees = $12::jsonb,
            fee_journal_lines = $13::jsonb, all_rows = $14::jsonb, blocking_issues = $15::jsonb,
            report_snapshot = $16::jsonb, warnings = $17::jsonb,
            zoho_customer_id = $18, zoho_customer_name = $19,
            approved_by = NULL, approved_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [
            existing.batchId,
            metadata.contract || null,
            metadata.contractType || null,
            JSON.stringify(preview.totals || {}),
            JSON.stringify(preview.hierarchy || {}),
            JSON.stringify(preview.reconciliationSummary || {}),
            JSON.stringify(preview.matchedOrders || []),
            JSON.stringify(preview.unmatchedOrders || []),
            JSON.stringify(preview.multipleMatchItems || []),
            JSON.stringify(preview.parentCharges || []),
            JSON.stringify(preview.adjustments || []),
            JSON.stringify(preview.statementFees || []),
            JSON.stringify(preview.feeJournalLines || []),
            JSON.stringify(preview.allRows || []),
            JSON.stringify(preview.blockingIssues || []),
            JSON.stringify(metadata),
            JSON.stringify(preview.warnings || []),
            preview.zohoCustomerId || null,
            preview.zohoCustomerName || null,
          ]
        )
        await insertRows(client, existing.batchId, preview.allRows)
        await client.query('COMMIT')
        return getBatchById(existing.batchId)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO noon_payment_clearing_batches (
        marketplace, reference_nr, contract, contract_type, status,
        totals, hierarchy, reconciliation_summary, matched_orders, unmatched_orders,
        multiple_match_items, parent_charges, adjustments, statement_fees, fee_journal_lines,
        all_rows, blocking_issues, report_snapshot, warnings, zoho_customer_id, zoho_customer_name, created_by
      ) VALUES (
        $1,$2,$3,$4,'previewed',$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,
        $10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21
      ) RETURNING id`,
      [
        marketplace,
        referenceNr || null,
        metadata.contract || null,
        metadata.contractType || null,
        JSON.stringify(preview.totals || {}),
        JSON.stringify(preview.hierarchy || {}),
        JSON.stringify(preview.reconciliationSummary || {}),
        JSON.stringify(preview.matchedOrders || []),
        JSON.stringify(preview.unmatchedOrders || []),
        JSON.stringify(preview.multipleMatchItems || []),
        JSON.stringify(preview.parentCharges || []),
        JSON.stringify(preview.adjustments || []),
        JSON.stringify(preview.statementFees || []),
        JSON.stringify(preview.feeJournalLines || []),
        JSON.stringify(preview.allRows || []),
        JSON.stringify(preview.blockingIssues || []),
        JSON.stringify(metadata),
        JSON.stringify(preview.warnings || []),
        preview.zohoCustomerId || null,
        preview.zohoCustomerName || null,
        createdBy == null ? null : Number(createdBy),
      ]
    )
    const batchId = Number(inserted.rows[0].id)
    await insertRows(client, batchId, preview.allRows)
    await client.query('COMMIT')
    return getBatchById(batchId)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function approveBatch(batchId, approvedBy) {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `UPDATE noon_payment_clearing_batches
     SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [batchId, approvedBy == null ? null : Number(approvedBy)]
  )
  return mapBatch(result.rows[0])
}

async function markBatchPosted(batchId, postedBy, postingSummary = {}) {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `UPDATE noon_payment_clearing_batches
     SET status = 'posted', posted_to_zoho = true, posted_by = $2, posted_at = NOW(),
         posting_summary = $3::jsonb, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [batchId, postedBy == null ? null : Number(postedBy), JSON.stringify(postingSummary || {})]
  )
  return mapBatch(result.rows[0])
}

async function savePaymentPreview(batchId, paymentPreview, createdBy = null) {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `INSERT INTO noon_payment_clearing_payment_previews (
      batch_id, summary_json, payments_json, fee_journal_lines_json, status, created_by
    ) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,'previewed',$5)
    RETURNING id, created_at`,
    [
      batchId,
      JSON.stringify(paymentPreview.summary || {}),
      JSON.stringify(paymentPreview.invoicePayments || []),
      JSON.stringify(paymentPreview.feeJournalLines || []),
      createdBy == null ? null : Number(createdBy),
    ]
  )
  return {
    paymentPreviewId: Number(result.rows[0].id),
    createdAt: new Date(result.rows[0].created_at).toISOString(),
    ...paymentPreview,
  }
}

async function getLatestPaymentPreviewForBatch(batchId) {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `SELECT * FROM noon_payment_clearing_payment_previews
     WHERE batch_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [batchId]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    paymentPreviewId: Number(row.id),
    batchId: Number(row.batch_id),
    summary: safeJson(row.summary_json, {}),
    invoicePayments: safeJson(row.payments_json, []),
    feeJournalLines: safeJson(row.fee_journal_lines_json, []),
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

async function listFeeJournalMappings(marketplace = 'AE') {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `SELECT * FROM noon_payment_clearing_fee_journal_mappings
     WHERE marketplace = $1
     ORDER BY priority ASC, id ASC`,
    [marketplace]
  )
  return result.rows.map(mapFeeJournalMapping)
}

async function saveFeeJournalMapping(mapping, userId = null) {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `INSERT INTO noon_payment_clearing_fee_journal_mappings (
      marketplace, normalized_fee_type, raw_transaction_type, description_pattern,
      debit_account_name, debit_account_id, credit_account_name, credit_account_id,
      is_active, priority, created_by, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
    RETURNING *`,
    [
      mapping.marketplace || 'AE',
      mapping.normalizedFeeType,
      mapping.rawTransactionType || null,
      mapping.descriptionPattern || null,
      mapping.debitAccountName || null,
      mapping.debitAccountId || null,
      mapping.creditAccountName || null,
      mapping.creditAccountId || null,
      mapping.isActive !== false,
      mapping.priority == null ? 100 : Number(mapping.priority),
      userId == null ? null : Number(userId),
    ]
  )
  return mapFeeJournalMapping(result.rows[0])
}

async function findGroupedPosting(batchId, paymentType) {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `SELECT * FROM noon_payment_clearing_postings
     WHERE batch_id = $1 AND payment_type = $2 AND posting_group_key IS NOT NULL
     ORDER BY id DESC LIMIT 1`,
    [batchId, paymentType]
  )
  return mapPosting(result.rows[0])
}

async function insertPosting(posting) {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `INSERT INTO noon_payment_clearing_postings (
      batch_id, invoice_id, item_order_id, payment_type, posting_group_key,
      zoho_payment_id, zoho_journal_number, amount, account_code, invoice_allocations,
      reference_number, description, mapping_snapshot, status, error_message
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15)
    RETURNING *`,
    [
      posting.batchId,
      posting.invoiceId || null,
      posting.itemOrderId || null,
      posting.paymentType,
      posting.postingGroupKey || posting.paymentType,
      posting.zohoPaymentId || null,
      posting.zohoJournalNumber || null,
      num(posting.amount),
      posting.accountCode || null,
      JSON.stringify(posting.invoiceAllocations || []),
      posting.referenceNumber || null,
      posting.description || null,
      JSON.stringify(posting.mappingSnapshot || {}),
      posting.status || 'posted',
      posting.errorMessage || null,
    ]
  )
  return mapPosting(result.rows[0])
}

async function listPostingsForBatch(batchId) {
  await ensureNoonPaymentClearingTables()
  const result = await query(
    `SELECT * FROM noon_payment_clearing_postings WHERE batch_id = $1 ORDER BY id ASC`,
    [batchId]
  )
  return result.rows.map(mapPosting)
}

async function clearPostingsForBatch(batchId) {
  await ensureNoonPaymentClearingTables()
  await query(`DELETE FROM noon_payment_clearing_postings WHERE batch_id = $1`, [batchId])
}

async function insertAudit(entry) {
  await ensureNoonPaymentClearingTables()
  await query(
    `INSERT INTO noon_payment_clearing_audit (batch_id, action, reason, actor_user_id, previous_zoho_payment_ids, details)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [
      entry.batchId,
      entry.action,
      entry.reason || null,
      entry.actorUserId == null ? null : Number(entry.actorUserId),
      JSON.stringify(entry.previousZohoPaymentIds || []),
      JSON.stringify(entry.details || {}),
    ]
  )
}

async function withBatchPostingLock(batchId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [Number(batchId)])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  ensureNoonPaymentClearingTables,
  findBatchByReference,
  getBatchById,
  listSavedBatches,
  savePreviewBatch,
  approveBatch,
  markBatchPosted,
  savePaymentPreview,
  getLatestPaymentPreviewForBatch,
  listFeeJournalMappings,
  saveFeeJournalMapping,
  findGroupedPosting,
  insertPosting,
  listPostingsForBatch,
  clearPostingsForBatch,
  insertAudit,
  withBatchPostingLock,
  mapBatch,
}

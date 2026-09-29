'use strict'

/**
 * Local records for Tabby settlement clearing (Postgres). Nothing here talks to Zoho.
 *
 * - tabby_settlement_batches: one per Tabby statement number, pinned to the SHA-256 of the
 *   imported file. The same file again is ALREADY_IMPORTED; different content under the same
 *   statement number is a STATEMENT_VERSION_CONFLICT and is never imported.
 * - tabby_settlement_rows: every meaningful row of the statement with its fingerprint.
 * - tabby_clearing_components: one per deterministic posting key (statement | component | scope),
 *   with the same PLANNED → POSTING → VERIFIED state machine as Stripe payout clearing.
 * - tabby_clearing_events: audit trail. tabby_clearing_account_mappings: admin account choices.
 *
 * `createPgTabbyStore(db)` and `createMemoryTabbyStore()` (tabbyClearingMemoryStore.js) expose
 * the same interface; the services only depend on that interface.
 */

const COMPONENT_STATUS = Object.freeze({
  PLANNED: 'PLANNED',
  POSTING: 'POSTING',
  POSTED: 'POSTED',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  // Zoho may hold the record: never re-sent until a complete Zoho search after the settle window finds nothing.
  POSTING_UNCERTAIN: 'POSTING_UNCERTAIN',
})

// A component may only be (re)planned while nothing is in flight or recorded in Zoho.
const REPLANNABLE = Object.freeze([COMPONENT_STATUS.PLANNED, COMPONENT_STATUS.FAILED])

const BATCH_STATUS = Object.freeze({
  IMPORTED: 'IMPORTED',
  READY: 'READY',
  BLOCKED: 'BLOCKED',
  POSTING: 'POSTING',
  PARTIALLY_POSTED: 'PARTIALLY_POSTED',
  POSTED: 'POSTED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
})

const IMPORT_RESULT = Object.freeze({
  IMPORTED: 'IMPORTED',
  ALREADY_IMPORTED: 'ALREADY_IMPORTED',
  STATEMENT_VERSION_CONFLICT: 'STATEMENT_VERSION_CONFLICT',
})

const EVENT = Object.freeze({
  IMPORTED: 'IMPORTED',
  ALREADY_IMPORTED: 'ALREADY_IMPORTED',
  STATEMENT_VERSION_CONFLICT: 'STATEMENT_VERSION_CONFLICT',
  PREVIEWED: 'PREVIEWED',
  PLANNED: 'PLANNED',
  POSTING_STARTED: 'POSTING_STARTED',
  POSTED: 'POSTED',
  VERIFIED: 'VERIFIED',
  POSTING_FAILED: 'POSTING_FAILED',
  POSTING_RESPONSE_UNCERTAIN: 'POSTING_RESPONSE_UNCERTAIN',
  RECOVERY_MATCH_FOUND: 'RECOVERY_MATCH_FOUND',
  AMBIGUOUS_RECOVERY: 'AMBIGUOUS_RECOVERY',
  RECOVERY_STILL_MISSING: 'RECOVERY_STILL_MISSING',
  RECOVERY_LOOKUP_FAILED: 'RECOVERY_LOOKUP_FAILED',
  RETRY_ALLOWED: 'RETRY_ALLOWED',
  BANK_MATCHED: 'BANK_MATCHED',
  ACCOUNT_MAPPING_SAVED: 'ACCOUNT_MAPPING_SAVED',
  POSTING_BLOCKED: 'POSTING_BLOCKED',
})

const STATUS_LIST = Object.values(COMPONENT_STATUS).map((s) => `'${s}'`).join(', ')
const COMPONENT_LIST = [
  'SALE_NET', 'SALE_CHARGES', 'REFUND_CREDIT_NOTE', 'REFUND_PAYMENT', 'REFUND_COMMISSION_REVERSAL',
  'REFUND_FEE_REVERSAL', 'REFUND_VAT_REVERSAL', 'CHARGE_EXPENSE_CLEARING', 'PAYOUT_FEE', 'SETTLEMENT_JOURNAL', 'BANK_SETTLEMENT',
].map((s) => `'${s}'`).join(', ')
const BATCH_STATUS_LIST = Object.values(BATCH_STATUS).map((s) => `'${s}'`).join(', ')

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS tabby_settlement_batches (
     id BIGSERIAL PRIMARY KEY,
     statement_number TEXT NOT NULL,
     file_hash CHAR(64) NOT NULL,
     file_name TEXT,
     statement_date DATE,
     transfer_date DATE,
     company_name TEXT,
     currency CHAR(3) NOT NULL,
     parsed JSONB NOT NULL,
     totals JSONB NOT NULL DEFAULT '{}'::jsonb,
     status VARCHAR(24) NOT NULL DEFAULT 'IMPORTED' CHECK (status IN (${BATCH_STATUS_LIST})),
     review JSONB,
     bank_status VARCHAR(32),
     bank_transaction_id TEXT,
     bank_evidence JSONB,
     posting_fingerprint TEXT,
     imported_by TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     posted_at TIMESTAMPTZ,
     CONSTRAINT uq_tabby_settlement_batches_statement UNIQUE (statement_number)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_tabby_settlement_batches_bank_txn
     ON tabby_settlement_batches (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL`,
  `ALTER TABLE tabby_settlement_batches ADD COLUMN IF NOT EXISTS posting_job JSONB`,
  `CREATE TABLE IF NOT EXISTS tabby_settlement_rows (
     id BIGSERIAL PRIMARY KEY,
     batch_id BIGINT NOT NULL REFERENCES tabby_settlement_batches(id) ON DELETE CASCADE,
     statement_number TEXT NOT NULL,
     excel_row INTEGER NOT NULL,
     kind VARCHAR(16) NOT NULL CHECK (kind IN ('SALE', 'REFUND', 'PAYOUT_FEE', 'TOTAL', 'NOTE', 'UNKNOWN')),
     subtype TEXT,
     order_number TEXT,
     website_order_id TEXT,
     sale_refund_date TEXT,
     fingerprint CHAR(64) NOT NULL,
     gross_minor BIGINT NOT NULL DEFAULT 0,
     transferred_minor BIGINT NOT NULL DEFAULT 0,
     effects JSONB,
     raw JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT uq_tabby_settlement_rows_excel UNIQUE (batch_id, excel_row)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tabby_settlement_rows_order ON tabby_settlement_rows (website_order_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_tabby_settlement_rows_fingerprint ON tabby_settlement_rows (fingerprint)`,
  `CREATE TABLE IF NOT EXISTS tabby_clearing_components (
     id BIGSERIAL PRIMARY KEY,
     batch_id BIGINT NOT NULL REFERENCES tabby_settlement_batches(id) ON DELETE CASCADE,
     statement_number TEXT NOT NULL,
     component_key TEXT NOT NULL,
     component VARCHAR(40) NOT NULL CONSTRAINT tabby_clearing_components_component_check CHECK (component IN (${COMPONENT_LIST})),
     scope TEXT NOT NULL,
     zoho_record_type VARCHAR(24) NOT NULL CHECK (zoho_record_type IN (
       'customer_payment', 'journal', 'creditnote_refund', 'creditnote_link', 'bank_transfer')),
     amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
     currency CHAR(3) NOT NULL,
     reference TEXT NOT NULL,
     customer_id TEXT,
     invoice_id TEXT,
     credit_note_id TEXT,
     website_order_id TEXT,
     row_fingerprint TEXT,
     plan JSONB NOT NULL,
     status VARCHAR(24) NOT NULL CHECK (status IN (${STATUS_LIST})),
     zoho_record_id TEXT,
     attempt_count INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     recovery_status VARCHAR(32),
     posted_at TIMESTAMPTZ,
     verified_at TIMESTAMPTZ,
     first_uncertain_at TIMESTAMPTZ,
     uncertain_since TIMESTAMPTZ,
     last_recovery_check_at TIMESTAMPTZ,
     recovery_check_count INTEGER NOT NULL DEFAULT 0,
     request_snapshot JSONB,
     created_by TEXT,
     updated_by TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT uq_tabby_clearing_components_key UNIQUE (component_key),
     CONSTRAINT ck_tabby_clearing_components_verified
       CHECK (status <> 'VERIFIED' OR (zoho_record_id IS NOT NULL AND verified_at IS NOT NULL)),
     CONSTRAINT ck_tabby_clearing_components_uncertain
       CHECK (status <> 'POSTING_UNCERTAIN' OR (uncertain_since IS NOT NULL AND first_uncertain_at IS NOT NULL))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_tabby_clearing_components_record
     ON tabby_clearing_components (zoho_record_type, zoho_record_id)
     WHERE zoho_record_id IS NOT NULL AND zoho_record_type <> 'creditnote_link'`,
  `CREATE INDEX IF NOT EXISTS idx_tabby_clearing_components_batch ON tabby_clearing_components (batch_id)`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tabby_clearing_components'::regclass
          AND conname = 'tabby_clearing_components_component_check'
          AND pg_get_constraintdef(oid) LIKE '%SETTLEMENT_JOURNAL%'
     ) THEN
       ALTER TABLE tabby_clearing_components DROP CONSTRAINT IF EXISTS tabby_clearing_components_component_check;
       ALTER TABLE tabby_clearing_components ADD CONSTRAINT tabby_clearing_components_component_check CHECK (component IN (${COMPONENT_LIST}));
     END IF;
   END $$`,
  `CREATE TABLE IF NOT EXISTS tabby_clearing_events (
     id BIGSERIAL PRIMARY KEY,
     batch_id BIGINT REFERENCES tabby_settlement_batches(id) ON DELETE CASCADE,
     component_id BIGINT,
     statement_number TEXT,
     event_type VARCHAR(40) NOT NULL,
     from_status VARCHAR(32),
     to_status VARCHAR(32),
     detail TEXT,
     evidence JSONB,
     actor TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tabby_clearing_events_batch ON tabby_clearing_events (batch_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS tabby_clearing_account_mappings (
     role VARCHAR(32) PRIMARY KEY CHECK (role IN ('UNDEPOSITED', 'PROCESSING', 'COMMISSION_EXPENSE', 'FEES_EXPENSE', 'INPUT_VAT', 'BANK')),
     account_id TEXT NOT NULL,
     account_name TEXT NOT NULL,
     account_code TEXT,
     account_type TEXT NOT NULL,
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
]

async function ensureTabbyClearingTables(query) {
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

function ymd(value) {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mapBatch(row) {
  if (!row) return null
  return {
    id: String(row.id),
    statementNumber: row.statement_number,
    fileHash: String(row.file_hash).trim(),
    fileName: row.file_name || null,
    statementDate: ymd(row.statement_date),
    transferDate: ymd(row.transfer_date),
    companyName: row.company_name || null,
    currency: String(row.currency || '').trim(),
    parsed: row.parsed,
    totals: row.totals || {},
    status: row.status,
    review: row.review || null,
    bankStatus: row.bank_status || null,
    bankTransactionId: row.bank_transaction_id || null,
    bankEvidence: row.bank_evidence || null,
    postingFingerprint: row.posting_fingerprint || null,
    postingJob: row.posting_job || null,
    importedBy: row.imported_by || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    postedAt: iso(row.posted_at),
  }
}

function mapRow(row) {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    statementNumber: row.statement_number,
    excelRow: Number(row.excel_row),
    kind: row.kind,
    subtype: row.subtype || null,
    orderNumber: row.order_number || '',
    websiteOrderId: row.website_order_id || '',
    saleRefundDate: row.sale_refund_date || null,
    fingerprint: String(row.fingerprint).trim(),
    grossMinor: Number(row.gross_minor),
    transferredMinor: Number(row.transferred_minor),
    effects: row.effects || null,
  }
}

function mapComponent(row) {
  if (!row) return null
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    statementNumber: row.statement_number,
    key: row.component_key,
    component: row.component,
    scope: row.scope,
    zohoRecordType: row.zoho_record_type,
    amount: Number(row.amount),
    currency: String(row.currency || '').trim(),
    reference: row.reference,
    customerId: row.customer_id || null,
    invoiceId: row.invoice_id || null,
    creditNoteId: row.credit_note_id || null,
    websiteOrderId: row.website_order_id || null,
    rowFingerprint: row.row_fingerprint || null,
    plan: row.plan || null,
    status: row.status,
    zohoRecordId: row.zoho_record_id || null,
    attemptCount: Number(row.attempt_count) || 0,
    lastError: row.last_error || null,
    recoveryStatus: row.recovery_status || null,
    postedAt: iso(row.posted_at),
    verifiedAt: iso(row.verified_at),
    firstUncertainAt: iso(row.first_uncertain_at),
    uncertainSince: iso(row.uncertain_since),
    lastRecoveryCheckAt: iso(row.last_recovery_check_at),
    recoveryCheckCount: Number(row.recovery_check_count) || 0,
    requestSnapshot: row.request_snapshot || null,
    createdBy: row.created_by || null,
    updatedBy: row.updated_by || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function mapEvent(row) {
  return {
    id: String(row.id),
    batchId: row.batch_id == null ? null : String(row.batch_id),
    componentId: row.component_id == null ? null : String(row.component_id),
    statementNumber: row.statement_number || null,
    eventType: row.event_type,
    fromStatus: row.from_status || null,
    toStatus: row.to_status || null,
    detail: row.detail || null,
    evidence: row.evidence || null,
    actor: row.actor || null,
    at: iso(row.created_at),
  }
}

function mapMapping(row) {
  return {
    role: row.role,
    accountId: row.account_id,
    accountName: row.account_name,
    accountCode: row.account_code || null,
    accountType: row.account_type,
    updatedBy: row.updated_by || null,
    updatedAt: iso(row.updated_at),
  }
}

/** Plan fields kept on the component row (payload is rebuilt from them, never trusted blindly). */
function planOf(c) {
  const { payload, ...rest } = c
  return JSON.parse(JSON.stringify({ ...rest, payload }))
}

const LOCK_NAMESPACE = 0x54414242 // "TABB"

function createPgTabbyStore(db) {
  async function tx(fn) {
    const client = typeof db.connect === 'function' ? await db.connect() : db
    const release = client !== db && typeof client.release === 'function' ? () => client.release() : () => {}
    try {
      await client.query('BEGIN')
      const out = await fn(client)
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      release()
    }
  }

  async function logEvent(q, e) {
    await q.query(
      `INSERT INTO tabby_clearing_events (batch_id, component_id, statement_number, event_type, from_status, to_status, detail, evidence, actor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [e.batchId || null, e.componentId || null, e.statementNumber || null, e.eventType, e.fromStatus || null, e.toStatus || null, e.detail || null, e.evidence == null ? null : JSON.stringify(e.evidence), e.actor || null],
    )
  }

  return {
    kind: 'postgres',

    async importStatement({ parsed, analysis, fileName, actor }) {
      const st = parsed.statement
      return tx(async (q) => {
        const found = await q.query('SELECT * FROM tabby_settlement_batches WHERE statement_number = $1 FOR UPDATE', [st.statementNumber])
        const current = found.rows[0]
        if (current) {
          const same = String(current.file_hash).trim() === parsed.fileHash
          await logEvent(q, {
            batchId: current.id,
            statementNumber: st.statementNumber,
            eventType: same ? EVENT.ALREADY_IMPORTED : EVENT.STATEMENT_VERSION_CONFLICT,
            detail: same
              ? `${fileName || 'File'} is the statement already imported.`
              : `${fileName || 'File'} has the same statement number but different content; it was not imported.`,
            evidence: { storedHash: String(current.file_hash).trim(), uploadedHash: parsed.fileHash, fileName: fileName || null },
            actor,
          })
          return { result: same ? IMPORT_RESULT.ALREADY_IMPORTED : IMPORT_RESULT.STATEMENT_VERSION_CONFLICT, batch: mapBatch(current) }
        }
        const { rows } = await q.query(
          `INSERT INTO tabby_settlement_batches
             (statement_number, file_hash, file_name, statement_date, transfer_date, company_name, currency, parsed, totals, status, imported_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'IMPORTED', $10) RETURNING *`,
          [st.statementNumber, parsed.fileHash, fileName || null, st.statementDate || null, analysis.transferDate || null, st.companyName || null, st.currencyFromNumber || 'AED', JSON.stringify(parsed), JSON.stringify(analysis.totals || {}), actor || null],
        )
        const batch = rows[0]
        for (const r of analysis.rows) {
          await q.query(
            `INSERT INTO tabby_settlement_rows
               (batch_id, statement_number, excel_row, kind, subtype, order_number, website_order_id, sale_refund_date, fingerprint, gross_minor, transferred_minor, effects, raw)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
            [batch.id, st.statementNumber, r.excelRow, r.kind, r.subtype || null, r.orderNumber || null, r.websiteOrderId || null, r.saleRefundDate || null, r.fingerprint,
              r.effects ? r.effects.grossEffect : r.minor.orderAmount, r.effects ? r.effects.transferEffect : r.minor.transferredAmount,
              r.effects ? JSON.stringify(r.effects) : null, JSON.stringify(r.raw || {})],
          )
        }
        await logEvent(q, { batchId: batch.id, statementNumber: st.statementNumber, eventType: EVENT.IMPORTED, toStatus: 'IMPORTED', detail: `Imported ${fileName || 'statement'} (${analysis.rows.length} rows).`, evidence: { fileHash: parsed.fileHash }, actor })
        return { result: IMPORT_RESULT.IMPORTED, batch: mapBatch(batch) }
      })
    },

    async listBatches({ limit = 100 } = {}) {
      const { rows } = await db.query(
        `SELECT b.*, (SELECT json_agg(json_build_object('status', c.status, 'component', c.component)) FROM tabby_clearing_components c WHERE c.batch_id = b.id) AS component_states
         FROM tabby_settlement_batches b ORDER BY b.statement_date DESC NULLS LAST, b.id DESC LIMIT $1`,
        [limit],
      )
      return rows.map((r) => ({ ...mapBatch(r), parsed: undefined, componentStates: r.component_states || [] }))
    },

    async getBatch(id) {
      const { rows } = await db.query('SELECT * FROM tabby_settlement_batches WHERE id = $1', [id])
      return mapBatch(rows[0])
    },

    async getBatchByStatement(statementNumber) {
      const { rows } = await db.query('SELECT * FROM tabby_settlement_batches WHERE statement_number = $1', [statementNumber])
      return mapBatch(rows[0])
    },

    async updateBatch(id, patch) {
      const { rows } = await db.query(
        `UPDATE tabby_settlement_batches SET
           status = COALESCE($2, status),
           review = COALESCE($3::jsonb, review),
           posting_fingerprint = COALESCE($4, posting_fingerprint),
           posted_at = COALESCE($5::timestamptz, posted_at),
           posting_job = COALESCE($6::jsonb, posting_job),
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, patch.status || null, patch.review == null ? null : JSON.stringify(patch.review), patch.postingFingerprint || null, patch.postedAt || null, patch.postingJob == null ? null : JSON.stringify(patch.postingJob)],
      )
      return mapBatch(rows[0])
    },

    /** Link (or clear) the existing Zoho bank record; one Zoho record can settle one statement only. */
    async setBankMatch(id, { status, transactionId, evidence, actor }) {
      try {
        const { rows } = await db.query(
          `UPDATE tabby_settlement_batches SET bank_status = $2, bank_transaction_id = $3, bank_evidence = $4::jsonb, updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [id, status, transactionId || null, evidence == null ? null : JSON.stringify(evidence)],
        )
        if (status === 'BANK_MATCHED') {
          await logEvent(db, { batchId: id, statementNumber: rows[0].statement_number, eventType: EVENT.BANK_MATCHED, toStatus: status, detail: `Linked existing Zoho bank record ${transactionId}.`, evidence, actor })
        }
        return mapBatch(rows[0])
      } catch (err) {
        if (err && err.code === '23505') throw storeError(409, 'BANK_RECORD_ALREADY_CLAIMED', `Zoho bank record ${transactionId} already settles another Tabby statement.`)
        throw err
      }
    },

    async listBankClaims() {
      const { rows } = await db.query('SELECT id, statement_number, bank_transaction_id FROM tabby_settlement_batches WHERE bank_transaction_id IS NOT NULL')
      return rows.map((r) => ({ batchId: String(r.id), statementNumber: r.statement_number, transactionId: r.bank_transaction_id }))
    },

    async listRows(batchId) {
      const { rows } = await db.query('SELECT * FROM tabby_settlement_rows WHERE batch_id = $1 ORDER BY excel_row', [batchId])
      return rows.map(mapRow)
    },

    /**
     * Rows of other statements for these orders. Refunds count as "prior" when their statement was
     * imported earlier or their refund payment is already posted, so one of two identical refund
     * rows always stays postable and the other is the duplicate.
     */
    async listOtherStatementRows({ websiteOrderIds, batchId }) {
      if (!websiteOrderIds.length) return []
      const { rows } = await db.query(
        `SELECT r.*, (r.batch_id < $2 OR EXISTS (
            SELECT 1 FROM tabby_clearing_components c
            WHERE c.batch_id = r.batch_id AND c.row_fingerprint = r.fingerprint AND c.component = 'REFUND_PAYMENT'
              AND c.status IN ('POSTED', 'VERIFIED', 'POSTING', 'POSTING_UNCERTAIN'))) AS prior
         FROM tabby_settlement_rows r
         WHERE r.website_order_id = ANY($1::text[]) AND r.batch_id <> $2 AND r.kind IN ('SALE', 'REFUND')
         ORDER BY r.batch_id, r.excel_row`,
        [websiteOrderIds, batchId],
      )
      return rows.map((r) => ({ ...mapRow(r), prior: r.prior === true }))
    },

    async listComponents(batchId) {
      const { rows } = await db.query('SELECT * FROM tabby_clearing_components WHERE batch_id = $1 ORDER BY id', [batchId])
      return rows.map(mapComponent)
    },

    async getComponent(id) {
      const { rows } = await db.query('SELECT * FROM tabby_clearing_components WHERE id = $1', [id])
      return mapComponent(rows[0])
    },

    /** Create or refresh a planned component; one in flight, posted, verified or under review is returned unchanged. */
    async upsertPlannedComponent(batchId, c, actor) {
      return tx(async (q) => {
        const found = await q.query('SELECT * FROM tabby_clearing_components WHERE component_key = $1 FOR UPDATE', [c.key])
        const current = found.rows[0]
        if (current && String(current.batch_id) !== String(batchId)) throw storeError(409, 'COMPONENT_KEY_CONFLICT', `Component ${c.key} belongs to another batch.`)
        if (current && !REPLANNABLE.includes(current.status)) return { component: mapComponent(current), changed: false }
        const params = [c.zohoRecordType, c.amount, c.currency, c.reference, c.customerId || null, c.invoiceId || null, c.creditNoteId || null, c.websiteOrderId || null, c.rowFingerprint || null, JSON.stringify(planOf(c)), actor || null]
        if (current) {
          const { rows } = await q.query(
            `UPDATE tabby_clearing_components SET zoho_record_type = $1, amount = $2, currency = $3, reference = $4, customer_id = $5, invoice_id = $6,
               credit_note_id = $7, website_order_id = $8, row_fingerprint = $9, plan = $10::jsonb, updated_by = $11, updated_at = NOW()
             WHERE id = $12 RETURNING *`,
            [...params, current.id],
          )
          return { component: mapComponent(rows[0]), changed: true }
        }
        const { rows } = await q.query(
          `INSERT INTO tabby_clearing_components (zoho_record_type, amount, currency, reference, customer_id, invoice_id, credit_note_id, website_order_id,
             row_fingerprint, plan, created_by, updated_by, batch_id, statement_number, component_key, component, scope, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11, $12, $13, $14, $15, $16, 'PLANNED') RETURNING *`,
          [...params, batchId, c.statementNumber, c.key, c.component, c.scope],
        )
        await logEvent(q, { batchId, componentId: rows[0].id, statementNumber: c.statementNumber, eventType: EVENT.PLANNED, toStatus: 'PLANNED', detail: `${c.component} ${c.amount.toFixed(2)} planned (${c.reference}).`, actor })
        return { component: mapComponent(rows[0]), changed: true }
      })
    },

    /**
     * Guarded status change. Patch: zohoRecordId, incrementAttempt, lastError, postedAt, verifiedAt,
     * uncertainAt (starts an uncertain episode), recoveryCheckAt, recoveryStatus, requestSnapshot,
     * event, evidence.
     */
    async transitionComponent(id, fromStatuses, toStatus, patch = {}, detail, actor) {
      return tx(async (q) => {
        const found = await q.query('SELECT * FROM tabby_clearing_components WHERE id = $1 FOR UPDATE', [id])
        const current = found.rows[0]
        if (!current || !fromStatuses.includes(current.status)) {
          throw storeError(409, 'COMPONENT_STATE_CONFLICT', `Component ${id} is ${current ? current.status : 'missing'}, not ${fromStatuses.join('/')}; refusing to set ${toStatus}.`)
        }
        const { rows } = await q.query(
          `UPDATE tabby_clearing_components SET
             status = $2::varchar,
             zoho_record_id = COALESCE($3, zoho_record_id),
             attempt_count = attempt_count + $4::int,
             last_error = CASE WHEN $13::boolean THEN NULL ELSE COALESCE($5, last_error) END,
             posted_at = COALESCE($6::timestamptz, posted_at),
             verified_at = COALESCE($7::timestamptz, verified_at),
             uncertain_since = CASE WHEN $2::varchar = 'POSTING_UNCERTAIN' THEN COALESCE($8::timestamptz, uncertain_since) ELSE uncertain_since END,
             first_uncertain_at = COALESCE(first_uncertain_at, $8::timestamptz),
             last_recovery_check_at = COALESCE($9::timestamptz, last_recovery_check_at),
             recovery_check_count = recovery_check_count + CASE WHEN $9::timestamptz IS NULL THEN 0 ELSE 1 END,
             recovery_status = COALESCE($10, recovery_status),
             request_snapshot = COALESCE($11::jsonb, request_snapshot),
             updated_by = COALESCE($12, updated_by),
             updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [id, toStatus, patch.zohoRecordId || null, patch.incrementAttempt ? 1 : 0, patch.lastError || null, patch.postedAt || null, patch.verifiedAt || null,
            patch.uncertainAt || null, patch.recoveryCheckAt || null, patch.recoveryStatus || null,
            patch.requestSnapshot == null ? null : JSON.stringify(patch.requestSnapshot), actor || null, patch.clearError === true],
        )
        await logEvent(q, { batchId: current.batch_id, componentId: id, statementNumber: current.statement_number, eventType: patch.event || toStatus, fromStatus: current.status, toStatus, detail: detail || patch.lastError || null, evidence: patch.evidence, actor })
        return mapComponent(rows[0])
      })
    },

    async logEvent(e) {
      await logEvent(db, e)
    },

    async listEvents(batchId) {
      const { rows } = await db.query('SELECT * FROM tabby_clearing_events WHERE batch_id = $1 ORDER BY created_at, id', [batchId])
      return rows.map(mapEvent)
    },

    async listAccountMappings() {
      const { rows } = await db.query('SELECT * FROM tabby_clearing_account_mappings ORDER BY role')
      return rows.map(mapMapping)
    },

    async saveAccountMapping(m, actor) {
      const { rows } = await db.query(
        `INSERT INTO tabby_clearing_account_mappings (role, account_id, account_name, account_code, account_type, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (role) DO UPDATE SET account_id = EXCLUDED.account_id, account_name = EXCLUDED.account_name, account_code = EXCLUDED.account_code,
           account_type = EXCLUDED.account_type, updated_by = EXCLUDED.updated_by, updated_at = NOW()
         RETURNING *`,
        [m.role, m.accountId, m.accountName, m.accountCode || null, m.accountType, actor || null],
      )
      await logEvent(db, { eventType: EVENT.ACCOUNT_MAPPING_SAVED, detail: `${m.role} → ${m.accountName} (${m.accountCode || m.accountId}).`, evidence: m, actor })
      return mapMapping(rows[0])
    },

    async deleteAccountMapping(role, actor) {
      await db.query('DELETE FROM tabby_clearing_account_mappings WHERE role = $1', [role])
      await logEvent(db, { eventType: EVENT.ACCOUNT_MAPPING_SAVED, detail: `${role} mapping removed; the role resolves by name again.`, actor })
    },

    /** Session advisory lock on a dedicated connection; a second poster fails fast. */
    async acquireStatementLock(statementNumber) {
      if (typeof db.connect !== 'function') return { async release() {} }
      const client = await db.connect()
      let locked = false
      try {
        const { rows } = await client.query('SELECT pg_try_advisory_lock($1::int, hashtext($2)) AS locked', [LOCK_NAMESPACE, statementNumber])
        locked = rows[0] && rows[0].locked === true
      } catch (err) {
        client.release()
        throw err
      }
      if (!locked) {
        client.release()
        throw storeError(409, 'STATEMENT_POSTING_IN_PROGRESS', `Another request is already posting ${statementNumber}.`)
      }
      return {
        async release() {
          try {
            await client.query('SELECT pg_advisory_unlock($1::int, hashtext($2))', [LOCK_NAMESPACE, statementNumber])
          } finally {
            client.release()
          }
        },
      }
    },
  }
}

module.exports = {
  COMPONENT_STATUS,
  REPLANNABLE,
  BATCH_STATUS,
  IMPORT_RESULT,
  EVENT,
  SCHEMA_SQL,
  ensureTabbyClearingTables,
  createPgTabbyStore,
  storeError,
  planOf,
}

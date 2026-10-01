'use strict'

/**
 * Local records for Mashreq POS settlement clearing (Postgres). Nothing here talks to Zoho.
 *
 * - pos_settlement_files: every uploaded file, unique by SHA-256 (the same file again is ALREADY_IMPORTED).
 * - pos_transactions: every POS row ever imported. RRN is TEXT. A row describing a transaction
 *   already imported with the same economics is DUPLICATE; with different amounts/date it is a
 *   CONFLICT (kept for audit, never a second transaction). Only ACTIVE rows belong to a payout.
 * - pos_settlements: one per Mashreq payout (provider + payout key), with review, approval and
 *   the single Zoho bank record it is linked to.
 * - pos_rrn_invoice_index: RRNs read from Zoho invoices (local cache; Zoho stays the truth and
 *   is re-read before posting).
 * - pos_manual_mappings, pos_terminal_mappings: admin decisions with full audit.
 * - pos_clearing_components / pos_clearing_events / pos_clearing_account_mappings: same state
 *   machine and audit trail as Tabby and Stripe clearing.
 */

const { COMPONENT_STATUS, REPLANNABLE, storeError, planOf } = require('../tabbyClearing/tabbyClearingStore')
const model = require('./posSettlementModel.ts')

const SETTLEMENT_STATUS = Object.freeze({
  IMPORTED: 'IMPORTED',
  READY: 'READY',
  BLOCKED: 'BLOCKED',
  POSTING: 'POSTING',
  PARTIALLY_POSTED: 'PARTIALLY_POSTED',
  POSTED: 'POSTED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
})

const IMPORT_RESULT = Object.freeze({ IMPORTED: 'IMPORTED', ALREADY_IMPORTED: 'ALREADY_IMPORTED' })

const EVENT = Object.freeze({
  IMPORTED: 'IMPORTED',
  ALREADY_IMPORTED: 'ALREADY_IMPORTED',
  TRANSACTION_DUPLICATE: 'TRANSACTION_DUPLICATE',
  TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
  TRANSACTION_ADDED_AFTER_POSTING: 'TRANSACTION_ADDED_AFTER_POSTING',
  CONFLICT_DISMISSED: 'CONFLICT_DISMISSED',
  PREVIEWED: 'PREVIEWED',
  APPROVED: 'APPROVED',
  APPROVAL_REVOKED: 'APPROVAL_REVOKED',
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
  BANK_UNLINKED: 'BANK_UNLINKED',
  MANUAL_MAPPING_SAVED: 'MANUAL_MAPPING_SAVED',
  MANUAL_MAPPING_REVOKED: 'MANUAL_MAPPING_REVOKED',
  TERMINAL_MAPPING_SAVED: 'TERMINAL_MAPPING_SAVED',
  TERMINAL_MAPPING_REMOVED: 'TERMINAL_MAPPING_REMOVED',
  ACCOUNT_MAPPING_SAVED: 'ACCOUNT_MAPPING_SAVED',
  POSTING_BLOCKED: 'POSTING_BLOCKED',
})

const list = (values: string[]) => values.map((s) => `'${s}'`).join(', ')
const COMPONENT_STATUS_LIST = list(Object.values(COMPONENT_STATUS) as string[])
const SETTLEMENT_STATUS_LIST = list(Object.values(SETTLEMENT_STATUS))
const COMPONENT_LIST = list(Object.values(model.COMPONENT) as string[])
const TXN_STATUS_LIST = list(Object.values(model.TXN_STATUS) as string[])

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS pos_settlement_files (
     id BIGSERIAL PRIMARY KEY,
     provider VARCHAR(24) NOT NULL,
     file_hash CHAR(64) NOT NULL,
     file_name TEXT,
     source_format VARCHAR(24) NOT NULL,
     role VARCHAR(16) NOT NULL CHECK (role IN ('TRANSACTIONS', 'CONTROL')),
     parser_version TEXT NOT NULL,
     summary JSONB NOT NULL DEFAULT '{}'::jsonb,
     transaction_count INTEGER NOT NULL DEFAULT 0,
     new_count INTEGER NOT NULL DEFAULT 0,
     duplicate_count INTEGER NOT NULL DEFAULT 0,
     conflict_count INTEGER NOT NULL DEFAULT 0,
     imported_by TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT uq_pos_settlement_files_hash UNIQUE (provider, file_hash)
   )`,
  `CREATE TABLE IF NOT EXISTS pos_settlements (
     id BIGSERIAL PRIMARY KEY,
     provider VARCHAR(24) NOT NULL,
     payout_key TEXT NOT NULL,
     settlement_code TEXT NOT NULL,
     basis VARCHAR(24) NOT NULL,
     payout_date DATE,
     currency CHAR(3) NOT NULL DEFAULT 'AED',
     status VARCHAR(24) NOT NULL DEFAULT 'IMPORTED' CHECK (status IN (${SETTLEMENT_STATUS_LIST})),
     review JSONB,
     approval JSONB,
     bank_status VARCHAR(32),
     bank_transaction_id TEXT,
     bank_evidence JSONB,
     posting_fingerprint TEXT,
     posting_job JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     posted_at TIMESTAMPTZ,
     CONSTRAINT uq_pos_settlements_payout UNIQUE (provider, payout_key),
     CONSTRAINT uq_pos_settlements_code UNIQUE (settlement_code)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_settlements_bank_txn
     ON pos_settlements (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS pos_transactions (
     id BIGSERIAL PRIMARY KEY,
     file_id BIGINT NOT NULL REFERENCES pos_settlement_files(id) ON DELETE RESTRICT,
     settlement_id BIGINT REFERENCES pos_settlements(id) ON DELETE RESTRICT,
     organization_id TEXT NOT NULL,
     provider VARCHAR(24) NOT NULL,
     source_row INTEGER NOT NULL,
     record_type TEXT,
     merchant_id TEXT,
     merchant_name TEXT,
     terminal_id TEXT,
     rrn TEXT,
     stan TEXT,
     auth_code TEXT,
     transaction_type_raw TEXT,
     transaction_type VARCHAR(16) NOT NULL,
     transaction_date DATE,
     transaction_time TEXT,
     currency CHAR(3),
     gross_minor BIGINT,
     commission_minor BIGINT,
     other_fees_minor BIGINT,
     vat_minor BIGINT,
     net_minor BIGINT,
     net_derived BOOLEAN NOT NULL DEFAULT FALSE,
     batch_number TEXT,
     settlement_ref TEXT,
     settlement_date DATE,
     bank_reference TEXT,
     card_scheme TEXT,
     masked_card TEXT,
     identity_key CHAR(64) NOT NULL,
     economic_hash CHAR(64) NOT NULL,
     status VARCHAR(16) NOT NULL CHECK (status IN (${TXN_STATUS_LIST})),
     duplicate_of BIGINT REFERENCES pos_transactions(id),
     conflict_with BIGINT REFERENCES pos_transactions(id),
     conflict_fields JSONB,
     payout_key TEXT,
     payout_basis VARCHAR(24),
     warnings JSONB,
     raw JSONB NOT NULL DEFAULT '{}'::jsonb,
     status_reason TEXT,
     status_by TEXT,
     status_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT ck_pos_transactions_rrn_text CHECK (rrn IS NULL OR rrn ~ '^[0-9A-Za-z]+$')
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_transactions_identity_active
     ON pos_transactions (identity_key, transaction_date) WHERE status = 'ACTIVE'`,
  `CREATE INDEX IF NOT EXISTS idx_pos_transactions_rrn ON pos_transactions (organization_id, provider, rrn)`,
  `CREATE INDEX IF NOT EXISTS idx_pos_transactions_settlement ON pos_transactions (settlement_id)`,
  `CREATE TABLE IF NOT EXISTS pos_rrn_invoice_index (
     organization_id TEXT NOT NULL,
     invoice_id TEXT NOT NULL,
     invoice_number TEXT,
     reference_number TEXT,
     customer_id TEXT,
     customer_name TEXT,
     invoice_date DATE,
     total_minor BIGINT,
     balance_minor BIGINT,
     currency_code TEXT,
     status TEXT,
     last_modified_time TEXT,
     rrn_field TEXT,
     rrns TEXT[] NOT NULL DEFAULT '{}',
     malformed TEXT[] NOT NULL DEFAULT '{}',
     scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (organization_id, invoice_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_pos_rrn_invoice_index_rrns ON pos_rrn_invoice_index USING GIN (rrns)`,
  `CREATE INDEX IF NOT EXISTS idx_pos_rrn_invoice_index_date ON pos_rrn_invoice_index (organization_id, customer_id, invoice_date)`,
  `CREATE TABLE IF NOT EXISTS pos_manual_mappings (
     id BIGSERIAL PRIMARY KEY,
     transaction_id BIGINT NOT NULL REFERENCES pos_transactions(id) ON DELETE RESTRICT,
     rrn TEXT,
     allocations JSONB NOT NULL,
     auto_result JSONB,
     reason TEXT NOT NULL,
     state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'REVOKED')),
     created_by TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     revoked_by TEXT,
     revoked_at TIMESTAMPTZ,
     revoke_reason TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_manual_mappings_active ON pos_manual_mappings (transaction_id) WHERE state = 'ACTIVE'`,
  `CREATE TABLE IF NOT EXISTS pos_terminal_mappings (
     id BIGSERIAL PRIMARY KEY,
     provider VARCHAR(24) NOT NULL,
     merchant_id TEXT NOT NULL,
     terminal_id TEXT,
     channel VARCHAR(24) NOT NULL CHECK (channel IN ('WEBSITE', 'WEB_APP', 'BURJUMAN_SHOP', 'UNKNOWN')),
     location TEXT,
     notes TEXT,
     active BOOLEAN NOT NULL DEFAULT TRUE,
     created_by TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     removed_by TEXT,
     removed_at TIMESTAMPTZ
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_terminal_mappings_active
     ON pos_terminal_mappings (provider, merchant_id, COALESCE(terminal_id, '')) WHERE active`,
  `CREATE TABLE IF NOT EXISTS pos_clearing_components (
     id BIGSERIAL PRIMARY KEY,
     settlement_id BIGINT NOT NULL REFERENCES pos_settlements(id) ON DELETE RESTRICT,
     settlement_code TEXT NOT NULL,
     component_key TEXT NOT NULL,
     component VARCHAR(40) NOT NULL CHECK (component IN (${COMPONENT_LIST})),
     scope TEXT NOT NULL,
     zoho_record_type VARCHAR(24) NOT NULL CHECK (zoho_record_type IN ('customer_payment', 'journal', 'bank_transfer')),
     amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
     currency CHAR(3) NOT NULL,
     reference TEXT NOT NULL,
     customer_id TEXT,
     plan JSONB NOT NULL,
     status VARCHAR(24) NOT NULL CHECK (status IN (${COMPONENT_STATUS_LIST})),
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
     CONSTRAINT uq_pos_clearing_components_key UNIQUE (component_key),
     CONSTRAINT ck_pos_clearing_components_verified
       CHECK (status <> 'VERIFIED' OR (zoho_record_id IS NOT NULL AND verified_at IS NOT NULL)),
     CONSTRAINT ck_pos_clearing_components_uncertain
       CHECK (status <> 'POSTING_UNCERTAIN' OR (uncertain_since IS NOT NULL AND first_uncertain_at IS NOT NULL))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_clearing_components_record
     ON pos_clearing_components (zoho_record_type, zoho_record_id) WHERE zoho_record_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_pos_clearing_components_settlement ON pos_clearing_components (settlement_id)`,
  `CREATE TABLE IF NOT EXISTS pos_clearing_events (
     id BIGSERIAL PRIMARY KEY,
     settlement_id BIGINT REFERENCES pos_settlements(id) ON DELETE RESTRICT,
     component_id BIGINT,
     transaction_id BIGINT,
     file_id BIGINT,
     settlement_code TEXT,
     event_type VARCHAR(40) NOT NULL,
     from_status VARCHAR(32),
     to_status VARCHAR(32),
     detail TEXT,
     evidence JSONB,
     actor TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_pos_clearing_events_settlement ON pos_clearing_events (settlement_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS pos_clearing_account_mappings (
     role VARCHAR(32) PRIMARY KEY CHECK (role IN ('UNDEPOSITED', 'PROCESSING', 'FEE_EXPENSE', 'INPUT_VAT', 'BANK')),
     account_id TEXT NOT NULL,
     account_name TEXT NOT NULL,
     account_code TEXT,
     account_type TEXT NOT NULL,
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
]

async function ensurePosSettlementTables(query: (sql: string) => Promise<unknown>) {
  for (const sql of SCHEMA_SQL) await query(sql)
}

function iso(value: unknown): string | null {
  return value ? new Date(value as string).toISOString() : null
}

function ymd(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  const d = new Date(value as Date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const num = (v: unknown) => (v == null ? null : Number(v))
const json = (v: unknown) => (v == null ? null : JSON.stringify(v))

function mapSettlement(row: any) {
  if (!row) return null
  return {
    id: String(row.id),
    provider: row.provider,
    payoutKey: row.payout_key,
    settlementCode: row.settlement_code,
    basis: row.basis,
    payoutDate: ymd(row.payout_date),
    currency: String(row.currency || '').trim(),
    status: row.status,
    review: row.review || null,
    approval: row.approval || null,
    bankStatus: row.bank_status || null,
    bankTransactionId: row.bank_transaction_id || null,
    bankEvidence: row.bank_evidence || null,
    postingFingerprint: row.posting_fingerprint || null,
    postingJob: row.posting_job || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    postedAt: iso(row.posted_at),
  }
}

function mapFile(row: any) {
  if (!row) return null
  return {
    id: String(row.id),
    provider: row.provider,
    fileHash: String(row.file_hash).trim(),
    fileName: row.file_name || null,
    sourceFormat: row.source_format,
    role: row.role,
    parserVersion: row.parser_version,
    summary: row.summary || {},
    transactionCount: Number(row.transaction_count) || 0,
    newCount: Number(row.new_count) || 0,
    duplicateCount: Number(row.duplicate_count) || 0,
    conflictCount: Number(row.conflict_count) || 0,
    importedBy: row.imported_by || null,
    createdAt: iso(row.created_at),
  }
}

function mapTransaction(row: any) {
  if (!row) return null
  return {
    id: String(row.id),
    fileId: String(row.file_id),
    payoutId: row.settlement_id == null ? null : String(row.settlement_id),
    organizationId: row.organization_id,
    provider: row.provider,
    sourceRow: Number(row.source_row),
    recordType: row.record_type || null,
    merchantId: row.merchant_id || null,
    merchantName: row.merchant_name || null,
    terminalId: row.terminal_id || null,
    rrn: row.rrn == null ? null : String(row.rrn),
    stan: row.stan || null,
    authCode: row.auth_code || null,
    transactionTypeRaw: row.transaction_type_raw || null,
    transactionType: row.transaction_type,
    transactionDate: ymd(row.transaction_date),
    transactionTime: row.transaction_time || null,
    currency: row.currency ? String(row.currency).trim() : null,
    minor: { gross: num(row.gross_minor), commission: num(row.commission_minor), otherFees: num(row.other_fees_minor), vat: num(row.vat_minor), net: num(row.net_minor) },
    netDerived: row.net_derived === true,
    batchNumber: row.batch_number || null,
    settlementId: row.settlement_ref || null,
    settlementDate: ymd(row.settlement_date),
    bankReference: row.bank_reference || null,
    cardScheme: row.card_scheme || null,
    maskedCard: row.masked_card || null,
    identityKey: String(row.identity_key).trim(),
    economicHash: String(row.economic_hash).trim(),
    status: row.status,
    duplicateOf: row.duplicate_of == null ? null : String(row.duplicate_of),
    conflictWith: row.conflict_with == null ? null : String(row.conflict_with),
    conflictFields: row.conflict_fields || null,
    payoutKey: row.payout_key || null,
    payoutBasis: row.payout_basis || null,
    warnings: row.warnings || [],
    raw: row.raw || {},
    statusReason: row.status_reason || null,
    statusBy: row.status_by || null,
    statusAt: iso(row.status_at),
    createdAt: iso(row.created_at),
  }
}

function mapIndexRow(row: any) {
  return {
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number || '',
    referenceNumber: row.reference_number || '',
    customerId: row.customer_id || '',
    customerName: row.customer_name || '',
    date: ymd(row.invoice_date) || '',
    totalMinor: Number(row.total_minor) || 0,
    balanceMinor: Number(row.balance_minor) || 0,
    currencyCode: row.currency_code || '',
    status: row.status || '',
    lastModifiedTime: row.last_modified_time || '',
    rrnField: row.rrn_field || '',
    rrns: row.rrns || [],
    malformed: row.malformed || [],
    scannedAt: iso(row.scanned_at),
  }
}

function mapManual(row: any) {
  return {
    id: String(row.id),
    transactionId: String(row.transaction_id),
    rrn: row.rrn || null,
    allocations: row.allocations || [],
    autoResult: row.auto_result || null,
    reason: row.reason,
    state: row.state,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    revokedBy: row.revoked_by || null,
    revokedAt: iso(row.revoked_at),
    revokeReason: row.revoke_reason || null,
  }
}

function mapTerminal(row: any) {
  return {
    id: String(row.id),
    provider: row.provider,
    merchantId: row.merchant_id,
    terminalId: row.terminal_id || null,
    channel: row.channel,
    location: row.location || null,
    notes: row.notes || null,
    active: row.active === true,
    createdBy: row.created_by || null,
    createdAt: iso(row.created_at),
  }
}

function mapComponent(row: any) {
  if (!row) return null
  return {
    id: String(row.id),
    settlementId: String(row.settlement_id),
    settlementCode: row.settlement_code,
    key: row.component_key,
    component: row.component,
    scope: row.scope,
    zohoRecordType: row.zoho_record_type,
    amount: Number(row.amount),
    currency: String(row.currency || '').trim(),
    reference: row.reference,
    customerId: row.customer_id || null,
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

function mapEvent(row: any) {
  return {
    id: String(row.id),
    settlementId: row.settlement_id == null ? null : String(row.settlement_id),
    componentId: row.component_id == null ? null : String(row.component_id),
    transactionId: row.transaction_id == null ? null : String(row.transaction_id),
    fileId: row.file_id == null ? null : String(row.file_id),
    settlementCode: row.settlement_code || null,
    eventType: row.event_type,
    fromStatus: row.from_status || null,
    toStatus: row.to_status || null,
    detail: row.detail || null,
    evidence: row.evidence || null,
    actor: row.actor || null,
    at: iso(row.created_at),
  }
}

function mapMapping(row: any) {
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

const LOCK_NAMESPACE = 0x504f5353 // "POSS"

/** Fields a parsed row contributes to pos_transactions (shared by both stores). */
function transactionFields(t: any, { organizationId, provider }: { organizationId: string; provider: string }) {
  const payout = model.payoutKeyOf(t)
  return {
    identityKey: model.transactionIdentity(t, { organizationId, provider }),
    economicHash: model.economicHash(t),
    payoutKey: payout.key,
    payoutBasis: payout.basis,
    payoutDate: payout.date,
  }
}

function createPgPosStore(db: any) {
  async function tx<T>(fn: (q: any) => Promise<T>): Promise<T> {
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

  async function logEvent(q: any, e: any) {
    await q.query(
      `INSERT INTO pos_clearing_events (settlement_id, component_id, transaction_id, file_id, settlement_code, event_type, from_status, to_status, detail, evidence, actor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [e.settlementId || null, e.componentId || null, e.transactionId || null, e.fileId || null, e.settlementCode || null, e.eventType, e.fromStatus || null, e.toStatus || null, e.detail || null, json(e.evidence), e.actor || null],
    )
  }

  return {
    kind: 'postgres',

    /**
     * Store a parsed file. Rows are classified against every ACTIVE row with the same RRN under
     * one advisory lock, so two concurrent uploads cannot both create the same transaction.
     */
    async importFile({ parsed, organizationId, provider, prefix, actor }: any) {
      return tx(async (q) => {
        await q.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [LOCK_NAMESPACE, `import:${provider}`])
        const found = await q.query('SELECT * FROM pos_settlement_files WHERE provider = $1 AND file_hash = $2', [provider, parsed.fileHash])
        if (found.rows[0]) {
          await logEvent(q, { fileId: found.rows[0].id, eventType: EVENT.ALREADY_IMPORTED, detail: `${parsed.fileName || 'File'} was already imported on ${iso(found.rows[0].created_at)}.`, evidence: { fileHash: parsed.fileHash }, actor })
          return { result: IMPORT_RESULT.ALREADY_IMPORTED, file: mapFile(found.rows[0]), transactions: [], settlementIds: [] }
        }
        const summary = { delimiter: parsed.delimiter, recordMarkers: parsed.recordMarkers, headers: parsed.headers, fieldMap: parsed.fieldMap, unmappedHeaders: parsed.unmappedHeaders, headerRecords: parsed.headerRecords, trailerRecords: parsed.trailerRecords, totalsRows: parsed.totalsRows, warnings: parsed.warnings }
        const ins = await q.query(
          `INSERT INTO pos_settlement_files (provider, file_hash, file_name, source_format, role, parser_version, summary, transaction_count, imported_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) RETURNING *`,
          [provider, parsed.fileHash, parsed.fileName || null, parsed.sourceFormat, parsed.role === 'CONTROL' ? 'CONTROL' : 'TRANSACTIONS', parsed.parserVersion, JSON.stringify(summary), parsed.transactions.length, actor || null],
        )
        const file = ins.rows[0]
        const counts = { NEW: 0, DUPLICATE: 0, CONFLICT: 0 }
        const outcome: any[] = []
        const settlementIds = new Set<string>()
        for (const t of parsed.transactions) {
          const f = transactionFields(t, { organizationId, provider })
          const existing = t.rrn
            ? (await q.query(`SELECT * FROM pos_transactions WHERE organization_id = $1 AND provider = $2 AND rrn = $3 AND status = 'ACTIVE'`, [organizationId, provider, t.rrn])).rows.map(mapTransaction)
            : []
          const cls = model.classifyIncoming(t, existing)
          let settlementId: string | null = null
          if (cls.status === 'NEW') {
            const code = model.settlementCodeOf(f.payoutKey, f.payoutDate, prefix)
            const s = await q.query(
              `INSERT INTO pos_settlements (provider, payout_key, settlement_code, basis, payout_date, currency)
               VALUES ($1, $2, $3, $4, $5, 'AED')
               ON CONFLICT (provider, payout_key) DO UPDATE SET updated_at = NOW() RETURNING *`,
              [provider, f.payoutKey, code, f.payoutBasis, f.payoutDate],
            )
            settlementId = String(s.rows[0].id)
            settlementIds.add(settlementId)
            if (['POSTING', 'PARTIALLY_POSTED', 'POSTED'].includes(s.rows[0].status)) {
              await logEvent(q, { settlementId, settlementCode: s.rows[0].settlement_code, fileId: file.id, eventType: EVENT.TRANSACTION_ADDED_AFTER_POSTING, detail: `RRN ${t.rrn} joined payout ${s.rows[0].settlement_code}, which is already ${s.rows[0].status}.`, actor })
            }
          }
          const status = cls.status === 'NEW' ? model.TXN_STATUS.ACTIVE : cls.status
          const r = await q.query(
            `INSERT INTO pos_transactions (file_id, settlement_id, organization_id, provider, source_row, record_type, merchant_id, merchant_name, terminal_id, rrn, stan, auth_code,
               transaction_type_raw, transaction_type, transaction_date, transaction_time, currency, gross_minor, commission_minor, other_fees_minor, vat_minor, net_minor, net_derived,
               batch_number, settlement_ref, settlement_date, bank_reference, card_scheme, masked_card, identity_key, economic_hash, status, duplicate_of, conflict_with, conflict_fields,
               payout_key, payout_basis, warnings, raw)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35::jsonb,$36,$37,$38::jsonb,$39::jsonb)
             RETURNING *`,
            [file.id, settlementId, organizationId, provider, t.sourceRow, t.recordType || null, t.merchantId, t.merchantName || null, t.terminalId, t.rrn, t.stan, t.authCode,
              t.transactionTypeRaw || null, t.transactionType || 'UNKNOWN', t.transactionDate, t.transactionTime || null, t.currency || null,
              t.minor.gross, t.minor.commission, t.minor.otherFees, t.minor.vat, t.minor.net, t.netDerived === true,
              t.batchNumber || null, t.settlementId || null, t.settlementDate || null, t.bankReference || null, t.cardScheme || null, t.maskedCard || null,
              f.identityKey, f.economicHash, status,
              cls.status === model.TXN_STATUS.DUPLICATE ? cls.match.id : null, cls.status === model.TXN_STATUS.CONFLICT ? cls.match.id : null,
              json(cls.differences.length ? cls.differences : null), f.payoutKey, f.payoutBasis, JSON.stringify(t.warnings || []), JSON.stringify(t.raw || {})],
          )
          const row = mapTransaction(r.rows[0])
          counts[cls.status as keyof typeof counts] += 1
          if (cls.status === model.TXN_STATUS.CONFLICT) {
            const target = await q.query('SELECT settlement_id, settlement_code FROM pos_transactions t LEFT JOIN pos_settlements s ON s.id = t.settlement_id WHERE t.id = $1', [cls.match.id])
            await logEvent(q, { settlementId: target.rows[0] && target.rows[0].settlement_id, settlementCode: target.rows[0] && target.rows[0].settlement_code, transactionId: row!.id, fileId: file.id, eventType: EVENT.TRANSACTION_CONFLICT, detail: `RRN ${t.rrn} (row ${t.sourceRow}) was imported before with different ${cls.differences.join(', ')}.`, evidence: { conflictWith: cls.match.id, differences: cls.differences }, actor })
            if (target.rows[0] && target.rows[0].settlement_id) settlementIds.add(String(target.rows[0].settlement_id))
          }
          outcome.push({ ...row, classification: cls.status, rrnReused: cls.rrnReused })
        }
        const upd = await q.query('UPDATE pos_settlement_files SET new_count = $2, duplicate_count = $3, conflict_count = $4 WHERE id = $1 RETURNING *', [file.id, counts.NEW, counts.DUPLICATE, counts.CONFLICT])
        for (const sid of settlementIds) {
          await logEvent(q, { settlementId: sid, fileId: file.id, eventType: EVENT.IMPORTED, detail: `${parsed.fileName || 'File'}: ${counts.NEW} new, ${counts.DUPLICATE} duplicate, ${counts.CONFLICT} conflicting rows.`, evidence: { fileHash: parsed.fileHash }, actor })
        }
        return { result: IMPORT_RESULT.IMPORTED, file: mapFile(upd.rows[0]), transactions: outcome, settlementIds: [...settlementIds], counts }
      })
    },

    async listFiles({ limit = 100 } = {}) {
      const { rows } = await db.query('SELECT * FROM pos_settlement_files ORDER BY id DESC LIMIT $1', [limit])
      return rows.map(mapFile)
    },

    async listSettlements({ limit = 200 } = {}) {
      const { rows } = await db.query(
        `SELECT s.*,
           (SELECT json_agg(json_build_object('status', c.status, 'component', c.component)) FROM pos_clearing_components c WHERE c.settlement_id = s.id) AS component_states,
           (SELECT json_build_object('count', COUNT(*), 'gross', COALESCE(SUM(t.gross_minor), 0), 'net', COALESCE(SUM(t.net_minor), 0))
              FROM pos_transactions t WHERE t.settlement_id = s.id AND t.status = 'ACTIVE') AS txn_totals
         FROM pos_settlements s ORDER BY s.payout_date DESC NULLS LAST, s.id DESC LIMIT $1`,
        [limit],
      )
      return rows.map((r: any) => ({ ...mapSettlement(r), componentStates: r.component_states || [], transactionTotals: r.txn_totals || null }))
    },

    async getSettlement(id: string) {
      const { rows } = await db.query('SELECT * FROM pos_settlements WHERE id = $1', [id])
      return mapSettlement(rows[0])
    },

    async updateSettlement(id: string, patch: any) {
      const { rows } = await db.query(
        `UPDATE pos_settlements SET
           status = COALESCE($2, status),
           review = COALESCE($3::jsonb, review),
           posting_fingerprint = COALESCE($4, posting_fingerprint),
           posted_at = COALESCE($5::timestamptz, posted_at),
           posting_job = COALESCE($6::jsonb, posting_job),
           approval = CASE WHEN $7::boolean THEN $8::jsonb ELSE approval END,
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, patch.status || null, json(patch.review), patch.postingFingerprint || null, patch.postedAt || null, json(patch.postingJob), Object.prototype.hasOwnProperty.call(patch, 'approval'), json(patch.approval)],
      )
      return mapSettlement(rows[0])
    },

    /** Link (or clear) the existing Zoho bank record; one Zoho record settles one payout only. */
    async setBankMatch(id: string, { status, transactionId, evidence, actor }: any) {
      try {
        const { rows } = await db.query(
          'UPDATE pos_settlements SET bank_status = $2, bank_transaction_id = $3, bank_evidence = $4::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *',
          [id, status, transactionId || null, json(evidence)],
        )
        const s = rows[0]
        await logEvent(db, { settlementId: id, settlementCode: s.settlement_code, eventType: transactionId ? EVENT.BANK_MATCHED : EVENT.BANK_UNLINKED, toStatus: status, detail: transactionId ? `Linked Zoho bank record ${transactionId}.` : 'Bank link removed.', evidence, actor })
        return mapSettlement(s)
      } catch (err: any) {
        if (err && err.code === '23505') throw storeError(409, 'BANK_RECORD_ALREADY_CLAIMED', `Zoho bank record ${transactionId} already settles another POS payout.`)
        throw err
      }
    },

    async listBankClaims() {
      const { rows } = await db.query('SELECT id, settlement_code, bank_transaction_id FROM pos_settlements WHERE bank_transaction_id IS NOT NULL')
      return rows.map((r: any) => ({ settlementId: String(r.id), settlementCode: r.settlement_code, transactionId: r.bank_transaction_id }))
    },

    async listTransactions(settlementId: string) {
      const { rows } = await db.query('SELECT * FROM pos_transactions WHERE settlement_id = $1 ORDER BY transaction_date, source_row, id', [settlementId])
      return rows.map(mapTransaction)
    },

    /** Later rows that disagree with this payout's transactions and are not dismissed. */
    async listOpenConflicts(settlementId: string) {
      const { rows } = await db.query(
        `SELECT c.* FROM pos_transactions c JOIN pos_transactions t ON t.id = c.conflict_with
         WHERE t.settlement_id = $1 AND c.status = 'CONFLICT' ORDER BY c.id`,
        [settlementId],
      )
      return rows.map(mapTransaction)
    },

    async getTransaction(id: string) {
      const { rows } = await db.query('SELECT * FROM pos_transactions WHERE id = $1', [id])
      return mapTransaction(rows[0])
    },

    async dismissConflict(id: string, { reason, actor }: any) {
      const { rows } = await db.query(
        `UPDATE pos_transactions SET status = 'DISMISSED', status_reason = $2, status_by = $3, status_at = NOW() WHERE id = $1 AND status = 'CONFLICT' RETURNING *`,
        [id, reason, actor],
      )
      if (!rows[0]) throw storeError(409, 'NOT_A_CONFLICT', `Transaction ${id} is not an open conflict.`)
      const target = await db.query('SELECT t.settlement_id, s.settlement_code FROM pos_transactions t LEFT JOIN pos_settlements s ON s.id = t.settlement_id WHERE t.id = $1', [rows[0].conflict_with])
      await logEvent(db, { settlementId: target.rows[0] && target.rows[0].settlement_id, settlementCode: target.rows[0] && target.rows[0].settlement_code, transactionId: id, eventType: EVENT.CONFLICT_DISMISSED, detail: `Conflicting row for RRN ${rows[0].rrn} dismissed: ${reason}`, actor })
      return mapTransaction(rows[0])
    },

    async findInvoicesByRrns(organizationId: string, rrns: string[]) {
      if (!rrns.length) return []
      const { rows } = await db.query('SELECT * FROM pos_rrn_invoice_index WHERE organization_id = $1 AND rrns && $2::text[]', [organizationId, rrns])
      return rows.map(mapIndexRow)
    },

    async getIndexedInvoices(organizationId: string, invoiceIds: string[]) {
      if (!invoiceIds.length) return []
      const { rows } = await db.query('SELECT * FROM pos_rrn_invoice_index WHERE organization_id = $1 AND invoice_id = ANY($2::text[])', [organizationId, invoiceIds])
      return rows.map(mapIndexRow)
    },

    async listIndexedInvoices(organizationId: string, { customerIds, dateFrom, dateTo }: any) {
      const { rows } = await db.query(
        'SELECT * FROM pos_rrn_invoice_index WHERE organization_id = $1 AND customer_id = ANY($2::text[]) AND invoice_date BETWEEN $3 AND $4',
        [organizationId, customerIds, dateFrom, dateTo],
      )
      return rows.map(mapIndexRow)
    },

    async upsertIndexedInvoice(organizationId: string, i: any) {
      await db.query(
        `INSERT INTO pos_rrn_invoice_index (organization_id, invoice_id, invoice_number, reference_number, customer_id, customer_name, invoice_date, total_minor, balance_minor,
           currency_code, status, last_modified_time, rrn_field, rrns, malformed, scanned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::text[], $15::text[], NOW())
         ON CONFLICT (organization_id, invoice_id) DO UPDATE SET invoice_number = EXCLUDED.invoice_number, reference_number = EXCLUDED.reference_number,
           customer_id = EXCLUDED.customer_id, customer_name = EXCLUDED.customer_name, invoice_date = EXCLUDED.invoice_date, total_minor = EXCLUDED.total_minor,
           balance_minor = EXCLUDED.balance_minor, currency_code = EXCLUDED.currency_code, status = EXCLUDED.status, last_modified_time = EXCLUDED.last_modified_time,
           rrn_field = EXCLUDED.rrn_field, rrns = EXCLUDED.rrns, malformed = EXCLUDED.malformed, scanned_at = NOW()`,
        [organizationId, i.invoiceId, i.invoiceNumber || null, i.referenceNumber || null, i.customerId || null, i.customerName || null, i.date || null, i.totalMinor, i.balanceMinor,
          i.currencyCode || null, i.status || null, i.lastModifiedTime || null, i.rrnField || null, i.rrns || [], i.malformed || []],
      )
    },

    async listActiveManualMappings(transactionIds: string[]) {
      if (!transactionIds.length) return []
      const { rows } = await db.query(`SELECT * FROM pos_manual_mappings WHERE transaction_id = ANY($1::bigint[]) AND state = 'ACTIVE'`, [transactionIds])
      return rows.map(mapManual)
    },

    async listManualMappingHistory(transactionId: string) {
      const { rows } = await db.query('SELECT * FROM pos_manual_mappings WHERE transaction_id = $1 ORDER BY id DESC', [transactionId])
      return rows.map(mapManual)
    },

    async saveManualMapping({ transactionId, rrn, allocations, autoResult, reason, actor, settlementId, settlementCode }: any) {
      return tx(async (q) => {
        await q.query(`UPDATE pos_manual_mappings SET state = 'REVOKED', revoked_by = $2, revoked_at = NOW(), revoke_reason = 'Replaced by a new mapping' WHERE transaction_id = $1 AND state = 'ACTIVE'`, [transactionId, actor])
        const { rows } = await q.query(
          `INSERT INTO pos_manual_mappings (transaction_id, rrn, allocations, auto_result, reason, created_by) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6) RETURNING *`,
          [transactionId, rrn || null, JSON.stringify(allocations), json(autoResult), reason, actor],
        )
        await logEvent(q, { settlementId, settlementCode, transactionId, eventType: EVENT.MANUAL_MAPPING_SAVED, detail: `RRN ${rrn || '—'} mapped to ${allocations.map((a: any) => `${a.invoiceNumber} ${(a.grossMinor / 100).toFixed(2)}`).join(', ')}: ${reason}`, evidence: { allocations, autoResult }, actor })
        return mapManual(rows[0])
      })
    },

    async revokeManualMapping(id: string, { reason, actor, settlementId, settlementCode }: any) {
      const { rows } = await db.query(
        `UPDATE pos_manual_mappings SET state = 'REVOKED', revoked_by = $2, revoked_at = NOW(), revoke_reason = $3 WHERE id = $1 AND state = 'ACTIVE' RETURNING *`,
        [id, actor, reason],
      )
      if (!rows[0]) throw storeError(404, 'MAPPING_NOT_FOUND', `Active manual mapping ${id} was not found.`)
      await logEvent(db, { settlementId, settlementCode, transactionId: rows[0].transaction_id, eventType: EVENT.MANUAL_MAPPING_REVOKED, detail: `Manual mapping revoked: ${reason}`, actor })
      return mapManual(rows[0])
    },

    async listTerminalMappings({ provider }: any) {
      const { rows } = await db.query('SELECT * FROM pos_terminal_mappings WHERE provider = $1 AND active ORDER BY merchant_id, terminal_id NULLS LAST', [provider])
      return rows.map(mapTerminal)
    },

    async saveTerminalMapping(m: any, actor: string) {
      return tx(async (q) => {
        await q.query(`UPDATE pos_terminal_mappings SET active = FALSE, removed_by = $4, removed_at = NOW() WHERE provider = $1 AND merchant_id = $2 AND COALESCE(terminal_id, '') = COALESCE($3, '') AND active`, [m.provider, m.merchantId, m.terminalId || null, actor])
        const { rows } = await q.query(
          'INSERT INTO pos_terminal_mappings (provider, merchant_id, terminal_id, channel, location, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
          [m.provider, m.merchantId, m.terminalId || null, m.channel, m.location || null, m.notes || null, actor],
        )
        await logEvent(q, { eventType: EVENT.TERMINAL_MAPPING_SAVED, detail: `Terminal ${m.merchantId}/${m.terminalId || '*'} → ${m.channel}.`, evidence: m, actor })
        return mapTerminal(rows[0])
      })
    },

    async removeTerminalMapping(id: string, actor: string) {
      const { rows } = await db.query('UPDATE pos_terminal_mappings SET active = FALSE, removed_by = $2, removed_at = NOW() WHERE id = $1 AND active RETURNING *', [id, actor])
      if (!rows[0]) throw storeError(404, 'TERMINAL_MAPPING_NOT_FOUND', `Terminal mapping ${id} was not found.`)
      await logEvent(db, { eventType: EVENT.TERMINAL_MAPPING_REMOVED, detail: `Terminal ${rows[0].merchant_id}/${rows[0].terminal_id || '*'} mapping removed.`, actor })
    },

    async listComponents(settlementId: string) {
      const { rows } = await db.query('SELECT * FROM pos_clearing_components WHERE settlement_id = $1 ORDER BY id', [settlementId])
      return rows.map(mapComponent)
    },

    async getComponent(id: string) {
      const { rows } = await db.query('SELECT * FROM pos_clearing_components WHERE id = $1', [id])
      return mapComponent(rows[0])
    },

    /** Create or refresh a planned component; one in flight, posted, verified or under review is returned unchanged. */
    async upsertPlannedComponent(settlementId: string, c: any, actor: string) {
      return tx(async (q) => {
        const found = await q.query('SELECT * FROM pos_clearing_components WHERE component_key = $1 FOR UPDATE', [c.key])
        const current = found.rows[0]
        if (current && String(current.settlement_id) !== String(settlementId)) throw storeError(409, 'COMPONENT_KEY_CONFLICT', `Component ${c.key} belongs to another payout.`)
        if (current && !REPLANNABLE.includes(current.status)) return { component: mapComponent(current), changed: false }
        const params = [c.zohoRecordType, c.amount, c.currency, c.reference, c.customerId || null, JSON.stringify(planOf(c)), actor || null]
        if (current) {
          const { rows } = await q.query(
            `UPDATE pos_clearing_components SET zoho_record_type = $1, amount = $2, currency = $3, reference = $4, customer_id = $5, plan = $6::jsonb, updated_by = $7, updated_at = NOW()
             WHERE id = $8 RETURNING *`,
            [...params, current.id],
          )
          return { component: mapComponent(rows[0]), changed: true }
        }
        const { rows } = await q.query(
          `INSERT INTO pos_clearing_components (zoho_record_type, amount, currency, reference, customer_id, plan, created_by, updated_by, settlement_id, settlement_code, component_key, component, scope, status)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7, $8, $9, $10, $11, $12, 'PLANNED') RETURNING *`,
          [...params, settlementId, c.settlementCode, c.key, c.component, c.scope],
        )
        await logEvent(q, { settlementId, componentId: rows[0].id, settlementCode: c.settlementCode, eventType: EVENT.PLANNED, toStatus: 'PLANNED', detail: `${c.component} ${c.amount.toFixed(2)} planned (${c.reference}).`, actor })
        return { component: mapComponent(rows[0]), changed: true }
      })
    },

    /** Guarded status change (same patch fields as the Tabby store). */
    async transitionComponent(id: string, fromStatuses: string[], toStatus: string, patch: any = {}, detail?: string | null, actor?: string) {
      return tx(async (q) => {
        const found = await q.query('SELECT * FROM pos_clearing_components WHERE id = $1 FOR UPDATE', [id])
        const current = found.rows[0]
        if (!current || !fromStatuses.includes(current.status)) {
          throw storeError(409, 'COMPONENT_STATE_CONFLICT', `Component ${id} is ${current ? current.status : 'missing'}, not ${fromStatuses.join('/')}; refusing to set ${toStatus}.`)
        }
        const { rows } = await q.query(
          `UPDATE pos_clearing_components SET
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
            patch.uncertainAt || null, patch.recoveryCheckAt || null, patch.recoveryStatus || null, json(patch.requestSnapshot), actor || null, patch.clearError === true],
        )
        await logEvent(q, { settlementId: current.settlement_id, componentId: id, settlementCode: current.settlement_code, eventType: patch.event || toStatus, fromStatus: current.status, toStatus, detail: detail || patch.lastError || null, evidence: patch.evidence, actor })
        return mapComponent(rows[0])
      })
    },

    async logEvent(e: any) {
      await logEvent(db, e)
    },

    async listEvents(settlementId: string) {
      const { rows } = await db.query('SELECT * FROM pos_clearing_events WHERE settlement_id = $1 ORDER BY created_at, id', [settlementId])
      return rows.map(mapEvent)
    },

    async listAccountMappings() {
      const { rows } = await db.query('SELECT * FROM pos_clearing_account_mappings ORDER BY role')
      return rows.map(mapMapping)
    },

    async saveAccountMapping(m: any, actor: string) {
      const { rows } = await db.query(
        `INSERT INTO pos_clearing_account_mappings (role, account_id, account_name, account_code, account_type, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (role) DO UPDATE SET account_id = EXCLUDED.account_id, account_name = EXCLUDED.account_name, account_code = EXCLUDED.account_code,
           account_type = EXCLUDED.account_type, updated_by = EXCLUDED.updated_by, updated_at = NOW()
         RETURNING *`,
        [m.role, m.accountId, m.accountName, m.accountCode || null, m.accountType, actor || null],
      )
      await logEvent(db, { eventType: EVENT.ACCOUNT_MAPPING_SAVED, detail: `${m.role} → ${m.accountName} (${m.accountCode || m.accountId}).`, evidence: m, actor })
      return mapMapping(rows[0])
    },

    async deleteAccountMapping(role: string, actor: string) {
      await db.query('DELETE FROM pos_clearing_account_mappings WHERE role = $1', [role])
      await logEvent(db, { eventType: EVENT.ACCOUNT_MAPPING_SAVED, detail: `${role} mapping removed; the role resolves by name again.`, actor })
    },

    /** Session advisory lock on a dedicated connection; a second poster fails fast. */
    async acquireSettlementLock(code: string) {
      if (typeof db.connect !== 'function') return { async release() {} }
      const client = await db.connect()
      let locked = false
      try {
        const { rows } = await client.query('SELECT pg_try_advisory_lock($1::int, hashtext($2)) AS locked', [LOCK_NAMESPACE, code])
        locked = rows[0] && rows[0].locked === true
      } catch (err) {
        client.release()
        throw err
      }
      if (!locked) {
        client.release()
        throw storeError(409, 'SETTLEMENT_POSTING_IN_PROGRESS', `Another request is already posting ${code}.`)
      }
      return {
        async release() {
          try {
            await client.query('SELECT pg_advisory_unlock($1::int, hashtext($2))', [LOCK_NAMESPACE, code])
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
  SETTLEMENT_STATUS,
  IMPORT_RESULT,
  EVENT,
  SCHEMA_SQL,
  ensurePosSettlementTables,
  createPgPosStore,
  transactionFields,
  storeError,
  planOf,
}

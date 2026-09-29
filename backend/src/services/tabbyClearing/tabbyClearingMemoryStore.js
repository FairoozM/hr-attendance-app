'use strict'

/**
 * In-memory implementation of the Tabby clearing store interface (see tabbyClearingStore.js).
 * Same rules as the Postgres store: statement-number + hash idempotency, one row per component
 * key, guarded transitions, one statement per Zoho bank record. Used by tests and by read-only
 * verification runs that must not write to any database.
 */

const { COMPONENT_STATUS, REPLANNABLE, IMPORT_RESULT, EVENT, storeError, planOf } = require('./tabbyClearingStore')

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function createMemoryTabbyStore() {
  let seq = 0
  const nextId = () => String(++seq)
  const batches = new Map()
  const rows = []
  const components = new Map()
  const events = []
  const mappings = new Map()
  const locks = new Set()
  const now = () => new Date().toISOString()

  function logEvent(e) {
    events.push({ id: nextId(), batchId: e.batchId || null, componentId: e.componentId || null, statementNumber: e.statementNumber || null, eventType: e.eventType, fromStatus: e.fromStatus || null, toStatus: e.toStatus || null, detail: e.detail || null, evidence: clone(e.evidence) || null, actor: e.actor || null, at: now() })
  }

  return {
    kind: 'memory',

    async importStatement({ parsed, analysis, fileName, actor }) {
      const st = parsed.statement
      const current = [...batches.values()].find((b) => b.statementNumber === st.statementNumber)
      if (current) {
        const same = current.fileHash === parsed.fileHash
        logEvent({ batchId: current.id, statementNumber: st.statementNumber, eventType: same ? EVENT.ALREADY_IMPORTED : EVENT.STATEMENT_VERSION_CONFLICT, evidence: { storedHash: current.fileHash, uploadedHash: parsed.fileHash, fileName: fileName || null }, actor })
        return { result: same ? IMPORT_RESULT.ALREADY_IMPORTED : IMPORT_RESULT.STATEMENT_VERSION_CONFLICT, batch: clone(current) }
      }
      const batch = {
        id: nextId(),
        statementNumber: st.statementNumber,
        fileHash: parsed.fileHash,
        fileName: fileName || null,
        statementDate: st.statementDate || null,
        transferDate: analysis.transferDate || null,
        companyName: st.companyName || null,
        currency: st.currencyFromNumber || 'AED',
        parsed: clone(parsed),
        totals: clone(analysis.totals || {}),
        status: 'IMPORTED',
        review: null,
        bankStatus: null,
        bankTransactionId: null,
        bankEvidence: null,
        postingFingerprint: null,
        importedBy: actor || null,
        createdAt: now(),
        updatedAt: now(),
        postedAt: null,
      }
      batches.set(batch.id, batch)
      for (const r of analysis.rows) {
        rows.push({
          id: nextId(),
          batchId: batch.id,
          statementNumber: st.statementNumber,
          excelRow: r.excelRow,
          kind: r.kind,
          subtype: r.subtype || null,
          orderNumber: r.orderNumber || '',
          websiteOrderId: r.websiteOrderId || '',
          saleRefundDate: r.saleRefundDate || null,
          fingerprint: r.fingerprint,
          grossMinor: r.effects ? r.effects.grossEffect : r.minor.orderAmount,
          transferredMinor: r.effects ? r.effects.transferEffect : r.minor.transferredAmount,
          effects: clone(r.effects) || null,
        })
      }
      logEvent({ batchId: batch.id, statementNumber: st.statementNumber, eventType: EVENT.IMPORTED, toStatus: 'IMPORTED', evidence: { fileHash: parsed.fileHash }, actor })
      return { result: IMPORT_RESULT.IMPORTED, batch: clone(batch) }
    },

    async listBatches() {
      return [...batches.values()]
        .sort((a, b) => String(b.statementDate).localeCompare(String(a.statementDate)) || Number(b.id) - Number(a.id))
        .map((b) => ({ ...clone(b), parsed: undefined, componentStates: [...components.values()].filter((c) => c.batchId === b.id).map((c) => ({ status: c.status, component: c.component })) }))
    },

    async getBatch(id) {
      return clone(batches.get(String(id)) || null)
    },

    async getBatchByStatement(statementNumber) {
      return clone([...batches.values()].find((b) => b.statementNumber === statementNumber) || null)
    },

    async updateBatch(id, patch) {
      const b = batches.get(String(id))
      if (!b) return null
      if (patch.status) b.status = patch.status
      if (patch.review != null) b.review = clone(patch.review)
      if (patch.postingFingerprint) b.postingFingerprint = patch.postingFingerprint
      if (patch.postedAt) b.postedAt = patch.postedAt
      b.updatedAt = now()
      return clone(b)
    },

    async setBankMatch(id, { status, transactionId, evidence, actor }) {
      const b = batches.get(String(id))
      if (transactionId) {
        const other = [...batches.values()].find((x) => x.id !== b.id && x.bankTransactionId === transactionId)
        if (other) throw storeError(409, 'BANK_RECORD_ALREADY_CLAIMED', `Zoho bank record ${transactionId} already settles ${other.statementNumber}.`)
      }
      b.bankStatus = status
      b.bankTransactionId = transactionId || null
      b.bankEvidence = clone(evidence) || null
      b.updatedAt = now()
      if (status === 'BANK_MATCHED') logEvent({ batchId: b.id, statementNumber: b.statementNumber, eventType: EVENT.BANK_MATCHED, toStatus: status, detail: `Linked existing Zoho bank record ${transactionId}.`, evidence, actor })
      return clone(b)
    },

    async listBankClaims() {
      return [...batches.values()].filter((b) => b.bankTransactionId).map((b) => ({ batchId: b.id, statementNumber: b.statementNumber, transactionId: b.bankTransactionId }))
    },

    async listRows(batchId) {
      return clone(rows.filter((r) => r.batchId === String(batchId)).sort((a, b) => a.excelRow - b.excelRow))
    },

    async listOtherStatementRows({ websiteOrderIds, batchId }) {
      const ids = new Set(websiteOrderIds)
      return rows
        .filter((r) => ids.has(r.websiteOrderId) && r.batchId !== String(batchId) && (r.kind === 'SALE' || r.kind === 'REFUND'))
        .map((r) => {
          const posted = [...components.values()].some((c) => c.batchId === r.batchId && c.rowFingerprint === r.fingerprint && c.component === 'REFUND_PAYMENT'
            && ['POSTED', 'VERIFIED', 'POSTING', 'POSTING_UNCERTAIN'].includes(c.status))
          return { ...clone(r), prior: Number(r.batchId) < Number(batchId) || posted }
        })
    },

    async listComponents(batchId) {
      return clone([...components.values()].filter((c) => c.batchId === String(batchId)).sort((a, b) => Number(a.id) - Number(b.id)))
    },

    async getComponent(id) {
      return clone(components.get(String(id)) || null)
    },

    async upsertPlannedComponent(batchId, c, actor) {
      const current = [...components.values()].find((x) => x.key === c.key)
      if (current && current.batchId !== String(batchId)) throw storeError(409, 'COMPONENT_KEY_CONFLICT', `Component ${c.key} belongs to another batch.`)
      if (current && !REPLANNABLE.includes(current.status)) return { component: clone(current), changed: false }
      const fields = {
        zohoRecordType: c.zohoRecordType,
        amount: c.amount,
        currency: c.currency,
        reference: c.reference,
        customerId: c.customerId || null,
        invoiceId: c.invoiceId || null,
        creditNoteId: c.creditNoteId || null,
        websiteOrderId: c.websiteOrderId || null,
        rowFingerprint: c.rowFingerprint || null,
        plan: planOf(c),
        updatedBy: actor || null,
        updatedAt: now(),
      }
      if (current) {
        Object.assign(current, fields)
        return { component: clone(current), changed: true }
      }
      const row = {
        id: nextId(),
        batchId: String(batchId),
        statementNumber: c.statementNumber,
        key: c.key,
        component: c.component,
        scope: c.scope,
        ...fields,
        status: COMPONENT_STATUS.PLANNED,
        zohoRecordId: null,
        attemptCount: 0,
        lastError: null,
        recoveryStatus: null,
        postedAt: null,
        verifiedAt: null,
        firstUncertainAt: null,
        uncertainSince: null,
        lastRecoveryCheckAt: null,
        recoveryCheckCount: 0,
        requestSnapshot: null,
        createdBy: actor || null,
        createdAt: now(),
      }
      components.set(row.id, row)
      logEvent({ batchId: row.batchId, componentId: row.id, statementNumber: c.statementNumber, eventType: EVENT.PLANNED, toStatus: 'PLANNED', detail: `${c.component} ${c.amount.toFixed(2)} planned (${c.reference}).`, actor })
      return { component: clone(row), changed: true }
    },

    async transitionComponent(id, fromStatuses, toStatus, patch = {}, detail, actor) {
      const current = components.get(String(id))
      if (!current || !fromStatuses.includes(current.status)) {
        throw storeError(409, 'COMPONENT_STATE_CONFLICT', `Component ${id} is ${current ? current.status : 'missing'}, not ${fromStatuses.join('/')}; refusing to set ${toStatus}.`)
      }
      if (patch.zohoRecordId && current.zohoRecordType !== 'creditnote_link') {
        const clash = [...components.values()].find((c) => c.id !== current.id && c.zohoRecordType === current.zohoRecordType && c.zohoRecordId === patch.zohoRecordId)
        if (clash) throw storeError(409, 'ZOHO_RECORD_ALREADY_LINKED', `Zoho record ${patch.zohoRecordId} is already linked to ${clash.key}.`)
      }
      const from = current.status
      if (toStatus === COMPONENT_STATUS.VERIFIED && !(patch.zohoRecordId || current.zohoRecordId) ) throw storeError(409, 'COMPONENT_STATE_CONFLICT', 'VERIFIED needs a Zoho record id.')
      current.status = toStatus
      if (patch.zohoRecordId) current.zohoRecordId = patch.zohoRecordId
      if (patch.incrementAttempt) current.attemptCount += 1
      if (patch.clearError) current.lastError = null
      else if (patch.lastError) current.lastError = patch.lastError
      if (patch.postedAt) current.postedAt = patch.postedAt
      if (patch.verifiedAt) current.verifiedAt = patch.verifiedAt
      if (patch.uncertainAt) {
        if (toStatus === COMPONENT_STATUS.POSTING_UNCERTAIN) current.uncertainSince = patch.uncertainAt
        if (!current.firstUncertainAt) current.firstUncertainAt = patch.uncertainAt
      }
      if (patch.recoveryCheckAt) {
        current.lastRecoveryCheckAt = patch.recoveryCheckAt
        current.recoveryCheckCount += 1
      }
      if (patch.recoveryStatus) current.recoveryStatus = patch.recoveryStatus
      if (patch.requestSnapshot != null) current.requestSnapshot = clone(patch.requestSnapshot)
      if (actor) current.updatedBy = actor
      current.updatedAt = now()
      logEvent({ batchId: current.batchId, componentId: current.id, statementNumber: current.statementNumber, eventType: patch.event || toStatus, fromStatus: from, toStatus, detail: detail || patch.lastError || null, evidence: patch.evidence, actor })
      return clone(current)
    },

    async logEvent(e) {
      logEvent(e)
    },

    async listEvents(batchId) {
      return clone(events.filter((e) => e.batchId === String(batchId)))
    },

    async listAccountMappings() {
      return clone([...mappings.values()])
    },

    async saveAccountMapping(m, actor) {
      const row = { role: m.role, accountId: m.accountId, accountName: m.accountName, accountCode: m.accountCode || null, accountType: m.accountType, updatedBy: actor || null, updatedAt: now() }
      mappings.set(m.role, row)
      logEvent({ eventType: EVENT.ACCOUNT_MAPPING_SAVED, detail: `${m.role} → ${m.accountName}.`, evidence: m, actor })
      return clone(row)
    },

    async deleteAccountMapping(role) {
      mappings.delete(role)
    },

    async acquireStatementLock(statementNumber) {
      if (locks.has(statementNumber)) throw storeError(409, 'STATEMENT_POSTING_IN_PROGRESS', `Another request is already posting ${statementNumber}.`)
      locks.add(statementNumber)
      return { async release() { locks.delete(statementNumber) } }
    },

    /** Test hook: raw access. */
    _debug: { batches, rows, components, events, mappings },
  }
}

module.exports = { createMemoryTabbyStore }

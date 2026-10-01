'use strict'

/**
 * In-memory implementation of the POS settlement store interface (see posSettlementStore.ts),
 * with the same rules: file-hash idempotency, RRN identity classification, one payout per key,
 * one row per component key, guarded transitions, one payout per Zoho bank record. Used by tests
 * and by read-only dry runs that must not write to any database.
 */

const { COMPONENT_STATUS, REPLANNABLE, IMPORT_RESULT, EVENT, storeError, planOf, transactionFields } = require('./posSettlementStore.ts')
const model = require('./posSettlementModel.ts')

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function createMemoryPosStore() {
  let seq = 0
  const nextId = () => String(++seq)
  const files = new Map<string, any>()
  const settlements = new Map<string, any>()
  const transactions = new Map<string, any>()
  const index = new Map<string, any>()
  const manual = new Map<string, any>()
  const terminals = new Map<string, any>()
  const components = new Map<string, any>()
  const events: any[] = []
  const mappings = new Map<string, any>()
  const locks = new Set<string>()
  const now = () => new Date().toISOString()

  function logEvent(e: any) {
    events.push({ id: nextId(), settlementId: e.settlementId ? String(e.settlementId) : null, componentId: e.componentId || null, transactionId: e.transactionId || null, fileId: e.fileId || null, settlementCode: e.settlementCode || null, eventType: e.eventType, fromStatus: e.fromStatus || null, toStatus: e.toStatus || null, detail: e.detail || null, evidence: clone(e.evidence) || null, actor: e.actor || null, at: now() })
  }

  const settlementOfTxn = (id: string | null) => {
    const t = id ? transactions.get(String(id)) : null
    return t && t.payoutId ? settlements.get(t.payoutId) : null
  }

  return {
    kind: 'memory',

    async importFile({ parsed, organizationId, provider, prefix, actor }: any) {
      const existingFile = [...files.values()].find((f) => f.provider === provider && f.fileHash === parsed.fileHash)
      if (existingFile) {
        logEvent({ fileId: existingFile.id, eventType: EVENT.ALREADY_IMPORTED, detail: `${parsed.fileName || 'File'} was already imported.`, evidence: { fileHash: parsed.fileHash }, actor })
        return { result: IMPORT_RESULT.ALREADY_IMPORTED, file: clone(existingFile), transactions: [], settlementIds: [] }
      }
      const file = {
        id: nextId(), provider, fileHash: parsed.fileHash, fileName: parsed.fileName || null, sourceFormat: parsed.sourceFormat, role: parsed.role === 'CONTROL' ? 'CONTROL' : 'TRANSACTIONS',
        parserVersion: parsed.parserVersion, summary: clone({ delimiter: parsed.delimiter, recordMarkers: parsed.recordMarkers, headers: parsed.headers, fieldMap: parsed.fieldMap, unmappedHeaders: parsed.unmappedHeaders, headerRecords: parsed.headerRecords, trailerRecords: parsed.trailerRecords, totalsRows: parsed.totalsRows, warnings: parsed.warnings }),
        transactionCount: parsed.transactions.length, newCount: 0, duplicateCount: 0, conflictCount: 0, importedBy: actor || null, createdAt: now(),
      }
      files.set(file.id, file)
      const counts = { NEW: 0, DUPLICATE: 0, CONFLICT: 0 }
      const outcome: any[] = []
      const settlementIds = new Set<string>()
      for (const t of parsed.transactions) {
        const f = transactionFields(t, { organizationId, provider })
        const existing = t.rrn ? [...transactions.values()].filter((x) => x.organizationId === organizationId && x.provider === provider && x.rrn === t.rrn && x.status === 'ACTIVE') : []
        const cls = model.classifyIncoming(t, existing)
        let payoutId: string | null = null
        if (cls.status === 'NEW') {
          let s = [...settlements.values()].find((x) => x.provider === provider && x.payoutKey === f.payoutKey)
          if (!s) {
            s = { id: nextId(), provider, payoutKey: f.payoutKey, settlementCode: model.settlementCodeOf(f.payoutKey, f.payoutDate, prefix), basis: f.payoutBasis, payoutDate: f.payoutDate, currency: 'AED', status: 'IMPORTED', review: null, approval: null, bankStatus: null, bankTransactionId: null, bankEvidence: null, postingFingerprint: null, postingJob: null, createdAt: now(), updatedAt: now(), postedAt: null }
            settlements.set(s.id, s)
          } else if (['POSTING', 'PARTIALLY_POSTED', 'POSTED'].includes(s.status)) {
            logEvent({ settlementId: s.id, settlementCode: s.settlementCode, fileId: file.id, eventType: EVENT.TRANSACTION_ADDED_AFTER_POSTING, detail: `RRN ${t.rrn} joined payout ${s.settlementCode}, which is already ${s.status}.`, actor })
          }
          payoutId = s.id
          settlementIds.add(s.id)
        }
        const row = {
          id: nextId(), fileId: file.id, payoutId, organizationId, provider, sourceRow: t.sourceRow, recordType: t.recordType || null, merchantId: t.merchantId, merchantName: t.merchantName || null,
          terminalId: t.terminalId, rrn: t.rrn, stan: t.stan, authCode: t.authCode, transactionTypeRaw: t.transactionTypeRaw || null, transactionType: t.transactionType || 'UNKNOWN',
          transactionDate: t.transactionDate, transactionTime: t.transactionTime || null, currency: t.currency || null, minor: clone(t.minor), netDerived: t.netDerived === true,
          batchNumber: t.batchNumber || null, settlementId: t.settlementId || null, settlementDate: t.settlementDate || null, bankReference: t.bankReference || null,
          cardScheme: t.cardScheme || null, maskedCard: t.maskedCard || null, identityKey: f.identityKey, economicHash: f.economicHash,
          status: cls.status === 'NEW' ? model.TXN_STATUS.ACTIVE : cls.status,
          duplicateOf: cls.status === model.TXN_STATUS.DUPLICATE ? cls.match.id : null,
          conflictWith: cls.status === model.TXN_STATUS.CONFLICT ? cls.match.id : null,
          conflictFields: cls.differences.length ? cls.differences : null, payoutKey: f.payoutKey, payoutBasis: f.payoutBasis,
          warnings: clone(t.warnings || []), raw: clone(t.raw || {}), statusReason: null, statusBy: null, statusAt: null, createdAt: now(),
        }
        if (row.status === 'ACTIVE' && [...transactions.values()].some((x) => x.status === 'ACTIVE' && x.identityKey === row.identityKey && x.transactionDate === row.transactionDate)) {
          throw storeError(409, 'IDENTITY_CONFLICT', `RRN ${t.rrn} is already an active transaction.`)
        }
        transactions.set(row.id, row)
        counts[cls.status as keyof typeof counts] += 1
        if (cls.status === model.TXN_STATUS.CONFLICT) {
          const target = settlementOfTxn(cls.match.id)
          logEvent({ settlementId: target && target.id, settlementCode: target && target.settlementCode, transactionId: row.id, fileId: file.id, eventType: EVENT.TRANSACTION_CONFLICT, detail: `RRN ${t.rrn} (row ${t.sourceRow}) was imported before with different ${cls.differences.join(', ')}.`, evidence: { conflictWith: cls.match.id, differences: cls.differences }, actor })
          if (target) settlementIds.add(target.id)
        }
        outcome.push({ ...clone(row), classification: cls.status, rrnReused: cls.rrnReused })
      }
      file.newCount = counts.NEW
      file.duplicateCount = counts.DUPLICATE
      file.conflictCount = counts.CONFLICT
      for (const sid of settlementIds) logEvent({ settlementId: sid, fileId: file.id, eventType: EVENT.IMPORTED, detail: `${parsed.fileName || 'File'}: ${counts.NEW} new, ${counts.DUPLICATE} duplicate, ${counts.CONFLICT} conflicting rows.`, evidence: { fileHash: parsed.fileHash }, actor })
      return { result: IMPORT_RESULT.IMPORTED, file: clone(file), transactions: outcome, settlementIds: [...settlementIds], counts }
    },

    async listFiles() {
      return clone([...files.values()].reverse())
    },

    async listSettlements() {
      return [...settlements.values()]
        .sort((a, b) => String(b.payoutDate).localeCompare(String(a.payoutDate)) || Number(b.id) - Number(a.id))
        .map((s) => {
          const txns = [...transactions.values()].filter((t) => t.payoutId === s.id && t.status === 'ACTIVE')
          return {
            ...clone(s),
            componentStates: [...components.values()].filter((c) => c.settlementId === s.id).map((c) => ({ status: c.status, component: c.component })),
            transactionTotals: { count: txns.length, gross: txns.reduce((x, t) => x + (t.minor.gross || 0), 0), net: txns.reduce((x, t) => x + (t.minor.net || 0), 0) },
          }
        })
    },

    async getSettlement(id: string) {
      return clone(settlements.get(String(id)) || null)
    },

    async updateSettlement(id: string, patch: any) {
      const s = settlements.get(String(id))
      if (!s) return null
      if (patch.status) s.status = patch.status
      if (patch.review != null) s.review = clone(patch.review)
      if (patch.postingFingerprint) s.postingFingerprint = patch.postingFingerprint
      if (patch.postedAt) s.postedAt = patch.postedAt
      if (patch.postingJob != null) s.postingJob = clone(patch.postingJob)
      if (Object.prototype.hasOwnProperty.call(patch, 'approval')) s.approval = clone(patch.approval) || null
      s.updatedAt = now()
      return clone(s)
    },

    async setBankMatch(id: string, { status, transactionId, evidence, actor }: any) {
      const s = settlements.get(String(id))
      if (transactionId) {
        const other = [...settlements.values()].find((x) => x.id !== s.id && x.bankTransactionId === transactionId)
        if (other) throw storeError(409, 'BANK_RECORD_ALREADY_CLAIMED', `Zoho bank record ${transactionId} already settles ${other.settlementCode}.`)
      }
      s.bankStatus = status
      s.bankTransactionId = transactionId || null
      s.bankEvidence = clone(evidence) || null
      s.updatedAt = now()
      logEvent({ settlementId: s.id, settlementCode: s.settlementCode, eventType: transactionId ? EVENT.BANK_MATCHED : EVENT.BANK_UNLINKED, toStatus: status, detail: transactionId ? `Linked Zoho bank record ${transactionId}.` : 'Bank link removed.', evidence, actor })
      return clone(s)
    },

    async listBankClaims() {
      return [...settlements.values()].filter((s) => s.bankTransactionId).map((s) => ({ settlementId: s.id, settlementCode: s.settlementCode, transactionId: s.bankTransactionId }))
    },

    async listTransactions(settlementId: string) {
      return clone([...transactions.values()].filter((t) => t.payoutId === String(settlementId)).sort((a, b) => String(a.transactionDate).localeCompare(String(b.transactionDate)) || a.sourceRow - b.sourceRow))
    },

    async listOpenConflicts(settlementId: string) {
      const own = new Set([...transactions.values()].filter((t) => t.payoutId === String(settlementId)).map((t) => t.id))
      return clone([...transactions.values()].filter((t) => t.status === 'CONFLICT' && own.has(t.conflictWith)))
    },

    async getTransaction(id: string) {
      return clone(transactions.get(String(id)) || null)
    },

    async dismissConflict(id: string, { reason, actor }: any) {
      const t = transactions.get(String(id))
      if (!t || t.status !== 'CONFLICT') throw storeError(409, 'NOT_A_CONFLICT', `Transaction ${id} is not an open conflict.`)
      t.status = 'DISMISSED'
      t.statusReason = reason
      t.statusBy = actor
      t.statusAt = now()
      const target = settlementOfTxn(t.conflictWith)
      logEvent({ settlementId: target && target.id, settlementCode: target && target.settlementCode, transactionId: id, eventType: EVENT.CONFLICT_DISMISSED, detail: `Conflicting row for RRN ${t.rrn} dismissed: ${reason}`, actor })
      return clone(t)
    },

    async findInvoicesByRrns(organizationId: string, rrns: string[]) {
      const want = new Set(rrns)
      return clone([...index.values()].filter((i) => i.organizationId === organizationId && i.rrns.some((r: string) => want.has(r))))
    },

    async getIndexedInvoices(organizationId: string, invoiceIds: string[]) {
      return clone(invoiceIds.map((id) => index.get(`${organizationId}|${id}`)).filter(Boolean))
    },

    async listIndexedInvoices(organizationId: string, { customerIds, dateFrom, dateTo }: any) {
      return clone([...index.values()].filter((i) => i.organizationId === organizationId && customerIds.includes(i.customerId) && i.date >= dateFrom && i.date <= dateTo))
    },

    async upsertIndexedInvoice(organizationId: string, i: any) {
      index.set(`${organizationId}|${i.invoiceId}`, { ...clone(i), organizationId, rrns: i.rrns || [], malformed: i.malformed || [], scannedAt: now() })
    },

    async listActiveManualMappings(transactionIds: string[]) {
      const ids = new Set(transactionIds.map(String))
      return clone([...manual.values()].filter((m) => m.state === 'ACTIVE' && ids.has(m.transactionId)))
    },

    async listManualMappingHistory(transactionId: string) {
      return clone([...manual.values()].filter((m) => m.transactionId === String(transactionId)).reverse())
    },

    async saveManualMapping({ transactionId, rrn, allocations, autoResult, reason, actor, settlementId, settlementCode }: any) {
      for (const m of manual.values()) {
        if (m.transactionId === String(transactionId) && m.state === 'ACTIVE') Object.assign(m, { state: 'REVOKED', revokedBy: actor, revokedAt: now(), revokeReason: 'Replaced by a new mapping' })
      }
      const row = { id: nextId(), transactionId: String(transactionId), rrn: rrn || null, allocations: clone(allocations), autoResult: clone(autoResult) || null, reason, state: 'ACTIVE', createdBy: actor, createdAt: now(), revokedBy: null, revokedAt: null, revokeReason: null }
      manual.set(row.id, row)
      logEvent({ settlementId, settlementCode, transactionId, eventType: EVENT.MANUAL_MAPPING_SAVED, detail: `RRN ${rrn || '—'} mapped manually: ${reason}`, evidence: { allocations, autoResult }, actor })
      return clone(row)
    },

    async revokeManualMapping(id: string, { reason, actor, settlementId, settlementCode }: any) {
      const m = manual.get(String(id))
      if (!m || m.state !== 'ACTIVE') throw storeError(404, 'MAPPING_NOT_FOUND', `Active manual mapping ${id} was not found.`)
      Object.assign(m, { state: 'REVOKED', revokedBy: actor, revokedAt: now(), revokeReason: reason })
      logEvent({ settlementId, settlementCode, transactionId: m.transactionId, eventType: EVENT.MANUAL_MAPPING_REVOKED, detail: `Manual mapping revoked: ${reason}`, actor })
      return clone(m)
    },

    async listTerminalMappings({ provider }: any) {
      return clone([...terminals.values()].filter((t) => t.provider === provider && t.active))
    },

    async saveTerminalMapping(m: any, actor: string) {
      for (const t of terminals.values()) {
        if (t.active && t.provider === m.provider && t.merchantId === m.merchantId && (t.terminalId || '') === (m.terminalId || '')) t.active = false
      }
      const row = { id: nextId(), provider: m.provider, merchantId: m.merchantId, terminalId: m.terminalId || null, channel: m.channel, location: m.location || null, notes: m.notes || null, active: true, createdBy: actor, createdAt: now() }
      terminals.set(row.id, row)
      logEvent({ eventType: EVENT.TERMINAL_MAPPING_SAVED, detail: `Terminal ${m.merchantId}/${m.terminalId || '*'} → ${m.channel}.`, evidence: m, actor })
      return clone(row)
    },

    async removeTerminalMapping(id: string, actor: string) {
      const t = terminals.get(String(id))
      if (!t || !t.active) throw storeError(404, 'TERMINAL_MAPPING_NOT_FOUND', `Terminal mapping ${id} was not found.`)
      t.active = false
      logEvent({ eventType: EVENT.TERMINAL_MAPPING_REMOVED, detail: `Terminal ${t.merchantId}/${t.terminalId || '*'} mapping removed.`, actor })
    },

    async listComponents(settlementId: string) {
      return clone([...components.values()].filter((c) => c.settlementId === String(settlementId)).sort((a, b) => Number(a.id) - Number(b.id)))
    },

    async getComponent(id: string) {
      return clone(components.get(String(id)) || null)
    },

    async upsertPlannedComponent(settlementId: string, c: any, actor: string) {
      const current = [...components.values()].find((x) => x.key === c.key)
      if (current && current.settlementId !== String(settlementId)) throw storeError(409, 'COMPONENT_KEY_CONFLICT', `Component ${c.key} belongs to another payout.`)
      if (current && !REPLANNABLE.includes(current.status)) return { component: clone(current), changed: false }
      const fields = { zohoRecordType: c.zohoRecordType, amount: c.amount, currency: c.currency, reference: c.reference, customerId: c.customerId || null, plan: planOf(c), updatedBy: actor || null, updatedAt: now() }
      if (current) {
        Object.assign(current, fields)
        return { component: clone(current), changed: true }
      }
      const row = {
        id: nextId(), settlementId: String(settlementId), settlementCode: c.settlementCode, key: c.key, component: c.component, scope: c.scope, ...fields,
        status: COMPONENT_STATUS.PLANNED, zohoRecordId: null, attemptCount: 0, lastError: null, recoveryStatus: null, postedAt: null, verifiedAt: null,
        firstUncertainAt: null, uncertainSince: null, lastRecoveryCheckAt: null, recoveryCheckCount: 0, requestSnapshot: null, createdBy: actor || null, createdAt: now(),
      }
      components.set(row.id, row)
      logEvent({ settlementId: row.settlementId, componentId: row.id, settlementCode: c.settlementCode, eventType: EVENT.PLANNED, toStatus: 'PLANNED', detail: `${c.component} ${c.amount.toFixed(2)} planned (${c.reference}).`, actor })
      return { component: clone(row), changed: true }
    },

    async transitionComponent(id: string, fromStatuses: string[], toStatus: string, patch: any = {}, detail?: string | null, actor?: string) {
      const current = components.get(String(id))
      if (!current || !fromStatuses.includes(current.status)) {
        throw storeError(409, 'COMPONENT_STATE_CONFLICT', `Component ${id} is ${current ? current.status : 'missing'}, not ${fromStatuses.join('/')}; refusing to set ${toStatus}.`)
      }
      if (patch.zohoRecordId) {
        const clash = [...components.values()].find((c) => c.id !== current.id && c.zohoRecordType === current.zohoRecordType && c.zohoRecordId === patch.zohoRecordId)
        if (clash) throw storeError(409, 'ZOHO_RECORD_ALREADY_LINKED', `Zoho record ${patch.zohoRecordId} is already linked to ${clash.key}.`)
      }
      if (toStatus === COMPONENT_STATUS.VERIFIED && !(patch.zohoRecordId || current.zohoRecordId)) throw storeError(409, 'COMPONENT_STATE_CONFLICT', 'VERIFIED needs a Zoho record id.')
      const from = current.status
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
      logEvent({ settlementId: current.settlementId, componentId: current.id, settlementCode: current.settlementCode, eventType: patch.event || toStatus, fromStatus: from, toStatus, detail: detail || patch.lastError || null, evidence: patch.evidence, actor })
      return clone(current)
    },

    async logEvent(e: any) {
      logEvent(e)
    },

    async listEvents(settlementId: string) {
      return clone(events.filter((e) => e.settlementId === String(settlementId)))
    },

    async listAccountMappings() {
      return clone([...mappings.values()])
    },

    async saveAccountMapping(m: any, actor: string) {
      const row = { role: m.role, accountId: m.accountId, accountName: m.accountName, accountCode: m.accountCode || null, accountType: m.accountType, updatedBy: actor || null, updatedAt: now() }
      mappings.set(m.role, row)
      logEvent({ eventType: EVENT.ACCOUNT_MAPPING_SAVED, detail: `${m.role} → ${m.accountName}.`, evidence: m, actor })
      return clone(row)
    },

    async deleteAccountMapping(role: string) {
      mappings.delete(role)
    },

    async acquireSettlementLock(code: string) {
      if (locks.has(code)) throw storeError(409, 'SETTLEMENT_POSTING_IN_PROGRESS', `Another request is already posting ${code}.`)
      locks.add(code)
      return { async release() { locks.delete(code) } }
    },

    /** Test hook: raw access. */
    _debug: { files, settlements, transactions, index, manual, terminals, components, events, mappings },
  }
}

module.exports = { createMemoryPosStore }

'use strict'

/**
 * Builds the reviewable preview of one Mashreq payout: transactions with RRN match and channel,
 * live invoice assessment, the posting plan, ledger effect, bank and fee-recognition status, the
 * Zoho state of every planned record, blockers and the posting fingerprint. Read-only towards Zoho;
 * locally it only refreshes the RRN index and (when `persist`) the settlement review summary.
 */

const model = require('./posSettlementModel.ts')
const posZoho = require('./posSettlementZoho.ts')
const { POS_ACCOUNT_ROLE: ROLE, POS_CHANNEL: CHANNEL } = require('../../config/posSettlement.ts')
const { filsToMajor: M, formatFils } = require('./posMoney.ts')
const { SETTLEMENT_STATUS, COMPONENT_STATUS, REPLANNABLE } = require('./posSettlementStore.ts')
const tabbyZoho = require('../tabbyClearing/tabbyClearingZoho')
const { RECOVERY_ACTION, planRecovery } = require('../tabbyClearing/tabbyClearingPreviewService')

const { COMPONENT, BANK_STATUS, FEE_STATUS, INVOICE_MODE, MATCH_STATUS } = model
const { ZOHO_STATE } = tabbyZoho

// Stripe clearing accounts must never carry POS money.
const FORBIDDEN_ACCOUNT_CODES = new Set(['1019', '1013', '2270'])

function issue(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { code, message, ...extra }
}

function accountLabel(accounts: any, role: string): string {
  const a = accounts[role]
  return a ? `${a.accountName}${a.accountCode ? ` (${a.accountCode})` : ''}` : `${role} (unmapped)`
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

function notFound(id: string) {
  const err: any = new Error(`POS settlement ${id} was not found.`)
  err.status = 404
  err.code = 'SETTLEMENT_NOT_FOUND'
  return err
}

function componentView(c: any, accounts: any, local: any, zoho: any, recovery: any) {
  return {
    key: c.key,
    component: c.component,
    phase: c.phase,
    scope: c.scope,
    zohoRecordType: c.zohoRecordType,
    reference: c.reference,
    amount: c.amount,
    date: c.date,
    customerId: c.customerId || null,
    allocations: (c.allocations || []).map((a: any) => ({ invoiceId: a.invoiceId, invoiceNumber: a.invoiceNumber, amount: a.amount })),
    depositAccount: c.depositRole ? accountLabel(accounts, c.depositRole) : null,
    fromAccount: c.fromRole ? accountLabel(accounts, c.fromRole) : null,
    toAccount: c.toRole ? accountLabel(accounts, c.toRole) : null,
    lines: (c.lines || []).map((l: any) => ({ role: l.role, account: accountLabel(accounts, l.role), accountId: l.accountId, side: l.side, amount: M(l.amountMinor) })),
    payload: c.payload,
    local: local ? { id: local.id, status: local.status, zohoRecordId: local.zohoRecordId, attemptCount: local.attemptCount, lastError: local.lastError, recoveryStatus: local.recoveryStatus, uncertainSince: local.uncertainSince, verifiedAt: local.verifiedAt } : null,
    zoho,
    recovery,
  }
}

/**
 * @param input.refreshIndex read changed Zoho invoices into the RRN index first (default true)
 * @param input.deepScan kept for callers; every invoice of the scanned customers is always indexed
 * @param input.deep search Zoho directly (not only the search index) for every planned record
 */
async function buildPosPreview({ settlementId, store, sources, config, now = new Date(), persist = true, refreshIndex = true, deepScan = false, deep = false }: any) {
  const settlement = await store.getSettlement(settlementId)
  if (!settlement) throw notFound(settlementId)
  const code = settlement.settlementCode
  const allTxns = await store.listTransactions(settlementId)
  const txns = allTxns.filter((t: any) => t.status === model.TXN_STATUS.ACTIVE)
  const blockers: any[] = []
  const warnings: any[] = []
  const zohoCalls = { before: typeof sources.callCount === 'function' ? sources.callCount() : null }

  for (const c of await store.listOpenConflicts(settlementId)) {
    blockers.push(issue('TRANSACTION_CONFLICT', `A later file (row ${c.sourceRow}) reports RRN ${c.rrn} with different ${(c.conflictFields || []).join(', ')}; confirm which is right (dismiss the conflict) before posting.`, { scope: 'TRANSACTION', transactionId: c.conflictWith, conflictId: c.id }))
  }
  const rrnCount = new Map<string, number>()
  for (const t of txns) if (t.rrn) rrnCount.set(t.rrn, (rrnCount.get(t.rrn) || 0) + 1)
  for (const [rrn, n] of rrnCount) if (n > 1) blockers.push(issue('DUPLICATE_RRN', `RRN ${rrn} appears on ${n} different transactions in this payout (different terminal or STAN); map each manually.`, { scope: 'TRANSACTION', rrn }))

  // Accounts
  let chart: any[] = []
  try {
    chart = await sources.listChartAccounts()
  } catch (err: any) {
    blockers.push(issue('ZOHO_ACCOUNTS_UNAVAILABLE', `Zoho chart of accounts could not be read: ${err.message}`, { scope: 'ACCOUNTS' }))
  }
  const mappings = await store.listAccountMappings()
  const { accounts, problems: accountProblems } = chart.length ? tabbyZoho.resolveAccounts(chart, mappings, config.accountRoles) : { accounts: {} as any, problems: [] as any[] }
  for (const p of accountProblems) blockers.push({ ...p, scope: 'ACCOUNTS' })
  for (const a of Object.values(accounts) as any[]) {
    if (a.accountCode && FORBIDDEN_ACCOUNT_CODES.has(a.accountCode)) blockers.push(issue('FORBIDDEN_ACCOUNT', `${a.label} resolves to ${a.accountName} (${a.accountCode}), a Stripe clearing account; POS money never goes there.`, { scope: 'ACCOUNTS' }))
  }

  // RRN index
  const firstDate = txns.map((t: any) => t.transactionDate).filter(Boolean).sort()[0] || settlement.payoutDate
  const lastDate = txns.map((t: any) => t.transactionDate).filter(Boolean).sort().pop() || settlement.payoutDate
  const window = { dateFrom: model.addDays(firstDate, -config.rrnScanDaysBefore), dateTo: model.addDays(lastDate, config.rrnScanDaysAfter) }
  let indexOk = true
  let indexStats = null
  if (refreshIndex && txns.length) {
    try {
      const r = await posZoho.refreshRrnIndex({ sources, store, config, ...window, deep: deepScan })
      indexStats = r.stats
      warnings.push(...r.warnings)
    } catch (err: any) {
      indexOk = false
      blockers.push(issue('RRN_INDEX_FAILED', `Zoho invoices could not be indexed for RRN: ${err.message}`, { scope: 'MATCHING' }))
    }
  }

  // Matching
  const manualList = await store.listActiveManualMappings(txns.map((t: any) => t.id))
  const manualByTxn = new Map(manualList.map((m: any) => [m.transactionId, m]))
  const hits = indexOk ? await store.findInvoicesByRrns(config.organizationId, txns.map((t: any) => t.rrn).filter(Boolean)) : []
  const indexedInWindow = indexOk ? await store.listIndexedInvoices(config.organizationId, { customerIds: config.rrnScanCustomerIds, ...window }) : []
  const matches = new Map<string, any>()
  for (const t of txns) {
    const m = model.matchTransaction({ txn: t, rrnHits: indexOk ? hits.filter((i: any) => t.rrn && i.rrns.includes(t.rrn)) : null, manual: manualByTxn.get(t.id) || null, config })
    if (!m.matched && m.status === MATCH_STATUS.RRN_NOT_FOUND) (m as any).possible = model.possibleMatches(t, indexedInWindow, config.possibleMatchDays)
    matches.set(t.id, m)
  }

  // Live invoices
  const invoiceIds = [...new Set([...matches.values()].flatMap((m: any) => m.allocations.map((a: any) => a.invoiceId)))] as string[]
  const states = new Map<string, any>()
  await mapLimit(invoiceIds, 3, async (id) => {
    try {
      states.set(id, await posZoho.loadInvoiceState(sources, id, { critical: deep }))
    } catch (err: any) {
      states.set(id, err)
    }
  })
  let orders: any[] | null = null
  try {
    orders = await sources.loadOrdersByInvoiceNumbers([...states.values()].filter((s) => s && !(s instanceof Error)).map((s: any) => s.referenceNumber))
  } catch (err: any) {
    warnings.push(issue('WEBSITE_DB_UNAVAILABLE', `Website orders could not be read (${err.message}); channel comes from terminal mapping and Zoho customer only.`))
  }
  const orderByNumber = new Map((orders || []).map((o: any) => [o.orderNumber, o]))
  const terminalMappings = await store.listTerminalMappings({ provider: config.provider })

  // Per transaction: live validation, channel, split
  const partsByInvoice = new Map<string, any[]>()
  const rrnsByInvoice = new Map<string, string[]>()
  const txnViews: any[] = []
  const channelOf = new Map<string, string>()
  for (const t of txns) {
    const m = matches.get(t.id)
    const problems: any[] = []
    let channel = { channel: CHANNEL.UNKNOWN, source: null as string | null, evidence: [] as any[], mismatch: null as string | null }
    let order = null
    if (m.matched) {
      const first = states.get(m.allocations[0].invoiceId)
      for (const a of m.allocations) {
        const s = states.get(a.invoiceId)
        if (s instanceof Error) problems.push(issue('INVOICE_LOOKUP_FAILED', `Zoho invoice ${a.invoiceNumber} could not be read: ${s.message}`))
        else if (!s) problems.push(issue('INVOICE_MISSING', `Zoho invoice ${a.invoiceNumber} no longer exists.`))
        else {
          if (s.status === 'void' || s.status === 'draft') problems.push(issue('INVOICE_NOT_PAYABLE', `Zoho invoice ${s.invoiceNumber} is ${s.status}.`))
          if (s.customerId !== a.customerId) problems.push(issue('CUSTOMER_MISMATCH', `Zoho invoice ${s.invoiceNumber} now belongs to ${s.customerName}, not the mapped customer.`))
          if (s.currencyCode && s.currencyCode !== config.currency) problems.push(issue('CURRENCY_MISMATCH', `Zoho invoice ${s.invoiceNumber} is in ${s.currencyCode}.`))
        }
      }
      if (first && !(first instanceof Error)) {
        order = orderByNumber.get(first.referenceNumber) || null
        channel = model.resolveChannel({ txn: t, order, invoiceCustomerId: first.customerId, terminalMappings, config })
        if (channel.mismatch) problems.push(issue('CHANNEL_MISMATCH', channel.mismatch))
        else if (channel.channel === CHANNEL.UNKNOWN) warnings.push(issue('CHANNEL_UNKNOWN', `RRN ${t.rrn}: no website order, terminal mapping or customer decides the channel.`, { transactionId: t.id }))
        if (order && order.paymentMethod && order.paymentMethod !== 'pos') warnings.push(issue('ORDER_NOT_POS', `RRN ${t.rrn}: website order ${order.orderNumber} is recorded as ${order.paymentMethod}, not POS (mixed payment?).`, { transactionId: t.id }))
        if (order && order.deleted) problems.push(issue('ORDER_DELETED', `Website order ${order.orderNumber} is deleted.`))
      }
      if (!problems.length) {
        const parts = model.splitTransaction(t, m.allocations)
        for (const p of parts) {
          partsByInvoice.set(p.invoiceId, [...(partsByInvoice.get(p.invoiceId) || []), { ...p, transactionId: t.id }])
          rrnsByInvoice.set(p.invoiceId, [...(rrnsByInvoice.get(p.invoiceId) || []), t.rrn].filter(Boolean))
        }
      }
    } else {
      const tm = model.terminalChannel(t, terminalMappings)
      if (tm) channel = { channel: tm.channel, source: 'TERMINAL_MAPPING', evidence: [], mismatch: null }
      problems.push(issue(m.status, m.reason))
    }
    channelOf.set(t.id, channel.channel)
    for (const p of problems) blockers.push({ ...p, scope: 'TRANSACTION', transactionId: t.id, rrn: t.rrn })
    txnViews.push({
      id: t.id,
      sourceRow: t.sourceRow,
      fileId: t.fileId,
      merchantId: t.merchantId,
      terminalId: t.terminalId,
      rrn: t.rrn,
      stan: t.stan,
      authCode: t.authCode,
      transactionType: t.transactionType,
      transactionDate: t.transactionDate,
      transactionTime: t.transactionTime,
      batchNumber: t.batchNumber,
      cardScheme: t.cardScheme,
      maskedCard: t.maskedCard,
      gross: t.minor.gross == null ? null : M(t.minor.gross),
      commission: t.minor.commission == null ? null : M(t.minor.commission),
      otherFees: t.minor.otherFees == null ? null : M(t.minor.otherFees),
      vat: t.minor.vat == null ? null : M(t.minor.vat),
      net: t.minor.net == null ? null : M(t.minor.net),
      netDerived: t.netDerived,
      match: { status: m.status, reason: m.reason, matched: m.matched, allocations: m.allocations.map((a: any) => ({ ...a, gross: M(a.grossMinor) })), candidates: m.candidates || null, possible: m.possible || [] },
      manualMapping: manualByTxn.get(t.id) || null,
      channel: channel.channel,
      channelSource: channel.source,
      channelEvidence: channel.evidence,
      order: order ? { orderNumber: order.orderNumber, shopOrder: order.shopOrder, userAgent: order.userAgent, paymentMethod: order.paymentMethod } : null,
      problems,
      warnings: t.warnings || [],
    })
  }

  const analysis = model.analyzeSettlement(txns, config, (t: any) => channelOf.get(t.id) || CHANNEL.UNKNOWN)
  for (const b of analysis.blockers) blockers.push({ ...b, scope: b.transactionId ? 'TRANSACTION' : 'SETTLEMENT' })
  const totals = analysis.totals

  // Invoice assessment
  const invoices: any[] = []
  for (const [invoiceId, parts] of partsByInvoice) {
    const state = states.get(invoiceId)
    if (!state || state instanceof Error) continue
    const a = model.assessInvoice({ state, parts, accounts, ownPrefix: `${code}/`, workflowPrefix: config.referencePrefix, rrns: rrnsByInvoice.get(invoiceId) || [] })
    invoices.push(a)
    if (a.problem) blockers.push({ ...a.problem, scope: 'INVOICE', invoiceId })
    if (a.mode === INVOICE_MODE.EXISTING_RECEIPTS) warnings.push(issue('EXISTING_RECEIPTS_REUSED', `Invoice ${a.invoiceNumber} already has POS receipts of ${formatFils(a.grossMinor)}; they are reused${a.reclassMinor ? ` and ${formatFils(Math.abs(a.reclassMinor))} is reclassified between POS Undeposited and POS Processing` : ''}.`, { invoiceId }))
    if (a.partial) warnings.push(issue('PARTIAL_PAYMENT', `Invoice ${a.invoiceNumber} stays partly open after this payout (${formatFils(a.balanceMinor + a.ownAppliedMinor - a.grossMinor)} left).`, { invoiceId }))
  }

  // Local components (anything already sent keeps its place in the plan)
  const localList = await store.listComponents(settlementId)
  const local = new Map(localList.map((c: any) => [c.key, c]))
  const payoutDate = settlement.payoutDate || lastDate
  const ownBankReference = `${code}/BANK`
  const feeTotalMinor = totals.commissionMinor + totals.otherFeesMinor + totals.vatMinor
  const accountsReady = accountProblems.length === 0 && chart.length > 0
  const localBank: any = local.get(`${code}|${COMPONENT.BANK_CLEARING}|PAYOUT`)
  const localFee: any = local.get(`${code}|${COMPONENT.FEE_RECOGNITION}|PAYOUT`)

  let bank: any
  if (localBank && !REPLANNABLE.includes(localBank.status)) {
    bank = { status: BANK_STATUS.BANK_DEPOSIT_SEEN, amountMinor: totals.netMinor, matched: null, date: (localBank.requestSnapshot && localBank.requestSnapshot.date) || localBank.plan.date, recordedByWorkflow: true, reason: `The POS → RAK transfer is recorded by this workflow (${localBank.status}).` }
  } else if (!accountsReady) {
    bank = { status: BANK_STATUS.BANK_LOOKUP_FAILED, amountMinor: totals.netMinor, matched: null, reason: 'Accounts are not resolved.' }
  } else {
    bank = await posZoho.findBankMatch({ sources, accounts, amountMinor: totals.netMinor, payoutDate, code, ownReference: ownBankReference, claims: await store.listBankClaims(), settlementId, currentTransactionId: settlement.bankTransactionId, config })
    if (bank.status === BANK_STATUS.BANK_DEPOSIT_SEEN) bank.date = bank.deposit.date
  }
  bank.linkedTransactionId = settlement.bankTransactionId || null

  let feeRecognition: any
  if (localFee && !REPLANNABLE.includes(localFee.status)) feeRecognition = { status: FEE_STATUS.NONE_FOUND, recordedByWorkflow: true, reason: `Fee recognition is recorded by this workflow (${localFee.status}).` }
  else if (!accountsReady) feeRecognition = { status: FEE_STATUS.LOOKUP_FAILED, reason: 'Accounts are not resolved.' }
  else feeRecognition = await posZoho.findExistingFeeRecognition({ sources, accounts, feeTotalMinor, payoutDate, invoiceNumbers: invoices.map((i) => i.invoiceNumber), ownReference: `${code}/FEES`, config })
  if (feeRecognition.status === FEE_STATUS.UNCERTAIN || (feeRecognition.status === FEE_STATUS.LOOKUP_FAILED && accountsReady)) blockers.push(issue(`FEE_RECOGNITION_${feeRecognition.status}`, feeRecognition.reason, { scope: 'FEES' }))
  if (feeRecognition.status === FEE_STATUS.ALREADY_RECOGNIZED) warnings.push(issue('FEE_ALREADY_RECOGNIZED', `${feeRecognition.reason} The fee journal is skipped.`))

  // Plan
  const plannable = invoices.filter((i) => i.mode !== INVOICE_MODE.BLOCKED)
  const plan = model.buildPostingPlan({ code, invoices: plannable, totals, accounts, date: payoutDate, config, feeRecognition, bank })
  for (const c of plan) {
    for (const p of model.componentProblems(c)) {
      if (!accountsReady && /unmapped|has no/.test(p)) continue
      blockers.push(issue('PLAN_INVALID', p, { scope: 'COMPONENT', key: c.key }))
    }
  }
  const planKeys = new Set(plan.map((c: any) => c.key))
  for (const l of localList as any[]) {
    if (!planKeys.has(l.key) && !REPLANNABLE.includes(l.status)) blockers.push(issue('PLAN_DRIFT', `${l.component} ${l.reference} is ${l.status} but is no longer part of the plan; review before posting.`, { scope: 'COMPONENT', key: l.key }))
  }

  // Zoho state of each planned record
  const settleMs = config.uncertainSettleMinutes * 60000
  const nowMs = now.getTime()
  const zohoStates = new Map<string, any>()
  const untouched = new Set(invoices.filter((i) => i.mode === INVOICE_MODE.NEW && i.ownAppliedMinor === 0).map((i) => i.invoiceId))
  for (const c of plan) {
    const l: any = local.get(c.key)
    if (!deep && c.zohoRecordType === 'customer_payment' && (!l || REPLANNABLE.includes(l.status)) && c.allocations.every((a: any) => untouched.has(a.invoiceId))) {
      zohoStates.set(c.key, { state: ZOHO_STATE.MISSING, reason: 'None of its invoices has a payment from this payout.' })
    } else if (!deep && l && l.status === COMPONENT_STATUS.VERIFIED) {
      zohoStates.set(c.key, { state: ZOHO_STATE.VERIFIED, recordId: l.zohoRecordId, reason: `Verified ${l.verifiedAt ? l.verifiedAt.slice(0, 10) : ''} (Zoho ${l.zohoRecordId}).` })
    }
  }
  await mapLimit(plan.filter((c: any) => !zohoStates.has(c.key)), 3, async (c: any) => {
    const l: any = local.get(c.key)
    zohoStates.set(c.key, await tabbyZoho.componentZohoState({ ...c, requestSnapshot: l ? l.requestSnapshot : null }, sources, { deep }))
  })
  const components = plan.map((c: any) => {
    const l = local.get(c.key) || null
    const zoho = zohoStates.get(c.key)
    return componentView(c, accounts, l, zoho, planRecovery(zoho, l, { nowMs, settleMs }))
  })
  for (const c of components) {
    if (c.recovery.action === RECOVERY_ACTION.NEEDS_REVIEW) blockers.push(issue(c.recovery.code || 'NEEDS_REVIEW', `${c.component} ${c.reference}: ${c.recovery.reason}`, { scope: 'COMPONENT', key: c.key }))
    if (c.recovery.action === RECOVERY_ACTION.LOOKUP_FAILED) blockers.push(issue('ZOHO_LOOKUP_FAILED', `${c.component} ${c.reference}: ${c.recovery.reason}`, { scope: 'COMPONENT', key: c.key }))
  }

  // Ledger (this payout only)
  const bankLinked = bank.status === BANK_STATUS.BANK_MATCHED
  const ledger = model.simulateLedger(plan, { invoices: plannable, existingBankMinor: bankLinked ? totals.netMinor : 0, existingFeeMinor: feeRecognition.status === FEE_STATUS.ALREADY_RECOGNIZED ? feeTotalMinor : 0 })
  const bal = (role: string) => ledger[role] || 0
  const allMatched = txns.length > 0 && [...matches.values()].every((m: any) => m.matched)
  if (allMatched && blockers.length === 0) {
    const arLeft = Object.entries(ledger).filter(([k, v]) => k.startsWith('AR:') && v !== 0)
    if (arLeft.length) blockers.push(issue('INVOICE_NOT_CLEARED', `${arLeft.length} invoice(s) would not be cleared by exactly this payout's gross.`, { scope: 'LEDGER' }))
    if (bal(ROLE.PROCESSING) !== 0) blockers.push(issue('PROCESSING_NOT_CLEARED', `POS Processing would end at ${formatFils(bal(ROLE.PROCESSING))} for this payout, not 0.00.`, { scope: 'LEDGER' }))
    const expectedUnd = bankLinked || plan.some((c: any) => c.component === COMPONENT.BANK_CLEARING) ? 0 : totals.netMinor
    if (bal(ROLE.UNDEPOSITED) !== expectedUnd) blockers.push(issue('UNDEPOSITED_MISMATCH', `POS Undeposited would end at ${formatFils(bal(ROLE.UNDEPOSITED))} for this payout, expected ${formatFils(expectedUnd)}.`, { scope: 'LEDGER' }))
    const grossPlanned = plannable.reduce((s, i) => s + i.grossMinor, 0)
    if (grossPlanned !== totals.grossMinor) blockers.push(issue('GROSS_NOT_ALLOCATED', `Invoices take ${formatFils(grossPlanned)} of the payout's gross ${formatFils(totals.grossMinor)}.`, { scope: 'LEDGER' }))
  }
  if (bank.status === BANK_STATUS.BANK_MATCH_AMBIGUOUS || bank.status === BANK_STATUS.BANK_LOOKUP_FAILED || bank.status === BANK_STATUS.BANK_DEPOSIT_NOT_FOUND) {
    warnings.push(issue(bank.status, `${bank.reason} Receipts and fees can still be posted.`))
  }

  const fingerprint = model.postingFingerprint({ code, date: payoutDate, components: plan, bank, feeRecognition, transactions: txns })
  const approval = settlement.approval || null
  const approved = Boolean(approval && approval.fingerprint === fingerprint)
  const verified = components.filter((c: any) => c.recovery.action === RECOVERY_ACTION.SKIP_VERIFIED).length
  const pending = components.filter((c: any) => c.recovery.action !== RECOVERY_ACTION.SKIP_VERIFIED)
  const bankComplete = bank.status === BANK_STATUS.BANK_NOT_REQUIRED || (bankLinked && settlement.bankTransactionId === (bank.matched && bank.matched.transactionId)) || bank.recordedByWorkflow
  let status
  if (components.some((c: any) => c.recovery.action === RECOVERY_ACTION.NEEDS_REVIEW)) status = SETTLEMENT_STATUS.NEEDS_REVIEW
  else if (blockers.length) status = SETTLEMENT_STATUS.BLOCKED
  else if (pending.length === 0 && bankComplete) status = SETTLEMENT_STATUS.POSTED
  else if (verified > 0 || settlement.bankTransactionId) status = SETTLEMENT_STATUS.PARTIALLY_POSTED
  else status = SETTLEMENT_STATUS.READY

  const byChannel = Object.fromEntries(Object.entries(analysis.byChannel).map(([ch, t]: any) => [ch, { count: t.count, gross: M(t.grossMinor), commission: M(t.commissionMinor + t.otherFeesMinor), vat: M(t.vatMinor), net: M(t.netMinor) }]))
  const preview = {
    settlementId: String(settlementId),
    settlementCode: code,
    payoutKey: settlement.payoutKey,
    basis: settlement.basis,
    payoutDate,
    status,
    postingEnabled: config.postingEnabled === true,
    approval,
    approved,
    canApprove: blockers.length === 0 && status !== SETTLEMENT_STATUS.POSTED,
    canPost: config.postingEnabled === true && approved && blockers.length === 0 && status !== SETTLEMENT_STATUS.POSTED,
    fingerprint,
    blockers,
    warnings,
    accounts: { resolved: accounts, problems: accountProblems, mappings },
    totals: {
      count: totals.count,
      gross: M(totals.grossMinor),
      commission: M(totals.commissionMinor),
      otherFees: M(totals.otherFeesMinor),
      vat: M(totals.vatMinor),
      charges: M(feeTotalMinor),
      net: M(totals.netMinor),
    },
    byChannel,
    merchants: analysis.merchants,
    terminals: analysis.terminals,
    batches: analysis.batches,
    firstDate: analysis.firstDate,
    lastDate: analysis.lastDate,
    transactions: txnViews,
    inactiveTransactions: allTxns.filter((t: any) => t.status !== model.TXN_STATUS.ACTIVE).map((t: any) => ({ id: t.id, rrn: t.rrn, status: t.status, sourceRow: t.sourceRow, duplicateOf: t.duplicateOf, conflictWith: t.conflictWith, conflictFields: t.conflictFields })),
    invoices: invoices.map((i) => ({ ...i, total: M(i.totalMinor), balance: M(i.balanceMinor), gross: M(i.grossMinor), net: M(i.netMinor), fee: M(i.feeMinor), reclass: M(i.reclassMinor) })),
    bank: { ...bank, amount: M(bank.amountMinor) },
    feeRecognition,
    components,
    ledger: Object.fromEntries(Object.entries(ledger).filter(([k]) => !k.startsWith('AR:')).map(([k, v]) => [k, { account: accountLabel(accounts, k), balance: M(v as number) }])),
    rrnIndex: { window, stats: indexStats },
    counts: {
      transactions: txns.length,
      matched: [...matches.values()].filter((m: any) => m.matched).length,
      components: components.length,
      verified,
      toPost: components.filter((c: any) => [RECOVERY_ACTION.POST_ELIGIBLE, RECOVERY_ACTION.RETRY_ELIGIBLE, RECOVERY_ACTION.RECHECK_THEN_RETRY].includes(c.recovery.action)).length,
      review: components.filter((c: any) => c.recovery.action === RECOVERY_ACTION.NEEDS_REVIEW).length,
    },
    zohoCalls: zohoCalls.before == null ? null : sources.callCount() - zohoCalls.before,
    _plan: plan,
    _bank: bank,
  }
  if (persist) {
    await store.updateSettlement(settlementId, {
      status,
      review: { at: now.toISOString(), status, fingerprint, blockers: blockers.length, warnings: warnings.length, counts: preview.counts, bankStatus: bank.status, feeStatus: feeRecognition.status, totals: preview.totals, byChannel },
    })
  }
  return preview
}

function publicPreview(preview: any) {
  const { _plan, _bank, ...rest } = preview
  return rest
}

module.exports = { buildPosPreview, publicPreview, RECOVERY_ACTION }

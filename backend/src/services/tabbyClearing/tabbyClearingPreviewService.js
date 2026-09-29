'use strict'

/**
 * Tabby settlement preview: everything posting would do, computed before any Zoho write.
 * Read-only towards Zoho and the website; the only local write is the batch's review summary.
 *
 * Steps: re-analyze the stored statement → resolve accounts → match every sale/refund row to its
 * website order and Zoho invoice → assess refunds (cumulative, duplicates, credit note) → match
 * the bank payout → build the posting plan → read each component's Zoho state → recovery action
 * per component → ledger simulation → guards → posting fingerprint.
 */

const { ROW_KIND } = require('./tabbyStatementParser')
const model = require('./tabbyClearingModel')
const zohoChecks = require('./tabbyClearingZoho')
const { COMPONENT_STATUS, REPLANNABLE, BATCH_STATUS } = require('./tabbyClearingStore')
const { ACCOUNT_ROLE } = require('../../config/tabbyClearing')
const { getDubaiPostingDate } = require('../stripeClearing/stripePostingDate')

const { COMPONENT, PLAN_LAYOUT, MATCH_STATUS, BANK_STATUS, toMajor, money } = model

const isSalePayment = (c) => c.component === COMPONENT.SALE_NET || c.component === COMPONENT.SALE_CHARGES

/** Fils a sale payment applies to one invoice (0 when it does not touch it). */
function appliedTo(c, invoiceId) {
  if (c.allocations && c.allocations.length) return c.allocations.filter((a) => a.invoiceId === invoiceId).reduce((s, a) => s + Math.round(a.amount * 100), 0)
  return c.invoiceId === invoiceId ? Math.round(c.amount * 100) : 0
}
const { ZOHO_STATE } = zohoChecks

const RECOVERY_ACTION = Object.freeze({
  SKIP_VERIFIED: 'SKIP_VERIFIED',
  POST_ELIGIBLE: 'POST_ELIGIBLE',
  RETRY_ELIGIBLE: 'RETRY_ELIGIBLE',
  // Uncertain attempt; Zoho still shows nothing but the settle window has not passed.
  WAIT_UNCERTAIN: 'WAIT_UNCERTAIN',
  // Uncertain attempt; the settle window passed, posting searches Zoho again before resending.
  RECHECK_THEN_RETRY: 'RECHECK_THEN_RETRY',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  LOOKUP_FAILED: 'LOOKUP_FAILED',
})

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const index = i++
      out[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * @param {{ state: string, recordId?: string, reason?: string }} zoho
 * @param {object|null} local stored component
 */
function planRecovery(zoho, local, { nowMs, settleMs }) {
  const status = local ? local.status : null
  if (zoho.state === ZOHO_STATE.LOOKUP_FAILED) return { action: RECOVERY_ACTION.LOOKUP_FAILED, reason: zoho.reason }
  if (zoho.state === ZOHO_STATE.AMBIGUOUS) return { action: RECOVERY_ACTION.NEEDS_REVIEW, code: 'AMBIGUOUS_RECOVERY', reason: zoho.reason }
  if (zoho.state === ZOHO_STATE.CONFLICT) return { action: RECOVERY_ACTION.NEEDS_REVIEW, code: 'ZOHO_RECORD_CONFLICT', reason: zoho.reason }
  if (zoho.state === ZOHO_STATE.VERIFIED) {
    if (local && local.zohoRecordId && local.zohoRecordId !== zoho.recordId) {
      return { action: RECOVERY_ACTION.NEEDS_REVIEW, code: 'ZOHO_RECORD_MISMATCH', reason: `Local record points to Zoho ${local.zohoRecordId}, but Zoho has ${zoho.recordId}.` }
    }
    return { action: RECOVERY_ACTION.SKIP_VERIFIED, reason: zoho.reason }
  }
  if (status === COMPONENT_STATUS.POSTING_UNCERTAIN || status === COMPONENT_STATUS.POSTING) {
    const since = Date.parse(local.uncertainSince || local.updatedAt)
    const waited = nowMs - since
    return waited >= settleMs
      ? { action: RECOVERY_ACTION.RECHECK_THEN_RETRY, reason: `Earlier attempt's result was unknown; Zoho still has no record ${Math.round(waited / 60000)} min later. Posting searches Zoho once more and only resends if it is still missing.` }
      : { action: RECOVERY_ACTION.WAIT_UNCERTAIN, reason: `Earlier attempt's result was unknown; recheck after ${new Date(since + settleMs).toISOString()} before anything is resent.` }
  }
  if (status === COMPONENT_STATUS.POSTED || status === COMPONENT_STATUS.VERIFIED) {
    return { action: RECOVERY_ACTION.NEEDS_REVIEW, code: 'ZOHO_RECORD_MISSING', reason: `Recorded as ${status} (${local.zohoRecordId || 'no ID'}) but Zoho no longer has it.` }
  }
  if (status === COMPONENT_STATUS.NEEDS_REVIEW) return { action: RECOVERY_ACTION.NEEDS_REVIEW, code: 'LOCAL_REVIEW', reason: local.lastError || 'Flagged for review.' }
  if (status === COMPONENT_STATUS.FAILED) return { action: RECOVERY_ACTION.RETRY_ELIGIBLE, reason: local.lastError ? `Earlier attempt failed (${local.lastError}); Zoho holds no record.` : 'Zoho holds no record; eligible for retry.' }
  return { action: RECOVERY_ACTION.POST_ELIGIBLE, reason: 'Not in Zoho yet.' }
}

function rowView(r) {
  return {
    excelRow: r.excelRow,
    kind: r.kind,
    subtype: r.subtype,
    orderNumber: r.orderNumber,
    websiteOrderId: r.websiteOrderId,
    saleRefundDate: r.saleRefundDate,
    transferDate: r.transferDate,
    productType: r.productType,
    fingerprint: r.fingerprint,
    signNormalized: r.signNormalized || false,
    amounts: Object.fromEntries(Object.entries(r.minor || {}).map(([k, v]) => [k, toMajor(v)])),
    effects: r.effects ? Object.fromEntries(Object.entries(r.effects).map(([k, v]) => [k, toMajor(v)])) : null,
    problems: r.problems,
    warnings: r.warnings,
    raw: r.raw,
    match: r.match
      ? {
          status: r.match.status,
          reason: r.match.reason,
          warnings: r.match.warnings || [],
          order: r.match.order ? { orderId: r.match.order.orderId, orderNumber: r.match.order.orderNumber, status: r.match.order.orderStatus, paymentStatus: r.match.order.paymentStatus, paymentMethod: r.match.order.paymentMethod, total: r.match.order.finalAmount, shopOrder: r.match.order.shopOrder, createdAt: r.match.order.createdAt } : null,
          invoice: r.match.invoice ? { invoiceId: r.match.invoice.invoiceId, invoiceNumber: r.match.invoice.invoiceNumber, status: r.match.invoice.status, total: r.match.invoice.total, balance: r.match.invoice.balance, customerId: r.match.invoice.customerId } : null,
          customerId: r.match.customerId || null,
          invoiceState: r.invoiceState || null,
        }
      : null,
    refund: r.refund
      ? {
          code: r.refund.code,
          problem: r.refund.problem,
          kind: r.refund.kind,
          sequence: r.refund.sequence,
          priorRefunded: toMajor(r.refund.priorMinor),
          cumulativeRefunded: toMajor(r.refund.cumulativeMinor),
          creditNote: r.refund.creditNote ? { creditNoteId: r.refund.creditNote.creditNoteId, creditNoteNumber: r.refund.creditNote.creditNoteNumber, total: r.refund.creditNote.total, balance: r.refund.creditNote.balance, how: r.refund.creditNoteHow } : null,
          creditNoteProblem: r.refund.creditNoteProblem || null,
        }
      : null,
  }
}

function accountLabel(accounts, role) {
  const a = accounts[role]
  return a ? `${a.accountName}${a.accountCode ? ` (${a.accountCode})` : ''}` : `${role} (unmapped)`
}

function componentView(c, accounts, local, zoho, recovery) {
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
    invoiceId: c.invoiceId || null,
    invoiceNumber: c.invoiceNumber || null,
    websiteOrderId: c.websiteOrderId || null,
    creditNoteId: c.creditNoteId || null,
    creditNoteNumber: c.creditNoteNumber || null,
    allocations: (c.allocations || []).map((a) => ({ invoiceId: a.invoiceId, invoiceNumber: a.invoiceNumber, websiteOrderId: a.websiteOrderId || null, amount: a.amount })),
    depositAccount: c.depositRole ? accountLabel(accounts, c.depositRole) : null,
    fromAccount: c.fromRole ? accountLabel(accounts, c.fromRole) : null,
    toAccount: c.toRole ? accountLabel(accounts, c.toRole) : null,
    lines: (c.lines || []).map((l) => ({ role: l.role, account: accountLabel(accounts, l.role), accountId: l.accountId, side: l.side, amount: toMajor(l.amountMinor) })),
    direction: c.direction || null,
    sourceRows: c.sourceRows || [],
    payload: c.payload,
    local: local
      ? { id: local.id, status: local.status, zohoRecordId: local.zohoRecordId, attemptCount: local.attemptCount, lastError: local.lastError, recoveryStatus: local.recoveryStatus, uncertainSince: local.uncertainSince, recoveryCheckCount: local.recoveryCheckCount, verifiedAt: local.verifiedAt }
      : null,
    zoho,
    recovery,
  }
}

/**
 * @param {{ batchId: string, store: object, sources: object, config: object, now?: Date, deep?: boolean, persist?: boolean }} input
 */
async function buildTabbyPreview({ batchId, store, sources, config, now = new Date(), deep = false, persist = true }) {
  const batch = await store.getBatch(batchId)
  if (!batch) {
    const err = new Error(`Tabby batch ${batchId} was not found.`)
    err.status = 404
    err.code = 'BATCH_NOT_FOUND'
    throw err
  }
  const statementNumber = batch.statementNumber
  const analysis = model.analyzeStatement(batch.parsed, config)
  const blockers = analysis.blockers.map((b) => ({ ...b, scope: 'STATEMENT' }))
  const warnings = [...analysis.warnings]
  const rows = analysis.rows
  const date = getDubaiPostingDate(now)

  // Accounts
  let chart = []
  try {
    chart = await sources.listChartAccounts()
  } catch (err) {
    blockers.push(issue('ZOHO_ACCOUNTS_UNAVAILABLE', `Zoho chart of accounts could not be read: ${err.message}`, { scope: 'ACCOUNTS' }))
  }
  const mappings = await store.listAccountMappings()
  const { accounts, problems: accountProblems } = chart.length ? zohoChecks.resolveAccounts(chart, mappings, config.accountRoles) : { accounts: {}, problems: [] }
  for (const p of accountProblems) blockers.push({ ...p, scope: 'ACCOUNTS' })

  // Matching
  const txRows = rows.filter((r) => r.kind === ROW_KIND.SALE || r.kind === ROW_KIND.REFUND)
  let byId = []
  let byNumber = []
  let websiteOk = true
  try {
    byId = await sources.loadWebsiteOrdersByIds(txRows.map((r) => r.orderNumber))
    byNumber = await sources.loadWebsiteOrdersByInvoiceNumbers(txRows.map((r) => r.websiteOrderId))
  } catch (err) {
    websiteOk = false
    blockers.push(issue('WEBSITE_DB_UNAVAILABLE', `Website orders could not be read: ${err.message}`, { scope: 'MATCHING' }))
  }
  const invoiceCache = new Map()
  const invoiceNumbers = [...new Set(txRows.map((r) => r.websiteOrderId).filter(Boolean))]
  await mapLimit(invoiceNumbers, 4, async (ref) => {
    try {
      invoiceCache.set(ref, await sources.findInvoicesByReference(ref))
    } catch (err) {
      invoiceCache.set(ref, err)
    }
  })
  for (const r of txRows) {
    if (!websiteOk) {
      r.match = { status: 'LOOKUP_FAILED', matched: false, reason: 'Website orders could not be read.', warnings: [] }
      continue
    }
    const inv = invoiceCache.get(r.websiteOrderId)
    if (inv instanceof Error) {
      r.match = { status: 'LOOKUP_FAILED', matched: false, reason: `Zoho invoices for ${r.websiteOrderId} could not be read: ${inv.message}`, warnings: [] }
      continue
    }
    r.match = model.matchRow({
      row: r,
      byId: byId.filter((o) => o.orderId === r.orderNumber),
      byNumber: byNumber.filter((o) => o.orderNumber === r.websiteOrderId),
      zohoInvoices: inv || [],
      config,
    })
  }
  for (const r of txRows) {
    if (!r.match.matched) blockers.push(issue(r.match.status, r.match.reason, { scope: 'ROW', excelRow: r.excelRow, websiteOrderId: r.websiteOrderId }))
    for (const w of r.match.warnings || []) warnings.push({ ...w, excelRow: r.excelRow })
  }

  // Other statements (duplicates, cumulative refunds)
  const otherRows = await store.listOtherStatementRows({ websiteOrderIds: invoiceNumbers, batchId })
  for (const r of rows.filter((x) => x.kind === ROW_KIND.SALE)) {
    const dup = otherRows.find((o) => o.kind === 'SALE' && o.websiteOrderId === r.websiteOrderId && Number(o.batchId) < Number(batchId))
    if (dup) blockers.push(issue('DUPLICATE_SALE_ACROSS_STATEMENTS', `Order ${r.websiteOrderId} was already settled as a sale in ${dup.statementNumber}.`, { scope: 'ROW', excelRow: r.excelRow }))
  }
  const refunds = rows.filter((r) => r.kind === ROW_KIND.REFUND && r.problems.length === 0)
  const priorRefunds = otherRows.filter((o) => o.kind === 'REFUND' && o.prior).map((o) => ({ fingerprint: o.fingerprint, websiteOrderId: o.websiteOrderId, statementNumber: o.statementNumber, grossMinor: o.grossMinor }))
  const invoiceTotal = new Map(txRows.filter((r) => r.match && r.match.invoice).map((r) => [r.websiteOrderId, Math.round(r.match.invoice.total * 100)]))
  const refundAssessment = model.assessRefunds({ refunds, priorRefunds, invoiceTotalMinor: (id) => (invoiceTotal.has(id) ? invoiceTotal.get(id) : null) })
  const claimed = new Map()
  for (const r of [...refunds].sort((a, b) => clean(a.saleRefundDate).localeCompare(clean(b.saleRefundDate)) || a.excelRow - b.excelRow)) {
    r.refund = { ...refundAssessment.get(r.fingerprint) }
    if (r.refund.code) {
      blockers.push(issue(r.refund.code, r.refund.problem, { scope: 'ROW', excelRow: r.excelRow, websiteOrderId: r.websiteOrderId }))
      continue
    }
    if (!r.match || !r.match.matched) continue
    const amountMinor = -r.effects.grossEffect
    try {
      const sel = await zohoChecks.selectRefundCreditNote({
        sources,
        order: r.match.order,
        invoice: r.match.invoice,
        amountMinor,
        reference: `${statementNumber}/${r.websiteOrderId}/R${r.refund.sequence}/REFUND`,
        statementNumber,
        claimedMinor: claimed,
      })
      if (!sel.ok) {
        r.refund.creditNoteProblem = { code: sel.code, message: sel.message }
        blockers.push(issue(sel.code, sel.message, { scope: 'ROW', excelRow: r.excelRow, websiteOrderId: r.websiteOrderId }))
      } else {
        r.refund.creditNote = sel.creditNote
        r.refund.creditNoteHow = sel.how
        r.refund.candidateCreditNoteIds = sel.candidateCreditNoteIds
        if (sel.how !== 'ALREADY_REFUNDED_BY_WORKFLOW') claimed.set(sel.creditNote.creditNoteId, (claimed.get(sel.creditNote.creditNoteId) || 0) + amountMinor)
      }
    } catch (err) {
      r.refund.creditNoteProblem = { code: 'CREDIT_NOTE_LOOKUP_FAILED', message: err.message }
      blockers.push(issue('CREDIT_NOTE_LOOKUP_FAILED', `Credit notes for order ${r.websiteOrderId} could not be read: ${err.message}`, { scope: 'ROW', excelRow: r.excelRow }))
    }
  }

  // Local components and bank
  const localList = await store.listComponents(batchId)
  const local = new Map(localList.map((c) => [c.key, c]))
  const bankKey = `${statementNumber}|${COMPONENT.BANK_SETTLEMENT}|STATEMENT`
  const localBank = local.get(bankKey)
  let bank
  const amountMinor = analysis.totals.bankPayoutMinor
  if (localBank && !REPLANNABLE.includes(localBank.status)) {
    bank = { status: BANK_STATUS.BANK_MATCH_PENDING, amountMinor, matched: null, candidates: [], reason: `The bank transfer is recorded by this workflow (${localBank.status}).`, recordedByWorkflow: true }
  } else {
    bank = await zohoChecks.findBankMatch({
      sources,
      accounts,
      amountMinor,
      transferDate: analysis.transferDate || batch.statementDate,
      statementNumber,
      ownReference: `${statementNumber}/BANK_SETTLEMENT`,
      claims: await store.listBankClaims(),
      batchId,
      currentTransactionId: batch.bankTransactionId,
      config,
    })
  }
  bank.linkedTransactionId = batch.bankTransactionId || null

  // Plan. A statement with anything already sent in the per-invoice layout stays in it, so no
  // record is ever planned twice under a different key.
  const layout = localList.some((l) => !REPLANNABLE.includes(l.status) && model.isPerInvoiceComponent(l)) ? PLAN_LAYOUT.PER_INVOICE : PLAN_LAYOUT.COMBINED
  const plan = model.buildPostingPlan({ statementNumber, rows, accounts, date, config, bank, layout })
  const hasAccountProblems = accountProblems.length > 0 || chart.length === 0
  for (const c of plan) {
    for (const p of model.componentProblems(c)) {
      if (hasAccountProblems && /unmapped|has no/.test(p)) continue
      blockers.push(issue('PLAN_INVALID', p, { scope: 'COMPONENT', key: c.key }))
    }
  }
  const planKeys = new Set(plan.map((c) => c.key))
  for (const l of localList) {
    if (!planKeys.has(l.key) && !REPLANNABLE.includes(l.status)) {
      blockers.push(issue('PLAN_DRIFT', `${l.component} ${l.reference} is ${l.status} but is no longer part of the plan; review before posting.`, { scope: 'COMPONENT', key: l.key }))
    }
  }

  // Invoice state for sales: the invoice must still owe exactly what this statement pays, less
  // whatever this workflow already verified on it.
  const settleMs = config.uncertainSettleMinutes * 60000
  const nowMs = now.getTime()
  const zohoStates = new Map()
  const saleRows = rows.filter((r) => r.kind === ROW_KIND.SALE && r.match && r.match.matched)
  const openInvoices = new Set()
  for (const r of saleRows) {
    const inv = r.match.invoice
    const totalMinor = Math.round(inv.total * 100)
    const balanceMinor = Math.round(inv.balance * 100)
    r.invoiceState = balanceMinor === totalMinor ? 'OPEN' : balanceMinor === 0 ? 'PAID' : 'PARTIALLY_PAID'
    if (balanceMinor === totalMinor) openInvoices.add(inv.invoiceId)
  }
  if (!deep) {
    // No payment of any kind touches these invoices yet, so the sale payment cannot exist.
    for (const c of plan.filter(isSalePayment)) {
      const l = local.get(c.key)
      if (c.allocations.every((a) => openInvoices.has(a.invoiceId)) && (!l || REPLANNABLE.includes(l.status))) {
        const which = c.allocations.length === 1 ? `Invoice ${c.allocations[0].invoiceNumber} has` : `None of its ${c.allocations.length} invoices has`
        zohoStates.set(c.key, { state: ZOHO_STATE.MISSING, reason: `${which} payments applied.` })
      }
    }
  }

  await mapLimit(plan.filter((c) => !zohoStates.has(c.key)), 3, async (c) => {
    const l = local.get(c.key)
    if (l && l.status === COMPONENT_STATUS.VERIFIED && !deep) {
      zohoStates.set(c.key, { state: ZOHO_STATE.VERIFIED, recordId: l.zohoRecordId, reason: `Verified ${l.verifiedAt ? l.verifiedAt.slice(0, 10) : ''} (Zoho ${l.zohoRecordId}).` })
      return
    }
    zohoStates.set(c.key, await zohoChecks.componentZohoState({ ...c, requestSnapshot: l ? l.requestSnapshot : null }, sources, { deep }))
  })

  const components = plan.map((c) => {
    const l = local.get(c.key) || null
    const zoho = zohoStates.get(c.key)
    const recovery = planRecovery(zoho, l, { nowMs, settleMs })
    return componentView(c, accounts, l, zoho, recovery)
  })

  for (const r of saleRows) {
    const inv = r.match.invoice
    const paidMinor = Math.round((inv.total - inv.balance) * 100)
    const ours = components.filter((c) => isSalePayment(c) && c.zoho && c.zoho.state === ZOHO_STATE.VERIFIED)
      .reduce((s, c) => s + appliedTo(c, inv.invoiceId), 0)
    if (paidMinor !== ours) {
      blockers.push(issue('INVOICE_ALREADY_PAID', `Zoho invoice ${inv.invoiceNumber} already has ${money(paidMinor - ours)} applied by other payments (balance ${inv.balance.toFixed(2)} of ${inv.total.toFixed(2)}).`, { scope: 'ROW', excelRow: r.excelRow, websiteOrderId: r.websiteOrderId }))
    }
  }

  for (const c of components) {
    if (c.recovery.action === RECOVERY_ACTION.NEEDS_REVIEW) blockers.push(issue(c.recovery.code || 'NEEDS_REVIEW', `${c.component} ${c.reference}: ${c.recovery.reason}`, { scope: 'COMPONENT', key: c.key }))
    if (c.recovery.action === RECOVERY_ACTION.LOOKUP_FAILED) blockers.push(issue('ZOHO_LOOKUP_FAILED', `${c.component} ${c.reference}: ${c.recovery.reason}`, { scope: 'COMPONENT', key: c.key }))
  }

  // Ledger
  const invoiceGross = {}
  for (const r of saleRows) invoiceGross[r.match.invoice.invoiceId] = r.economics.grossMinor
  const ledger = model.simulateLedger(plan, { invoiceGross, existingBank: bank.status === BANK_STATUS.BANK_MATCHED ? { amountMinor } : null })
  const roleBalance = (snap, role) => (snap && snap[role]) || 0
  const allRowsPlanned = rows.filter((r) => r.kind === ROW_KIND.SALE).every((r) => r.match && r.match.matched && r.problems.length === 0)
    && rows.filter((r) => r.kind === ROW_KIND.REFUND).every((r) => r.match && r.match.matched && r.refund && r.refund.creditNote && !r.refund.code)
  if (allRowsPlanned && blockers.length === 0) {
    if (roleBalance(ledger.final, ACCOUNT_ROLE.PROCESSING) !== 0) blockers.push(issue('PROCESSING_NOT_CLEARED', `Tabby processing clearing would end at ${money(roleBalance(ledger.final, ACCOUNT_ROLE.PROCESSING))}, not 0.00.`, { scope: 'LEDGER' }))
    const bankDone = bank.status === BANK_STATUS.BANK_MATCHED || bank.status === BANK_STATUS.BANK_MATCH_PENDING || bank.status === BANK_STATUS.BANK_NOT_REQUIRED
    if (bankDone && roleBalance(ledger.final, ACCOUNT_ROLE.UNDEPOSITED) !== 0) blockers.push(issue('UNDEPOSITED_NOT_CLEARED', `Tabby Undeposited Funds would end at ${money(roleBalance(ledger.final, ACCOUNT_ROLE.UNDEPOSITED))} for this statement, not 0.00.`, { scope: 'LEDGER' }))
    const arLeft = Object.entries(ledger.final).filter(([k, v]) => k.startsWith('AR:') && v !== 0)
    if (arLeft.length) blockers.push(issue('INVOICE_NOT_CLEARED', `${arLeft.length} invoice(s) would not be fully cleared.`, { scope: 'LEDGER' }))
  }
  if (bank.status === BANK_STATUS.BANK_MATCH_AMBIGUOUS || bank.status === BANK_STATUS.BANK_LOOKUP_FAILED) {
    warnings.push(issue(bank.status, `${bank.reason} The bank step waits; everything else can post.`))
  }

  const fingerprint = model.postingFingerprint(statementNumber, batch.fileHash, date, plan, bank)
  const verified = components.filter((c) => c.recovery.action === RECOVERY_ACTION.SKIP_VERIFIED).length
  const pendingRecords = components.filter((c) => c.recovery.action !== RECOVERY_ACTION.SKIP_VERIFIED)
  const bankComplete = bank.status === BANK_STATUS.BANK_NOT_REQUIRED
    || (bank.status === BANK_STATUS.BANK_MATCHED && batch.bankTransactionId === (bank.matched && bank.matched.transactionId))
    || bank.recordedByWorkflow
  let status
  if (components.some((c) => c.recovery.action === RECOVERY_ACTION.NEEDS_REVIEW)) status = BATCH_STATUS.NEEDS_REVIEW
  else if (blockers.length > 0) status = BATCH_STATUS.BLOCKED
  else if (components.length > 0 && pendingRecords.length === 0 && bankComplete) status = BATCH_STATUS.POSTED
  else if (verified > 0 || batch.bankTransactionId) status = BATCH_STATUS.PARTIALLY_POSTED
  else status = BATCH_STATUS.READY

  const t = analysis.totals
  const M = toMajor
  const sections = {
    settlement: {
      statementNumber,
      statementDate: batch.statementDate,
      transferDate: analysis.transferDate,
      companyName: batch.companyName,
      currency: batch.currency,
      fileName: batch.fileName,
      fileHash: batch.fileHash,
      rows: { sales: t.saleCount, refunds: t.refundCount, payoutFees: t.payoutFeeCount },
      totalCheck: t.totalCheck,
    },
    sales: { count: t.saleCount, gross: M(t.salesGrossMinor), net: M(t.saleNetMinor), charges: M(t.saleChargesMinor) },
    commission: {
      refundable: M(t.refundableCommissionMinor),
      nonRefundable: M(t.nonRefundableCommissionMinor),
      expense: M(t.commissionExpenseMinor),
      refundReversal: M(-t.refundCommissionEffectMinor),
      net: M(t.commissionExpenseNetMinor),
    },
    fees: {
      transactionFixed: M(t.transactionFixedFeeMinor),
      rounding: M(t.transactionRoundingMinor),
      transactionTotalFee: M(t.transactionTotalFeeMinor),
      payoutFee: M(t.payoutFeeMinor),
      refundReversal: M(-t.refundFixedFeeEffectMinor),
      feesExpense: M(t.feesExpenseNetMinor),
    },
    vat: {
      transaction: M(t.transactionVatMinor),
      payout: M(t.payoutVatMinor),
      refundReversal: M(-t.refundVatEffectMinor),
      inputVat: M(t.inputVatNetMinor),
    },
    clearing: {
      account: accountLabel(accounts, ACCOUNT_ROLE.PROCESSING),
      in: M(t.saleChargesMinor),
      out: M(t.saleChargesMinor),
      afterSales: M(roleBalance(ledger.afterSales, ACCOUNT_ROLE.PROCESSING)),
      final: M(roleBalance(ledger.final, ACCOUNT_ROLE.PROCESSING)),
      totalDeduction: M(t.transactionDeductionMinor),
    },
    undeposited: {
      account: accountLabel(accounts, ACCOUNT_ROLE.UNDEPOSITED),
      saleNet: M(t.saleNetMinor),
      refunds: M(t.refundTransferMinor),
      prePayout: M(t.prePayoutTransferMinor),
      payoutFeeAndVat: M(-t.payoutTransferMinor),
      bankPayout: M(t.bankPayoutMinor),
      final: M(roleBalance(ledger.final, ACCOUNT_ROLE.UNDEPOSITED)),
    },
    refunds: {
      count: t.refundCount,
      gross: M(-t.refundsGrossMinor),
      commissionReturned: M(-t.refundCommissionEffectMinor),
      feesReturned: M(-t.refundFixedFeeEffectMinor),
      vatReturned: M(-t.refundVatEffectMinor),
      transfer: M(t.refundTransferMinor),
    },
    matching: {
      matched: txRows.filter((r) => r.match && r.match.matched).length,
      total: txRows.length,
      byStatus: txRows.reduce((acc, r) => { const s = r.match ? r.match.status : 'NOT_CHECKED'; acc[s] = (acc[s] || 0) + 1; return acc }, {}),
      customers: txRows.reduce((acc, r) => { if (r.match && r.match.invoice) acc[r.match.invoice.customerId] = (acc[r.match.invoice.customerId] || 0) + 1; return acc }, {}),
    },
    ledger: Object.fromEntries(Object.entries(ledger).map(([k, snap]) => [k, Object.fromEntries(Object.entries(snap).filter(([role]) => !role.startsWith('AR:')).map(([role, v]) => [role, M(v)]))])),
  }

  const preview = {
    batchId: String(batchId),
    statementNumber,
    date,
    status,
    layout,
    postingEnabled: config.postingEnabled === true,
    canPost: config.postingEnabled === true && blockers.length === 0 && status !== BATCH_STATUS.POSTED,
    fingerprint,
    blockers,
    warnings,
    accounts: { resolved: accounts, problems: accountProblems, mappings },
    bank: { ...bank, amount: M(bank.amountMinor), matched: bank.matched || null },
    sections,
    rows: rows.map(rowView),
    components,
    counts: {
      components: components.length,
      verified,
      toPost: components.filter((c) => [RECOVERY_ACTION.POST_ELIGIBLE, RECOVERY_ACTION.RETRY_ELIGIBLE, RECOVERY_ACTION.RECHECK_THEN_RETRY].includes(c.recovery.action)).length,
      uncertain: components.filter((c) => c.recovery.action === RECOVERY_ACTION.WAIT_UNCERTAIN || c.recovery.action === RECOVERY_ACTION.RECHECK_THEN_RETRY).length,
      review: components.filter((c) => c.recovery.action === RECOVERY_ACTION.NEEDS_REVIEW).length,
    },
    // Internal, for posting only (not sent to the browser).
    _plan: plan,
    _bank: bank,
  }
  if (persist) {
    await store.updateBatch(batchId, {
      status,
      review: { at: now.toISOString(), status, fingerprint, blockers: blockers.length, warnings: warnings.length, counts: preview.counts, bankStatus: bank.status, date, totals: { bankPayout: M(t.bankPayoutMinor), inputVat: M(t.inputVatNetMinor) } },
    })
  }
  return preview
}

function publicPreview(preview) {
  const { _plan, _bank, ...rest } = preview
  return rest
}

module.exports = { RECOVERY_ACTION, planRecovery, buildTabbyPreview, publicPreview }

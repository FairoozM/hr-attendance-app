'use strict'

/**
 * Zoho-facing checks for POS settlement clearing, all read-only:
 *   - the local RRN index of Zoho invoices (invoice detail read once per modification)
 *   - live invoice state (balance, every applied payment with its deposit account)
 *   - the existing POS Undeposited → RAK transfer for a payout, or evidence of the RAK deposit
 *   - fee/VAT already recognised manually from POS Processing (e.g. a "CPV-… POS-Machine fee" expense)
 */

const model = require('./posSettlementModel.ts')
const { POS_ACCOUNT_ROLE: ROLE } = require('../../config/posSettlement.ts')
const { formatFils } = require('./posMoney.ts')

const { BANK_STATUS, FEE_STATUS } = model

function clean(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

const lower = (s: unknown) => clean(s).toLowerCase()

// ── RRN index ───────────────────────────────────────────────────────────────

/** Bumped when RRN extraction changes, so invoices indexed by an older rule are read again. */
const INDEX_RULE = 'v2'

/**
 * Bring the RRN index up to date for invoices dated from..to. Every invoice of the scanned
 * customers is read: card payments are written on website-customer invoices whatever payment
 * method the website order shows. An invoice whose last_modified_time is unchanged is not read again.
 * @returns counts and warnings (never throws for a single unreadable invoice; it is reported)
 */
async function refreshRrnIndex({ sources, store, config, dateFrom, dateTo }: any) {
  const warnings: any[] = []
  const stats = { listed: 0, detailRead: 0, skippedUnchanged: 0, skippedNotPos: 0, capped: 0, failed: 0 }
  let posOrderNumbers: Set<string> | null = null
  try {
    const orders = await sources.loadPosOrdersBetween(dateFrom, dateTo)
    if (orders) posOrderNumbers = new Set(orders.filter((o: any) => !o.deleted).map((o: any) => o.orderNumber))
  } catch (err: any) {
    warnings.push({ code: 'WEBSITE_DB_UNAVAILABLE', message: `Website orders could not be read (${err.message}); channels are taken from Zoho customers and terminals only.` })
  }
  const indexedField = `${config.rrnSource.field}@${INDEX_RULE}`

  for (const customerId of config.rrnScanCustomerIds) {
    const listed = await sources.listInvoices({ customerId, dateFrom, dateTo })
    stats.listed += listed.length
    const known = new Map((await store.getIndexedInvoices(config.organizationId, listed.map((i: any) => i.invoiceId))).map((i: any) => [i.invoiceId, i]))
    for (const inv of listed) {
      const prev: any = known.get(inv.invoiceId)
      if (prev && prev.lastModifiedTime === inv.lastModifiedTime && prev.rrnField === indexedField) {
        stats.skippedUnchanged += 1
        if (prev.balanceMinor !== inv.balanceMinor || prev.status !== inv.status) await store.upsertIndexedInvoice(config.organizationId, { ...prev, ...inv, rrns: prev.rrns, malformed: prev.malformed, rrnField: prev.rrnField })
        continue
      }
      if (stats.detailRead >= config.maxInvoiceDetailsPerScan) {
        stats.capped += 1
        continue
      }
      try {
        const detail = await sources.getInvoice(inv.invoiceId, { rrnField: config.rrnSource.field })
        stats.detailRead += 1
        if (!detail) continue
        const { rrns, malformed } = model.extractRrns(detail.rrnText, { label: config.rrnSource.label, digits: config.rrnSource.digits, labelled: !config.rrnSource.field.startsWith('cf_') })
        await store.upsertIndexedInvoice(config.organizationId, { ...inv, ...detail, rrnField: indexedField, rrns, malformed })
      } catch (err: any) {
        stats.failed += 1
        warnings.push({ code: 'INVOICE_UNREADABLE', message: `Zoho invoice ${inv.invoiceNumber} could not be read: ${err.message}` })
      }
    }
  }
  if (stats.capped) warnings.push({ code: 'RRN_SCAN_CAPPED', message: `${stats.capped} invoice(s) were not read this time (limit ${config.maxInvoiceDetailsPerScan}); preview again to continue indexing.` })
  return { stats, warnings, posOrderNumbers }
}

// ── Live invoice state ──────────────────────────────────────────────────────

/** Live Zoho invoice with every applied payment and its deposit account. */
async function loadInvoiceState(sources: any, invoiceId: string, { critical = false } = {}) {
  const inv = await sources.getInvoice(invoiceId, { critical })
  if (!inv) return null
  const payments = await sources.listInvoicePaymentsWithAccounts(invoiceId, { critical })
  return { ...inv, payments }
}

// ── Bank ────────────────────────────────────────────────────────────────────

/**
 * Where the payout's net stands at RAK:
 *   BANK_MATCHED            one existing transfer POS Undeposited → RAK of exactly the net (manual
 *                           BRV or ours), not claimed by another payout: linked, never re-posted
 *   BANK_DEPOSIT_SEEN       no transfer yet, but RAK shows one uncategorised deposit of exactly the
 *                           net: the transfer is planned
 *   BANK_DEPOSIT_NOT_FOUND  neither: the bank step waits (receipts and fees can still be posted)
 *   BANK_MATCH_AMBIGUOUS    several candidates; link one manually
 */
async function findBankMatch({ sources, accounts, amountMinor, payoutDate, code, ownReference, claims, settlementId, currentTransactionId, config }: any) {
  if (amountMinor <= 0) return { status: BANK_STATUS.BANK_NOT_REQUIRED, amountMinor, candidates: [], reason: 'Nothing is paid out.' }
  const und = accounts[ROLE.UNDEPOSITED]
  const bank = accounts[ROLE.BANK]
  if (!und || !bank) return { status: BANK_STATUS.BANK_LOOKUP_FAILED, amountMinor, candidates: [], reason: 'POS Undeposited Funds and RAK Bank must be resolved before the deposit can be matched.' }
  const start = model.addDays(payoutDate, -config.bankSearchDaysBefore)
  const end = model.addDays(payoutDate, config.bankSearchDaysAfter)
  const claimedElsewhere = new Map(claims.filter((c: any) => String(c.settlementId) !== String(settlementId)).map((c: any) => [c.transactionId, c.settlementCode]))
  const out = (status: string, matched: any, reason: string, extra: any = {}) => ({ status, amountMinor, matched: matched || null, window: { start, end }, reason, ...extra })
  let txns
  try {
    txns = await sources.listBankTransactions(und.accountId, start, end)
  } catch (err: any) {
    return out(BANK_STATUS.BANK_LOOKUP_FAILED, null, `Zoho bank transactions could not be read: ${err.message}`, { candidates: [] })
  }
  const isBank = (t: any) => (t.offsetAccountId ? t.offsetAccountId === bank.accountId : lower(t.offsetAccountName) === lower(bank.accountName))
  const all = txns.filter((t: any) => t.transactionType === 'transfer_fund' && t.debitOrCredit === 'credit' && t.amountMinor === amountMinor && isBank(t))
  const candidates = all.filter((t: any) => !claimedElsewhere.has(t.transactionId))
  const skipped = all.filter((t: any) => claimedElsewhere.has(t.transactionId)).map((t: any) => ({ ...t, claimedBy: claimedElsewhere.get(t.transactionId) }))
  const current = candidates.find((t: any) => t.transactionId === currentTransactionId)
  if (current) return out(BANK_STATUS.BANK_MATCHED, current, `Linked Zoho transfer ${current.referenceNumber || current.transactionId} on ${current.date}.`, { candidates, skipped })
  const ours = candidates.filter((t: any) => t.referenceNumber === ownReference)
  if (ours.length === 1) return out(BANK_STATUS.BANK_MATCHED, ours[0], `Zoho transfer ${ownReference} on ${ours[0].date}.`, { candidates, skipped })
  if (candidates.length === 1) return out(BANK_STATUS.BANK_MATCHED, candidates[0], `Existing Zoho transfer ${candidates[0].referenceNumber || candidates[0].transactionId} on ${candidates[0].date} (${formatFils(amountMinor)} POS Undeposited → ${bank.accountName}).`, { candidates, skipped })
  if (candidates.length > 1) {
    const named = candidates.filter((t: any) => t.referenceNumber.includes(code))
    if (named.length === 1) return out(BANK_STATUS.BANK_MATCHED, named[0], `Existing Zoho transfer ${named[0].referenceNumber} names ${code}.`, { candidates, skipped })
    return out(BANK_STATUS.BANK_MATCH_AMBIGUOUS, null, `${candidates.length} Zoho transfers of ${formatFils(amountMinor)} could be this payout: ${candidates.map((t: any) => `${t.date} ${t.referenceNumber || t.transactionId}`).join('; ')}. Link the right one.`, { candidates, skipped })
  }
  // No transfer yet: is the deposit visible on RAK (uncategorised feed line of exactly the net)?
  let deposits: any[] = []
  try {
    deposits = (await sources.listBankTransactions(bank.accountId, start, end))
      .filter((t: any) => t.amountMinor === amountMinor && t.debitOrCredit === 'debit' && ['uncategorized', 'manually_added', ''].includes(lower(t.status)) && !t.offsetAccountId)
  } catch (err: any) {
    return out(BANK_STATUS.BANK_LOOKUP_FAILED, null, `RAK Bank transactions could not be read: ${err.message}`, { candidates: [], skipped })
  }
  if (deposits.length === 1) return out(BANK_STATUS.BANK_DEPOSIT_SEEN, null, `RAK shows an uncategorised deposit of ${formatFils(amountMinor)} on ${deposits[0].date}; the POS Undeposited → RAK transfer is planned.`, { candidates: [], skipped, deposit: deposits[0] })
  if (deposits.length > 1) return out(BANK_STATUS.BANK_MATCH_AMBIGUOUS, null, `${deposits.length} RAK deposits of ${formatFils(amountMinor)} between ${start} and ${end}; link the transfer manually once it exists.`, { candidates: [], skipped, deposits })
  return out(BANK_STATUS.BANK_DEPOSIT_NOT_FOUND, null, `No POS → ${bank.accountName} transfer and no RAK deposit of ${formatFils(amountMinor)} between ${start} and ${end} yet; the bank step waits for the deposit.`, { candidates: [], skipped })
}

/** Validate a bank record an admin wants to link: exact net, POS Undeposited → RAK. */
async function checkManualBankLink({ sources, accounts, transactionId, amountMinor }: any) {
  const t = await sources.getBankTransaction(transactionId, { critical: true })
  if (!t) return { ok: false, message: `Zoho bank record ${transactionId} was not found.` }
  const und = accounts[ROLE.UNDEPOSITED]
  const bank = accounts[ROLE.BANK]
  const problems = []
  if (t.transactionType !== 'transfer_fund') problems.push(`it is a ${t.transactionType}, not a transfer`)
  if (t.amountMinor !== amountMinor) problems.push(`amount ${t.amount} ≠ payout net ${formatFils(amountMinor)}`)
  if (und && t.fromAccountId && t.fromAccountId !== und.accountId) problems.push(`it is from ${t.fromAccountName}, not ${und.accountName}`)
  if (bank && t.toAccountId && t.toAccountId !== bank.accountId) problems.push(`it is to ${t.toAccountName}, not ${bank.accountName}`)
  return problems.length ? { ok: false, message: `Zoho bank record ${t.referenceNumber || transactionId} cannot settle this payout: ${problems.join('; ')}.` } : { ok: true, transaction: t }
}

// ── Fee recognition already in Zoho ─────────────────────────────────────────

/**
 * Credits on POS Processing (expense or journal, not ours) that already recognised this payout's
 * fee + VAT. Exact amount and naming one of the payout's invoices → ALREADY_RECOGNIZED; a credit
 * naming one of its invoices with another amount, or several exact-amount credits → UNCERTAIN.
 */
async function findExistingFeeRecognition({ sources, accounts, feeTotalMinor, payoutDate, invoiceNumbers, ownReference, config }: any) {
  if (feeTotalMinor <= 0) return { status: FEE_STATUS.NONE_FOUND, reason: 'No Mashreq charges.' }
  const proc = accounts[ROLE.PROCESSING]
  if (!proc) return { status: FEE_STATUS.LOOKUP_FAILED, reason: 'POS Processing account is not resolved.' }
  const start = model.addDays(payoutDate, -config.bankSearchDaysBefore)
  const end = model.addDays(payoutDate, config.bankSearchDaysAfter)
  let txns
  try {
    txns = await sources.listBankTransactions(proc.accountId, start, end)
  } catch (err: any) {
    return { status: FEE_STATUS.LOOKUP_FAILED, reason: `POS Processing transactions could not be read: ${err.message}` }
  }
  const credits = txns.filter((t: any) => t.debitOrCredit === 'credit' && ['expense', 'journal', 'manual_journal'].includes(lower(t.transactionType)) && !t.referenceNumber.startsWith(`${config.referencePrefix}-`) && t.referenceNumber !== ownReference)
  const names = (t: any) => invoiceNumbers.some((n: string) => n && `${t.referenceNumber} ${t.description}`.includes(n))
  const exact = credits.filter((t: any) => t.amountMinor === feeTotalMinor)
  const exactNamed = exact.filter(names)
  if (exactNamed.length === 1) return { status: FEE_STATUS.ALREADY_RECOGNIZED, recordId: exactNamed[0].transactionId, record: exactNamed[0], reason: `Already recognised in Zoho: ${exactNamed[0].referenceNumber} (${formatFils(feeTotalMinor)}) on ${exactNamed[0].date}.` }
  const partial = credits.filter((t: any) => names(t) && t.amountMinor !== feeTotalMinor)
  if (partial.length) return { status: FEE_STATUS.UNCERTAIN, candidates: partial, reason: `POS Processing already has fee credits naming this payout's invoices with other amounts: ${partial.map((t: any) => `${t.referenceNumber} ${t.amount}`).join('; ')}. Resolve before posting.` }
  if (exactNamed.length > 1 || exact.length > 1) return { status: FEE_STATUS.UNCERTAIN, candidates: exact, reason: `${exact.length} POS Processing credits of ${formatFils(feeTotalMinor)} could already recognise this fee: ${exact.map((t: any) => `${t.date} ${t.referenceNumber}`).join('; ')}.` }
  if (exact.length === 1) return { status: FEE_STATUS.UNCERTAIN, candidates: exact, reason: `POS Processing has a credit of exactly ${formatFils(feeTotalMinor)} (${exact[0].referenceNumber}, ${exact[0].date}) that does not name this payout's invoices; confirm it is unrelated before posting.` }
  return { status: FEE_STATUS.NONE_FOUND, reason: `No fee recognition of ${formatFils(feeTotalMinor)} on POS Processing between ${start} and ${end}.` }
}

module.exports = { refreshRrnIndex, loadInvoiceState, findBankMatch, checkManualBankLink, findExistingFeeRecognition }

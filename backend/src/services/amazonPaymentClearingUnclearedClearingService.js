/**
 * Step 13: move what a settlement parked on the Amazon uncleared commission / shipping
 * accounts into expense, splitting out the input VAT included in Amazon's fees:
 *
 *   Dr Amazon Commission Exp (net)  + Dr Input VAT  / Cr Amazon Uncleared Commission (gross)
 *   Dr Amazon Shipping Exp (net)    + Dr Input VAT  / Cr Amazon Uncleared Shipping   (gross)
 *
 * The gross is what this batch's posted entries actually left on each uncleared account
 * (record payments in, return fee journals in or out), so it matches Zoho, not a forecast.
 */
const { round2 } = require('./amazonPaymentClearingOrderBreakdownService')
const { buildSettlementReference, buildEntryReference } = require('./amazonPaymentClearingReferenceService')
const { getPaymentClearingMarketplaceConfig } = require('./amazonPaymentClearingMarketplaceConfig')

const UNCLEARED_CLEARING_PREFIX = 'uncleared_clearing:'
const TOLERANCE = 0.01

const CLEARING_KINDS = Object.freeze([
  Object.freeze({
    role: 'COMMISSION',
    paymentType: `${UNCLEARED_CLEARING_PREFIX}commission`,
    referenceType: 'uncleared_commission_clearing',
    normalizedFeeType: 'UNCLEARED_COMMISSION_CLEARING',
    label: 'Commission',
    expenseKey: 'commissionExpenseAccount',
    expenseEnvKey: 'commissionExpenseAccountIdEnv',
  }),
  Object.freeze({
    role: 'SHIPPING_FBA',
    paymentType: `${UNCLEARED_CLEARING_PREFIX}shipping_fba`,
    referenceType: 'uncleared_shipping_clearing',
    normalizedFeeType: 'UNCLEARED_SHIPPING_CLEARING',
    label: 'Shipping/FBA',
    expenseKey: 'shippingExpenseAccount',
    expenseEnvKey: 'shippingExpenseAccountIdEnv',
  }),
])

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function isUnclearedClearingType(paymentType) {
  return clean(paymentType).startsWith(UNCLEARED_CLEARING_PREFIX)
}

/** VAT-inclusive split in fils so net + VAT always equals the gross exactly. */
function splitVatInclusive(gross, vatRate) {
  const grossFils = Math.round(Math.abs(Number(gross) || 0) * 100)
  const rate = Number(vatRate)
  if (!Number.isFinite(rate) || rate <= 0) return { gross: grossFils / 100, net: grossFils / 100, vat: 0 }
  const vatFils = Math.round((grossFils * rate) / (1 + rate))
  return { gross: grossFils / 100, net: (grossFils - vatFils) / 100, vat: vatFils / 100 }
}

/**
 * Signed movements a batch's posted entries made on one uncleared account
 * (positive = debit, i.e. expense parked there).
 * @param {any[]} postings
 * @param {{ accountCode: string, accountId: string }} account
 */
function unclearedMovements(postings, account) {
  const movements = []
  for (const posting of Array.isArray(postings) ? postings : []) {
    if (posting?.status !== 'posted' || !clean(posting.zohoPaymentId)) continue
    if (isUnclearedClearingType(posting.paymentType)) continue
    const snap = posting.mappingSnapshot || {}
    const amount = Math.abs(round2(Number(posting.amount) || 0))
    let signed = 0
    if (clean(snap.debitAccountId) || clean(snap.creditAccountId)) {
      if (account.accountId && clean(snap.debitAccountId) === account.accountId) signed = amount
      else if (account.accountId && clean(snap.creditAccountId) === account.accountId) signed = -amount
    } else if (account.accountCode && clean(posting.accountCode) === account.accountCode) {
      signed = amount
    }
    if (!signed) continue
    movements.push({
      paymentType: posting.paymentType,
      referenceNumber: posting.referenceNumber || '',
      zohoId: posting.zohoPaymentId || '',
      zohoNumber: posting.zohoJournalNumber || '',
      amount: signed,
    })
  }
  return movements
}

function accountWithEnvId(account, envName, env) {
  return { ...account, accountId: clean(env?.[envName]) || account.accountId }
}

/**
 * @param {any} batch
 * @param {any[]} postings
 * @param {{ env?: NodeJS.ProcessEnv, unclearedAccounts: Record<string, { accountCode: string, accountName: string, accountId: string }> }} opts
 */
function buildUnclearedClearingPlan(batch, postings, opts) {
  const marketplace = clean(batch?.marketplace) || 'KSA'
  const cfg = getPaymentClearingMarketplaceConfig(marketplace)
  const settings = cfg.unclearedClearing
  const env = opts.env || process.env
  const vatRate = settings.vatRate
  const inputVat = accountWithEnvId(settings.inputVatAccount, settings.inputVatAccountIdEnv, env)
  const settlementReference = buildSettlementReference(batch)

  const lines = []
  for (const kind of CLEARING_KINDS) {
    const uncleared = opts.unclearedAccounts[kind.role]
    const movements = unclearedMovements(postings, uncleared)
    const gross = round2(movements.reduce((sum, row) => sum + row.amount, 0))
    if (Math.abs(gross) < TOLERANCE) continue

    const expense = accountWithEnvId(settings[kind.expenseKey], settings[kind.expenseEnvKey], env)
    const split = splitVatInclusive(gross, vatRate)
    const toExpense = gross > 0
    const expenseSide = toExpense ? 'debit' : 'credit'
    const unclearedSide = toExpense ? 'credit' : 'debit'
    const entry = buildEntryReference(settlementReference, kind.referenceType, `${kind.label} uncleared to expense`)
    const description = `Amazon ${cfg.code} ${kind.label.toLowerCase()} ${settlementReference.periodText || ''}`.trim()
    const lineItems = [
      { ...expense, debitOrCredit: expenseSide, amount: split.net, description },
      ...(split.vat > 0 ? [{ ...inputVat, debitOrCredit: expenseSide, amount: split.vat, description: `Input VAT ${round2(vatRate * 100)}% - ${description}` }] : []),
      { ...uncleared, debitOrCredit: unclearedSide, amount: split.gross, description },
    ]
    const missing = lineItems.filter((row) => !clean(row.accountId)).map((row) => row.accountName || row.accountCode)
    const envHints = [settings[kind.expenseEnvKey], settings.inputVatAccountIdEnv]
    lines.push({
      key: kind.paymentType,
      paymentType: kind.paymentType,
      feeType: `${kind.label} clearing`,
      normalizedFeeType: kind.normalizedFeeType,
      role: kind.role,
      direction: toExpense ? 'to_expense' : 'from_expense',
      amount: split.gross,
      grossAmount: split.gross,
      netAmount: split.net,
      vatAmount: split.vat,
      vatRate,
      lineItems,
      debit: toExpense ? expense : uncleared,
      credit: toExpense ? uncleared : expense,
      movements,
      referenceNumber: entry.referenceNumber,
      notes: entry.description,
      status: missing.length ? 'needs_mapping' : 'ready',
      blockingReason: missing.length
        ? `No Zoho account id for ${missing.join(', ')}. Set ${envHints.join(' / ')} on the backend.`
        : '',
    })
  }

  return {
    batchId: batch?.batchId ?? null,
    marketplace: cfg.code,
    vatRate,
    lines,
    summary: {
      grossTotal: round2(lines.reduce((sum, row) => sum + row.grossAmount, 0)),
      netTotal: round2(lines.reduce((sum, row) => sum + row.netAmount, 0)),
      vatTotal: round2(lines.reduce((sum, row) => sum + row.vatAmount, 0)),
      needsMappingCount: lines.filter((row) => row.status === 'needs_mapping').length,
    },
  }
}

module.exports = {
  UNCLEARED_CLEARING_PREFIX,
  CLEARING_KINDS,
  isUnclearedClearingType,
  splitVatInclusive,
  unclearedMovements,
  buildUnclearedClearingPlan,
}

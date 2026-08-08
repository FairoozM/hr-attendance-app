const { round2, num, clean } = require('./noonPaymentClearingCategoryService')

const DEFAULT_VAT_RATE = 0.05

/**
 * VAT-inclusive fields from the Noon UAE export (column names say "including VAT").
 * Net Proceeds is intentionally excluded — product proceeds are not service-fee VAT.
 */
const VAT_INCLUSIVE_COMPONENT_FIELDS = Object.freeze([
  { field: 'referralFee', label: 'Referral Fee including VAT', feeHint: 'REFERRAL_COMMISSION' },
  { field: 'fulfillmentFee', label: 'Fulfillment & Logistics Fees including VAT', feeHint: 'FULFILLMENT' },
  { field: 'shippingCharges', label: 'Shipping Credits including VAT', feeHint: 'SHIPPING' },
  { field: 'otherOrderFees', label: 'Other Order Fees including VAT', feeHint: 'OTHER' },
  { field: 'orderSubsidies', label: 'Order Subsidies including VAT', feeHint: 'SUBSIDY' },
  { field: 'nonOrderFees', label: 'Non-Order Fees including VAT', feeHint: 'STATEMENT_FEE' },
  { field: 'nonOrderSubscriptionFees', label: 'Non-Order Subsidies including VAT', feeHint: 'STATEMENT_FEE' },
  { field: 'othersInclVat', label: 'Others including VAT', feeHint: 'OTHER' },
])

function toFils(amount) {
  return Math.round(round2(num(amount)) * 100)
}

function fromFils(fils) {
  return round2(fils / 100)
}

/**
 * Split a VAT-inclusive gross amount at 5%.
 * Guarantees net + vat === gross to the fils.
 */
function splitVatInclusiveAmount(grossAmount, vatRate = DEFAULT_VAT_RATE) {
  const rate = Number(vatRate)
  if (!Number.isFinite(rate) || rate <= 0) {
    const g = round2(num(grossAmount))
    return {
      originalGrossAmount: g,
      vatRate: 0,
      netAmount: g,
      vatAmount: 0,
      vatInclusive: false,
      vatSource: 'none',
    }
  }
  const grossFils = toFils(grossAmount)
  const vatBasisPoints = Math.round(rate * 100)
  const denom = 100 + vatBasisPoints
  const vatFils = Math.round((grossFils * vatBasisPoints) / denom)
  const netFils = grossFils - vatFils
  return {
    originalGrossAmount: fromFils(grossFils),
    vatRate: rate,
    netAmount: fromFils(netFils),
    vatAmount: fromFils(vatFils),
    vatInclusive: true,
    vatSource: 'calculated',
  }
}

function resolveVatSplit({
  grossAmount,
  explicitVatAmount = null,
  vatInclusive = true,
  vatRate = DEFAULT_VAT_RATE,
} = {}) {
  const gross = round2(num(grossAmount))
  if (!vatInclusive || Math.abs(gross) < 0.005) {
    return {
      originalGrossAmount: gross,
      vatRate: vatInclusive ? vatRate : 0,
      netAmount: gross,
      vatAmount: 0,
      vatInclusive: false,
      vatSource: 'none',
    }
  }
  if (explicitVatAmount != null && explicitVatAmount !== '' && Number.isFinite(Number(explicitVatAmount))) {
    const vat = round2(num(explicitVatAmount))
    const net = round2(gross - vat)
    return {
      originalGrossAmount: gross,
      vatRate,
      netAmount: net,
      vatAmount: vat,
      vatInclusive: true,
      vatSource: 'explicit',
    }
  }
  return splitVatInclusiveAmount(gross, vatRate)
}

function extractVatFromNoonRow(row, { vatRate = DEFAULT_VAT_RATE } = {}) {
  const components = []
  let grossOfVatInclusive = 0
  let netTotal = 0
  let vatTotal = 0

  const orderSubGross = round2(num(row.orderSubsidies))
  let othersGross = round2(num(row.othersInclVat))
  if (Math.abs(orderSubGross) >= 0.005) {
    othersGross = round2(othersGross - orderSubGross)
  }

  for (const def of VAT_INCLUSIVE_COMPONENT_FIELDS) {
    let gross = round2(num(row[def.field]))
    if (def.field === 'orderSubsidies') gross = orderSubGross
    if (def.field === 'othersInclVat') gross = othersGross
    if (Math.abs(gross) < 0.005) continue

    const explicit =
      row.explicitVatByField && row.explicitVatByField[def.field] != null
        ? row.explicitVatByField[def.field]
        : row.explicitVatAmount
    const split = resolveVatSplit({
      grossAmount: gross,
      explicitVatAmount: explicit,
      vatInclusive: true,
      vatRate,
    })
    components.push({
      field: def.field,
      label: def.label,
      feeHint: def.feeHint,
      ...split,
    })
    grossOfVatInclusive = round2(grossOfVatInclusive + split.originalGrossAmount)
    netTotal = round2(netTotal + split.netAmount)
    vatTotal = round2(vatTotal + split.vatAmount)
  }

  const rowTotal = round2(num(row.total))
  const nonVatResidue = round2(rowTotal - grossOfVatInclusive)

  return {
    vatRate,
    vatInclusive: components.length > 0,
    vatSource: components.some((c) => c.vatSource === 'explicit')
      ? 'explicit'
      : components.length
        ? 'calculated'
        : 'none',
    components,
    originalGrossAmount: rowTotal,
    vatInclusiveGrossAmount: grossOfVatInclusive,
    netAmount: round2(netTotal + nonVatResidue),
    serviceFeeNetAmount: netTotal,
    vatAmount: vatTotal,
    nonVatResidue,
    tiesOut: Math.abs(round2(netTotal + nonVatResidue + vatTotal) - rowTotal) < 0.005,
  }
}

/**
 * Amazon-style fee journal lines:
 *   expense (net) + Input VAT ↔ clearing GL (gross)
 * No customer_id on journal lines (customer is only for invoice Record Payments).
 */
function buildVatAwareFeeJournalLines({
  signedGross,
  netAmount,
  vatAmount,
  vatInclusive,
  expenseAccount,
  inputVatAccount,
  clearingAccount,
} = {}) {
  const gross = round2(num(signedGross))
  const net = round2(num(netAmount))
  const vat = round2(num(vatAmount))
  const expense = {
    accountId: clean(expenseAccount?.accountId),
    accountName: clean(expenseAccount?.accountName) || 'Fee Expense',
    accountCode: clean(expenseAccount?.accountCode),
  }
  const vatAcct = {
    accountId: clean(inputVatAccount?.accountId),
    accountName: clean(inputVatAccount?.accountName) || 'Input VAT',
    accountCode: clean(inputVatAccount?.accountCode),
  }
  const clearing = {
    accountId: clean(clearingAccount?.accountId),
    accountName: clean(clearingAccount?.accountName) || 'Noon Undeposited Funds',
    accountCode: clean(clearingAccount?.accountCode),
  }
  const absGross = Math.abs(gross)
  const absNet = Math.abs(net)
  const absVat = Math.abs(vat)
  const isCredit = gross > 0

  if (!vatInclusive || absVat < 0.005) {
    if (isCredit) {
      return {
        direction: 'credit_reversal',
        lineItems: [
          { ...clearing, debitOrCredit: 'debit', amount: absGross },
          { ...expense, debitOrCredit: 'credit', amount: absGross },
        ],
        debit: clearing,
        credit: expense,
      }
    }
    return {
      direction: 'expense',
      lineItems: [
        { ...expense, debitOrCredit: 'debit', amount: absGross },
        { ...clearing, debitOrCredit: 'credit', amount: absGross },
      ],
      debit: expense,
      credit: clearing,
    }
  }

  if (isCredit) {
    return {
      direction: 'credit_reversal',
      lineItems: [
        { ...clearing, debitOrCredit: 'debit', amount: absGross },
        { ...expense, debitOrCredit: 'credit', amount: absNet },
        { ...vatAcct, debitOrCredit: 'credit', amount: absVat },
      ],
      debit: clearing,
      credit: expense,
    }
  }
  return {
    direction: 'expense',
    lineItems: [
      { ...expense, debitOrCredit: 'debit', amount: absNet },
      { ...vatAcct, debitOrCredit: 'debit', amount: absVat },
      { ...clearing, debitOrCredit: 'credit', amount: absGross },
    ],
    debit: expense,
    credit: clearing,
  }
}

module.exports = {
  DEFAULT_VAT_RATE,
  VAT_INCLUSIVE_COMPONENT_FIELDS,
  toFils,
  fromFils,
  splitVatInclusiveAmount,
  resolveVatSplit,
  extractVatFromNoonRow,
  buildVatAwareFeeJournalLines,
}

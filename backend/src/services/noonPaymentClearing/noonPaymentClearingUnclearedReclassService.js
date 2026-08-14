const { round2, num, clean } = require('./noonPaymentClearingCategoryService')
const { normalizeGlAccount } = require('./noonPaymentClearingRowPredicates')
const {
  DEFAULT_VAT_RATE,
  splitVatInclusiveAmount,
} = require('./noonPaymentClearingVatService')
const { resolveNoonFeeJournalSides } = require('./noonPaymentClearingJournalDirection')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')

/**
 * Where the DEFERRED_TO_RECLASS VAT policy is finally resolved.
 *
 * After invoice Record Payments park commission/shipping on uncleared GLs,
 * post settlement reclass journals (Amazon parallel for account-level expense recognition):
 *
 *   Dr Commission Exp (2143) net after VAT
 *   Dr Input VAT (1085)
 *   Cr Uncleared Commission (1067) gross
 *
 *   Dr Shipping Exp (2162) net after VAT
 *   Dr Input VAT (1085)
 *   Cr Uncleared Shipping (1068) gross
 */

const normalizeAccount = normalizeGlAccount

function isMapped(expense, clearing, vatAcct, vatAmount) {
  if (!clean(expense.accountId) && !clean(expense.accountCode)) return false
  if (!clean(clearing.accountId) && !clean(clearing.accountCode)) return false
  if (Math.abs(num(vatAmount)) >= 0.005 && !clean(vatAcct.accountId) && !clean(vatAcct.accountCode)) {
    return false
  }
  return true
}

function buildOneReclassJournal({
  paymentType,
  feeType,
  displayLabel,
  grossPositive,
  expenseAccount,
  clearingAccount,
  inputVatAccount,
  vatRate = DEFAULT_VAT_RATE,
}) {
  const grossAbs = round2(Math.abs(num(grossPositive)))
  if (grossAbs < 0.005) return null

  // Expense direction: negative signed gross (same as Noon fee charges).
  const signedGross = round2(-grossAbs)
  const split = splitVatInclusiveAmount(signedGross, vatRate)
  const expense = normalizeAccount(expenseAccount)
  const clearing = normalizeAccount(clearingAccount)
  const vatAcct = normalizeAccount(inputVatAccount)
  const mapped = isMapped(expense, clearing, vatAcct, split.vatAmount)
  const sides = mapped
    ? resolveNoonFeeJournalSides({
        feeAccountId: expense.accountId,
        feeAccountName: expense.accountName,
        feeAccountCode: expense.accountCode,
        clearingAccountId: clearing.accountId,
        clearingAccountName: clearing.accountName,
        clearingAccountCode: clearing.accountCode,
        inputVatAccountId: vatAcct.accountId,
        inputVatAccountName: vatAcct.accountName,
        inputVatAccountCode: vatAcct.accountCode,
        signedAmount: signedGross,
        netAmount: split.netAmount,
        vatAmount: split.vatAmount,
        vatInclusive: true,
      })
    : {
        amount: grossAbs,
        signedAmount: signedGross,
        netAmount: split.netAmount,
        vatAmount: split.vatAmount,
        direction: 'expense',
        debit: { accountId: '', accountName: expense.accountName },
        credit: { accountId: '', accountName: clearing.accountName },
        lineItems: [],
        preview: {
          debitLabel: `${expense.accountName || 'Expense'} + Input VAT`,
          creditLabel: clearing.accountName || 'Uncleared',
          lines: [],
        },
      }

  return {
    paymentType,
    feeType,
    normalizedFeeType: feeType,
    displayLabel,
    accountingTreatment: `Reclass uncleared → expense (+ Input VAT)`,
    rowClass: 'uncleared_reclass',
    isUnclearedReclass: true,
    signedAmount: signedGross,
    amount: grossAbs,
    grossInclVat: split.originalGrossAmount,
    netExpense: split.netAmount,
    inputVatAmount: split.vatAmount,
    vatBreakdown: {
      originalGrossAmount: split.originalGrossAmount,
      vatRate: split.vatRate,
      netAmount: split.netAmount,
      vatAmount: split.vatAmount,
      vatInclusive: true,
      vatSource: split.vatSource,
      expenseAccountId: expense.accountId,
      inputVatAccountId: vatAcct.accountId,
      clearingAccountId: clearing.accountId,
    },
    zohoAccountId: expense.accountId,
    zohoAccountName: expense.accountName,
    zohoAccountCode: expense.accountCode,
    inputVatAccountId: vatAcct.accountId,
    inputVatAccountName: vatAcct.accountName,
    inputVatAccountCode: vatAcct.accountCode,
    clearingAccountId: clearing.accountId,
    clearingAccountName: clearing.accountName,
    clearingAccountCode: clearing.accountCode,
    debit: sides.debit,
    credit: sides.credit,
    lineItems: sides.lineItems || [],
    accountingPreview: {
      debit: sides.preview?.debitLabel,
      credit: sides.preview?.creditLabel,
      lines: sides.preview?.lines || [],
      grossInclVat: split.originalGrossAmount,
      netExpense: split.netAmount,
      inputVat: split.vatAmount,
      expenseAccount: expense.accountName,
      vatAccount: vatAcct.accountName,
      clearingAccount: clearing.accountName,
    },
    previewNote:
      'Second entry: clear uncleared balance into expense + Input VAT (same settlement post as payments)',
    mappingStatus: mapped ? 'mapped' : 'needs_mapping',
  }
}

/**
 * @param {object} paymentPreview - from buildPaymentPreviewFromBatch
 * @param {object} [accounts] - resolved expense / clearing / VAT accounts
 */
function buildUnclearedReclassJournals(paymentPreview, accounts = {}) {
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const vatRate = Number(accounts.vatRate ?? cfg.vatRate ?? DEFAULT_VAT_RATE) || DEFAULT_VAT_RATE
  const invoicePayments = Array.isArray(paymentPreview?.invoicePayments)
    ? paymentPreview.invoicePayments
    : []

  const commissionGross = round2(
    invoicePayments.reduce((sum, p) => sum + Math.abs(num(p.commissionPayment?.amount ?? p.referralFee)), 0)
  )
  const shippingGross = round2(
    invoicePayments.reduce(
      (sum, p) => sum + Math.abs(num(p.fulfillmentPayment?.amount ?? p.fulfillmentShipping)),
      0
    )
  )

  const expenseCommission =
    accounts.commissionExpenseAccount || cfg.commissionExpenseAccount
  const expenseShipping = accounts.shippingExpenseAccount || cfg.shippingExpenseAccount
  const clearingCommission =
    accounts.unclearedCommissionAccount || cfg.unclearedCommissionAccount
  const clearingShipping = accounts.unclearedShippingAccount || cfg.unclearedShippingAccount
  const inputVat = accounts.inputVatAccount || cfg.inputVatAccount

  const lines = []
  const commissionLine = buildOneReclassJournal({
    paymentType: 'uncleared_reclass_commission',
    feeType: 'UNCLEARED_COMMISSION_RECLASS',
    displayLabel: 'Uncleared Commission → Commission Exp + Input VAT',
    grossPositive: commissionGross,
    expenseAccount: expenseCommission,
    clearingAccount: clearingCommission,
    inputVatAccount: inputVat,
    vatRate,
  })
  if (commissionLine) lines.push(commissionLine)

  const shippingLine = buildOneReclassJournal({
    paymentType: 'uncleared_reclass_shipping',
    feeType: 'UNCLEARED_SHIPPING_RECLASS',
    displayLabel: 'Uncleared Shipping → Shipping Exp + Input VAT',
    grossPositive: shippingGross,
    expenseAccount: expenseShipping,
    clearingAccount: clearingShipping,
    inputVatAccount: inputVat,
    vatRate,
  })
  if (shippingLine) lines.push(shippingLine)

  return {
    lines,
    summary: {
      commissionGross,
      shippingGross,
      commissionNet: commissionLine ? commissionLine.netExpense : 0,
      commissionVat: commissionLine ? commissionLine.inputVatAmount : 0,
      shippingNet: shippingLine ? shippingLine.netExpense : 0,
      shippingVat: shippingLine ? shippingLine.inputVatAmount : 0,
      unmappedCount: lines.filter((l) => l.mappingStatus === 'needs_mapping').length,
    },
  }
}

module.exports = {
  buildUnclearedReclassJournals,
  buildOneReclassJournal,
}

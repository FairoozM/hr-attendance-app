const { round2, num, clean } = require('./noonPaymentClearingCategoryService')
const { buildVatAwareFeeJournalLines } = require('./noonPaymentClearingVatService')

/**
 * Amazon-style Noon fee journals:
 * - Debit mapped net expense (+ Input VAT when VAT-inclusive)
 * - Credit clearing GL (Undeposited 1066 for advertising; Uncleared Shipping 1068 for shipping/fulfillment)
 *
 * No customer_id on journal lines. Noon customer is used only on invoice Record Payments.
 */
function resolveNoonFeeJournalSides({
  feeAccountId,
  feeAccountName,
  feeAccountCode,
  clearingAccountId,
  clearingAccountName,
  clearingAccountCode,
  inputVatAccountId,
  inputVatAccountName,
  inputVatAccountCode,
  signedAmount,
  netAmount,
  vatAmount,
  vatInclusive = false,
  // Legacy aliases
  settlementBridgeAccountId,
  settlementBridgeAccountName,
  customerCounterAccountId,
  customerCounterAccountName,
} = {}) {
  const gross = round2(num(signedAmount))
  const net = vatInclusive ? round2(num(netAmount)) : gross
  const vat = vatInclusive ? round2(num(vatAmount)) : 0
  const clearingId = clean(clearingAccountId || settlementBridgeAccountId || customerCounterAccountId)
  const clearingName =
    clean(clearingAccountName || settlementBridgeAccountName || customerCounterAccountName) ||
    'Noon Undeposited Funds'
  const clearingCode = clean(clearingAccountCode)
  const built = buildVatAwareFeeJournalLines({
    signedGross: gross,
    netAmount: net,
    vatAmount: vat,
    vatInclusive: Boolean(vatInclusive) && Math.abs(vat) >= 0.005,
    expenseAccount: {
      accountId: feeAccountId,
      accountName: feeAccountName,
      accountCode: feeAccountCode,
    },
    inputVatAccount: {
      accountId: inputVatAccountId,
      accountName: inputVatAccountName,
      accountCode: inputVatAccountCode,
    },
    clearingAccount: {
      accountId: clearingId,
      accountName: clearingName,
      accountCode: clearingCode,
    },
  })
  const expenseLabel = clean(feeAccountName) || 'Mapped Fee Account'
  const vatLabel = clean(inputVatAccountName) || 'Input VAT'
  const clearingLabel = clearingName
  const absNet = Math.abs(net)
  const absVat = Math.abs(vat)
  const hasVat = Boolean(vatInclusive) && absVat >= 0.005

  return {
    amount: Math.abs(gross),
    signedAmount: gross,
    netAmount: net,
    vatAmount: vat,
    direction: built.direction,
    debit: built.debit,
    credit: built.credit,
    lineItems: built.lineItems,
    preview: hasVat
      ? {
          debitLabel:
            built.direction === 'credit_reversal'
              ? clearingLabel
              : `${expenseLabel} ${absNet.toFixed(2)} + ${vatLabel} ${absVat.toFixed(2)}`,
          creditLabel:
            built.direction === 'credit_reversal'
              ? `${expenseLabel} ${absNet.toFixed(2)} + ${vatLabel} ${absVat.toFixed(2)}`
              : clearingLabel,
          lines: built.lineItems.map((l) => ({
            accountName: l.accountName,
            accountCode: l.accountCode || '',
            debitOrCredit: l.debitOrCredit,
            amount: l.amount,
          })),
        }
      : {
          debitLabel: built.direction === 'credit_reversal' ? clearingLabel : expenseLabel,
          creditLabel: built.direction === 'credit_reversal' ? expenseLabel : clearingLabel,
          lines: built.lineItems.map((l) => ({
            accountName: l.accountName,
            accountCode: l.accountCode || '',
            debitOrCredit: l.debitOrCredit,
            amount: l.amount,
          })),
        },
  }
}

function isNoonFeeMappingComplete(
  feeAccountId,
  clearingAccountId,
  {
    vatAmount = 0,
    inputVatAccountId = '',
    feeAccountCode = '',
    clearingAccountCode = '',
    inputVatAccountCode = '',
  } = {}
) {
  const feeOk = Boolean(clean(feeAccountId) || clean(feeAccountCode))
  const clearingOk = Boolean(clean(clearingAccountId) || clean(clearingAccountCode))
  if (!feeOk || !clearingOk) return false
  if (Math.abs(num(vatAmount)) >= 0.005) {
    const vatOk = Boolean(clean(inputVatAccountId) || clean(inputVatAccountCode))
    if (!vatOk) return false
  }
  return true
}

module.exports = {
  resolveNoonFeeJournalSides,
  isNoonFeeMappingComplete,
}

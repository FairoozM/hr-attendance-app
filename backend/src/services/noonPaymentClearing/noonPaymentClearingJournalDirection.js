const { round2, num, clean } = require('./noonPaymentClearingCategoryService')

/**
 * Resolve debit/credit sides from a mapped fee account + Noon clearing account
 * using the signed Noon statement amount.
 *
 * Negative / zero expense-like amounts:
 *   Debit  → fee/expense account
 *   Credit → Noon clearing
 *
 * Positive credits / subsidies / reversals:
 *   Debit  → Noon clearing
 *   Credit → fee/expense account
 */
function resolveNoonFeeJournalSides({
  feeAccountId,
  feeAccountName,
  clearingAccountId,
  clearingAccountName,
  signedAmount,
} = {}) {
  const amount = Math.abs(round2(num(signedAmount)))
  const fee = {
    accountId: clean(feeAccountId),
    accountName: clean(feeAccountName) || 'Mapped Fee Account',
  }
  const clearing = {
    accountId: clean(clearingAccountId),
    accountName: clean(clearingAccountName) || 'Noon',
  }
  const isCreditReversal = num(signedAmount) > 0
  if (isCreditReversal) {
    return {
      amount,
      signedAmount: round2(num(signedAmount)),
      direction: 'credit_reversal',
      debit: clearing,
      credit: fee,
      preview: {
        debitLabel: clearing.accountName,
        creditLabel: fee.accountName,
      },
    }
  }
  return {
    amount,
    signedAmount: round2(num(signedAmount)),
    direction: 'expense',
    debit: fee,
    credit: clearing,
    preview: {
      debitLabel: fee.accountName,
      creditLabel: clearing.accountName,
    },
  }
}

function isNoonFeeMappingComplete(feeAccountId, clearingAccountId) {
  return Boolean(clean(feeAccountId) && clean(clearingAccountId))
}

module.exports = {
  resolveNoonFeeJournalSides,
  isNoonFeeMappingComplete,
}

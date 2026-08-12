const { round2, num, clean } = require('./noonPaymentClearingCategoryService')

const JOURNAL_BALANCE_TOLERANCE = 0.01

function sumJournalLineItems(lineItems = []) {
  let totalDebits = 0
  let totalCredits = 0
  for (const line of lineItems || []) {
    const amount = round2(Math.abs(num(line.amount)))
    const side = clean(line.debitOrCredit || line.debit_or_credit).toLowerCase()
    if (side === 'debit') totalDebits = round2(totalDebits + amount)
    else if (side === 'credit') totalCredits = round2(totalCredits + amount)
  }
  return {
    totalDebits,
    totalCredits,
    difference: round2(totalDebits - totalCredits),
  }
}

function sumZohoJournalPayload(payload = {}) {
  return sumJournalLineItems(
    (payload.line_items || []).map((line) => ({
      debitOrCredit: line.debit_or_credit,
      amount: line.amount,
    }))
  )
}

function assertBalancedJournalLineItems(lineItems, meta = {}) {
  const totals = sumJournalLineItems(lineItems)
  if (Math.abs(totals.difference) <= JOURNAL_BALANCE_TOLERANCE) {
    return totals
  }
  const err = new Error(
    `Journal is unbalanced (${clean(meta.journalType) || 'manual journal'}): debits ${totals.totalDebits.toFixed(2)} vs credits ${totals.totalCredits.toFixed(2)} (difference ${totals.difference.toFixed(2)}).`
  )
  err.code = 'UNBALANCED_JOURNAL'
  err.status = 422
  err.details = {
    journalType: clean(meta.journalType) || 'manual_journal',
    reference: clean(meta.reference) || '',
    totalDebits: totals.totalDebits,
    totalCredits: totals.totalCredits,
    difference: totals.difference,
  }
  throw err
}

function assertBalancedZohoJournalPayload(payload, meta = {}) {
  const totals = sumZohoJournalPayload(payload)
  if (Math.abs(totals.difference) <= JOURNAL_BALANCE_TOLERANCE) {
    return totals
  }
  const err = new Error(
    `Zoho journal payload is unbalanced (${clean(meta.journalType) || 'manual journal'}): debits ${totals.totalDebits.toFixed(2)} vs credits ${totals.totalCredits.toFixed(2)} (difference ${totals.difference.toFixed(2)}).`
  )
  err.code = 'UNBALANCED_JOURNAL'
  err.status = 422
  err.details = {
    journalType: clean(meta.journalType) || 'manual_journal',
    reference: clean(meta.reference || payload.reference_number) || '',
    totalDebits: totals.totalDebits,
    totalCredits: totals.totalCredits,
    difference: totals.difference,
  }
  throw err
}

module.exports = {
  JOURNAL_BALANCE_TOLERANCE,
  sumJournalLineItems,
  sumZohoJournalPayload,
  assertBalancedJournalLineItems,
  assertBalancedZohoJournalPayload,
}

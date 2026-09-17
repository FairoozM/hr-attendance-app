/**
 * Central Zoho account IDs for Daily Ecommerce Ledger + Ecommerce Summary.
 * Stable identifiers only — override via env without code changes.
 *
 * Resolved via live CoA probe (2026-09-12 reconciliation targets).
 */

function envId(name, fallback = '') {
  const v = process.env[name]
  if (v == null || String(v).trim() === '') return fallback
  return String(v).trim()
}

function envIdList(name, fallback = []) {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return [...fallback]
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const dailyEcommerceLedgerAccounts = {
  /** Income — Sales (code 1645). Opening sales use salesbycustomer, not this GL alone. */
  salesAccountId: envId('DAILY_LEDGER_SALES_ACCOUNT_ID', '4265011000000000388'),
  salesAccountCode: '1645',
  salesAccountName: 'Sales',

  cashInHandAccountId: envId('DAILY_LEDGER_CASH_IN_HAND_ACCOUNT_ID', '4265011000000706735'),
  cashInHandAccountCode: '1011',
  cashInHandAccountName: 'Cash In Hand',

  /**
   * Zoho type is bank, but legacy "Basmat Payable Against Cash Ledger"
   * presents it as credit-normal (credits increase the displayed balance).
   */
  basmatPayableAgainstCashAccountId: envId(
    'DAILY_LEDGER_BASMAT_PAYABLE_ACCOUNT_ID',
    '4265011000000543429'
  ),
  basmatPayableAgainstCashAccountCode: '1006',
  basmatPayableAgainstCashAccountName: 'BASMAT CASH FOR ECOMMERCE',
  basmatPayableBalanceNature: 'credit_normal',

  /** Optional — leave empty if not mapped; section reports configMissing. */
  purchasePaymentsAccountId: envId('DAILY_LEDGER_PURCHASE_PAYMENTS_ACCOUNT_ID', ''),

  bankAccountIds: envIdList('DAILY_LEDGER_BANK_ACCOUNT_IDS', ['4265011000000902009']),
  creditCardAccountIds: envIdList('DAILY_LEDGER_CREDIT_CARD_ACCOUNT_IDS', [
    '4265011000021282001',
  ]),

  /** Summary Fixed / Flexible parents (include descendants). */
  fixedExpensesParentAccountId: envId(
    'ECOMMERCE_SUMMARY_FIXED_EXPENSE_PARENT_ID',
    '4265011000026584005'
  ),
  flexibleExpensesParentAccountId: envId(
    'ECOMMERCE_SUMMARY_FLEXIBLE_EXPENSE_PARENT_ID',
    '4265011000026584011'
  ),
}

module.exports = {
  dailyEcommerceLedgerAccounts,
}

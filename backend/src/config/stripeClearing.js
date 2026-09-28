'use strict'

/**
 * Stripe payment → website order → Zoho invoice matching settings.
 *
 * The website platform creates one Zoho Books invoice per order and writes the
 * website `orders.invoice_number` into the Zoho invoice `reference_number`.
 * Online orders go to the shared customer "Website"; shop orders
 * (`orders.shop_order = true`) go to "Burjman Shop - Web & App".
 */

const DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID = '4265011000000160061' // Zoho Books customer "Website"
const DEFAULT_SHOP_ZOHO_CUSTOMER_ID = '4265011000038735005' // Zoho Books customer "Burjman Shop - Web & App"

// Gross Stripe customer payments land here; payouts and fees clear it later.
const DEPOSIT_ACCOUNT_NAME = 'Stripe Undeposited Funds'
const DEPOSIT_ACCOUNT_CODE = '1019'
// Stripe processing fees clear the invoice here; a later journal moves them to the "Stripe Fees" expense.
const FEE_ACCOUNT_NAME = 'Stripe Processing Chg Un-Cleared'
const FEE_ACCOUNT_CODE = '1013'
// Confirmed customer overpayments are held here (liability) until Stripe refunds them.
const ADVANCE_ACCOUNT_NAME = 'Customer Advance Funds'
const ADVANCE_ACCOUNT_CODE = '1123'
const ADVANCE_ACCOUNT_ID = '4265011000015681205'
const ADVANCE_ACCOUNT_TYPE = 'other_current_liability'
// One journal per fully posted payout moves its total fees from 1013 to this expense.
const FEE_ACCOUNT_ID = '4265011000000699653'
const FEE_EXPENSE_ACCOUNT_NAME = 'Stripe Fees'
const FEE_EXPENSE_ACCOUNT_CODE = '2270'
const FEE_EXPENSE_ACCOUNT_ID = '4265011000000648121'
const FEE_EXPENSE_ACCOUNT_TYPE = 'expense'
// Legacy manual fee journals were dated from shortly before the payout to weeks after it.
const LEGACY_FEE_JOURNAL_DAYS_BEFORE = 7
const LEGACY_FEE_JOURNAL_DAYS_AFTER = 60
const UNCERTAIN_SETTLE_MINUTES = 15
const WEBSITE_CUSTOMER_NAME = 'Website'
const SHOP_CUSTOMER_NAME = 'Burjman Shop - Web & App'

function envString(name, fallback) {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return fallback
  return String(raw).trim()
}

function getStripeClearingConfig() {
  return {
    websiteZohoCustomerId: envString('STRIPE_CLEARING_ZOHO_CUSTOMER_ID', DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID),
    shopZohoCustomerId: envString('STRIPE_CLEARING_SHOP_ZOHO_CUSTOMER_ID', DEFAULT_SHOP_ZOHO_CUSTOMER_ID),
    // The website stores no currency column; every order is priced in AED.
    websiteCurrency: 'AED',
    amountTolerance: 0.01,
    maxRangeDays: 7,
    maxRows: 100,
    defaultRows: 50,
    // Website dates are Dubai calendar days.
    timezoneOffset: '+04:00',
    // Posting stays off unless explicitly enabled on the server.
    postingEnabled: envString('STRIPE_CLEARING_POSTING_ENABLED', '').toLowerCase() === 'true',
    paymentMode: 'Stripe',
    depositAccountName: DEPOSIT_ACCOUNT_NAME,
    depositAccountCode: DEPOSIT_ACCOUNT_CODE,
    // Optional pin; it must still resolve to the named account in the chart of accounts.
    depositAccountId: envString('STRIPE_CLEARING_DEPOSIT_ACCOUNT_ID', ''),
    feeAccountName: FEE_ACCOUNT_NAME,
    feeAccountCode: FEE_ACCOUNT_CODE,
    feeAccountId: FEE_ACCOUNT_ID,
    advanceAccountName: ADVANCE_ACCOUNT_NAME,
    advanceAccountCode: ADVANCE_ACCOUNT_CODE,
    advanceAccountId: ADVANCE_ACCOUNT_ID,
    advanceAccountType: ADVANCE_ACCOUNT_TYPE,
    feeExpenseAccountName: FEE_EXPENSE_ACCOUNT_NAME,
    feeExpenseAccountCode: FEE_EXPENSE_ACCOUNT_CODE,
    feeExpenseAccountId: FEE_EXPENSE_ACCOUNT_ID,
    feeExpenseAccountType: FEE_EXPENSE_ACCOUNT_TYPE,
    // After an uncertain Zoho write, "confirm not created" stays unavailable this long so a
    // lagging Zoho search can catch up. Extra protection only: it never makes anything retryable.
    uncertainSettleMinutes: UNCERTAIN_SETTLE_MINUTES,
    legacyFeeJournalDaysBefore: LEGACY_FEE_JOURNAL_DAYS_BEFORE,
    legacyFeeJournalDaysAfter: LEGACY_FEE_JOURNAL_DAYS_AFTER,
    websiteCustomerName: WEBSITE_CUSTOMER_NAME,
    shopCustomerName: SHOP_CUSTOMER_NAME,
  }
}

module.exports = {
  DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID,
  DEFAULT_SHOP_ZOHO_CUSTOMER_ID,
  DEPOSIT_ACCOUNT_NAME,
  DEPOSIT_ACCOUNT_CODE,
  FEE_ACCOUNT_NAME,
  FEE_ACCOUNT_CODE,
  ADVANCE_ACCOUNT_NAME,
  ADVANCE_ACCOUNT_CODE,
  ADVANCE_ACCOUNT_ID,
  FEE_EXPENSE_ACCOUNT_ID,
  getStripeClearingConfig,
}

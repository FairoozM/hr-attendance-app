'use strict'

/**
 * Tabby settlement clearing settings.
 *
 * Tabby pays one AED settlement per statement ("Tabby20260928AED"). Each sale clears its website
 * order's Zoho invoice with two customer payments: the transferred amount into Tabby Undeposited
 * Funds and Tabby's total deduction into the Tabby processing-charge clearing account. One journal
 * per statement then moves that clearing balance to Tabby Commission Expense, Tabby Fees Expense
 * and Input VAT, so the clearing account ends at zero. The payout fee (+ VAT) comes straight out of
 * Tabby Undeposited Funds, and the bank payout moves what is left to RAK Bank.
 *
 * Accounts are never hardcoded by ID: each role resolves from the Zoho chart of accounts by exact
 * name, then by a known equivalent name, and must have the expected account type. An admin-saved
 * mapping always wins. A role that resolves to nothing blocks posting.
 */

const { DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID, DEFAULT_SHOP_ZOHO_CUSTOMER_ID } = require('./stripeClearing')

const ACCOUNT_ROLE = Object.freeze({
  UNDEPOSITED: 'UNDEPOSITED',
  PROCESSING: 'PROCESSING',
  COMMISSION_EXPENSE: 'COMMISSION_EXPENSE',
  FEES_EXPENSE: 'FEES_EXPENSE',
  INPUT_VAT: 'INPUT_VAT',
  BANK: 'BANK',
})

/**
 * `aliases` are existing Zoho accounts proven (by their posting history) to play this role.
 * `types` are the Zoho account types the role accepts; customer payments can only deposit to
 * cash / bank accounts, so both clearing roles are limited to those.
 */
const ACCOUNT_ROLES = Object.freeze([
  {
    role: ACCOUNT_ROLE.UNDEPOSITED,
    label: 'Tabby Undeposited Funds',
    names: ['Tabby Undeposited Funds'],
    aliases: [],
    types: ['cash', 'bank'],
  },
  {
    role: ACCOUNT_ROLE.PROCESSING,
    label: 'Tabby Processing Chg Un-Cleared',
    names: ['Tabby Processing Chg Un-Cleared'],
    // Receives the "Tabby commission paid" customer payments and is cleared "Uncleared to cleared".
    aliases: ['Tabby Un-cleared Commission'],
    types: ['cash', 'bank'],
  },
  {
    role: ACCOUNT_ROLE.COMMISSION_EXPENSE,
    label: 'Tabby Commission Expense',
    names: ['Tabby Commission Expense'],
    aliases: [],
    types: ['expense', 'other_expense', 'cost_of_goods_sold'],
  },
  {
    role: ACCOUNT_ROLE.FEES_EXPENSE,
    label: 'Tabby Fees Expense',
    names: ['Tabby Fees Expense'],
    // "Tabby Payout Fee" only ever held payout fees; fixed transaction fees need an admin decision.
    aliases: [],
    suggestions: ['Tabby Payout Fee'],
    types: ['expense', 'other_expense', 'cost_of_goods_sold'],
  },
  {
    role: ACCOUNT_ROLE.INPUT_VAT,
    label: 'Input VAT',
    names: ['Input VAT'],
    // The Input VAT account Noon settlement fees already post to (services, not warehouse goods).
    aliases: ['Input VAT - All Except Basmat Goods WH'],
    types: ['other_current_asset', 'other_current_liability'],
  },
  {
    role: ACCOUNT_ROLE.BANK,
    label: 'RAK Bank',
    names: ['RAK Bank'],
    aliases: ['RAK BANK MAIN 5061'],
    types: ['bank'],
  },
])

function envString(name, fallback) {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return fallback
  return String(raw).trim()
}

function getTabbyClearingConfig() {
  return {
    websiteZohoCustomerId: envString('STRIPE_CLEARING_ZOHO_CUSTOMER_ID', DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID),
    shopZohoCustomerId: envString('STRIPE_CLEARING_SHOP_ZOHO_CUSTOMER_ID', DEFAULT_SHOP_ZOHO_CUSTOMER_ID),
    websiteCustomerName: 'Website',
    shopCustomerName: 'Burjman Shop - Web & App',
    websiteCurrency: 'AED',
    currency: 'AED',
    expectedMerchantCode: envString('TABBY_CLEARING_MERCHANT_CODE', 'lsapp'),
    // One fils: line-level rounding Tabby may leave between components.
    toleranceMinor: 1,
    amountTolerance: 0.01,
    vatRate: 0.05,
    // Per-row VAT may be rounded per component by Tabby; beyond this it is not 5 %.
    vatToleranceMinor: 2,
    // Matches the payment mode of the Tabby receipts already in Zoho.
    paymentMode: 'Bank Transfer',
    // Posting stays off unless explicitly enabled on the server.
    postingEnabled: envString('TABBY_CLEARING_POSTING_ENABLED', '').toLowerCase() === 'true',
    // A POST whose result is unknown is only retried once a complete Zoho read this long after
    // the attempt still finds nothing.
    uncertainSettleMinutes: 5,
    // Existing Tabby → RAK transfers are searched from a few days before the statement transfer date.
    bankSearchDaysBefore: 3,
    bankSearchDaysAfter: 30,
    accountRoles: ACCOUNT_ROLES,
  }
}

module.exports = { ACCOUNT_ROLE, ACCOUNT_ROLES, getTabbyClearingConfig }

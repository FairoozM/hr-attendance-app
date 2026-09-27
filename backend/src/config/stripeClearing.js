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
  }
}

module.exports = {
  DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID,
  DEFAULT_SHOP_ZOHO_CUSTOMER_ID,
  DEPOSIT_ACCOUNT_NAME,
  DEPOSIT_ACCOUNT_CODE,
  getStripeClearingConfig,
}

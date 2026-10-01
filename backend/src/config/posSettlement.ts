'use strict'

/**
 * Mashreq POS settlement clearing settings.
 *
 * Mashreq settles card payments taken on the POS infrastructure (BurJuman shop terminals and the
 * website / web-app POS flow) into RAK Bank. Every transaction carries an RRN; the RRN is written
 * on the Zoho invoice, so the RRN finds the invoice the settlement pays.
 *
 * Accounting per payout (same NET/FEE architecture as Stripe and Tabby, POS accounts only):
 *   RECEIPT_NET       customer payment  Dr POS-Machine Undeposited Funds       / Cr AR   net per invoice
 *   RECEIPT_FEE       customer payment  Dr POS-Machine Uncleared Commission Exp / Cr AR   commission + VAT per invoice
 *   RECEIPT_RECLASS   journal moving the NET/FEE difference of receipts that already exist in Zoho
 *   FEE_RECOGNITION   journal  Dr POS-Machine Transaction Fee + Dr Input VAT / Cr Uncleared Commission
 *   BANK_CLEARING     transfer POS-Machine Undeposited Funds → RAK Bank (only when no transfer exists)
 *
 * Accounts are never hardcoded by ID. Each role resolves from the Zoho chart by exact name, then a
 * known equivalent; an admin-saved mapping always wins. The names below are the accounts Zoho
 * already uses for POS receipts (verified read-only on 2026-10-01).
 */

const { DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID, DEFAULT_SHOP_ZOHO_CUSTOMER_ID } = require('./stripeClearing')

const POS_ACCOUNT_ROLE = Object.freeze({
  UNDEPOSITED: 'UNDEPOSITED',
  PROCESSING: 'PROCESSING',
  FEE_EXPENSE: 'FEE_EXPENSE',
  INPUT_VAT: 'INPUT_VAT',
  BANK: 'BANK',
})

type AccountRole = {
  role: string
  label: string
  names: string[]
  aliases: string[]
  suggestions?: string[]
  types: string[]
}

const POS_ACCOUNT_ROLES: readonly AccountRole[] = Object.freeze([
  {
    role: POS_ACCOUNT_ROLE.UNDEPOSITED,
    label: 'POS Undeposited Funds',
    names: ['POS-Machine Undeposited Funds'],
    aliases: [],
    types: ['cash', 'bank'],
  },
  {
    role: POS_ACCOUNT_ROLE.PROCESSING,
    label: 'POS Processing Charges Un-Cleared',
    names: ['POS-Machine Uncleared Commission Exp'],
    aliases: [],
    suggestions: ['Website Uncleared POS Chg.'],
    types: ['cash', 'bank'],
  },
  {
    role: POS_ACCOUNT_ROLE.FEE_EXPENSE,
    label: 'POS Machine Transaction Fee',
    names: ['POS-Machine Transaction Fee'],
    aliases: [],
    types: ['expense', 'other_expense', 'cost_of_goods_sold'],
  },
  {
    role: POS_ACCOUNT_ROLE.INPUT_VAT,
    label: 'Input VAT',
    names: ['Input VAT'],
    aliases: ['Input VAT - All Except Basmat Goods WH'],
    types: ['other_current_asset', 'other_current_liability'],
  },
  {
    role: POS_ACCOUNT_ROLE.BANK,
    label: 'RAK Bank',
    names: ['RAK Bank'],
    aliases: ['RAK BANK MAIN 5061'],
    types: ['bank'],
  },
])

const POS_CHANNEL = Object.freeze({
  WEBSITE: 'WEBSITE',
  WEB_APP: 'WEB_APP',
  BURJUMAN_SHOP: 'BURJUMAN_SHOP',
  UNKNOWN: 'UNKNOWN',
})

const SOURCE_FORMAT = Object.freeze({
  ENRICH_CSV: 'ENRICH_CSV',
  SIMPLE_CSV: 'SIMPLE_CSV',
  DETAIL_TXT: 'DETAIL_TXT',
  MSA: 'MSA',
})

function envString(name: string, fallback: string): string {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return fallback
  return String(raw).trim()
}

function envJson(name: string): Record<string, unknown> | null {
  const raw = envString(name, '')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    console.warn(`[pos-settlement] ${name} is not valid JSON; ignored.`)
    return null
  }
}

function zohoOrganizationId(): string {
  try {
    const { readZohoConfig } = require('../integrations/zoho/zohoConfig')
    const c = readZohoConfig()
    return c && c.organizationId ? String(c.organizationId) : ''
  } catch {
    return ''
  }
}

function getPosSettlementConfig() {
  const websiteZohoCustomerId = envString('STRIPE_CLEARING_ZOHO_CUSTOMER_ID', DEFAULT_WEBSITE_ZOHO_CUSTOMER_ID)
  const shopZohoCustomerId = envString('STRIPE_CLEARING_SHOP_ZOHO_CUSTOMER_ID', DEFAULT_SHOP_ZOHO_CUSTOMER_ID)
  return {
    provider: 'MASHREQ',
    organizationId: zohoOrganizationId() || 'default',
    currency: 'AED',
    websiteZohoCustomerId,
    shopZohoCustomerId,
    // Customers whose invoices are indexed for RRN. Shop invoices are read in full; website-customer
    // invoices only for website orders paid by POS (or every one on a deep scan).
    rrnScanCustomerIds: [shopZohoCustomerId, websiteZohoCustomerId],
    // Invoice details read per preview; the rest are read on the next preview (the index persists).
    maxInvoiceDetailsPerScan: 150,
    websiteCustomerName: 'Website',
    shopCustomerName: 'Burjman Shop - Web & App',
    // Where the RRN lives in Zoho. Verified read-only: invoice "notes", written as "RRN : 003042448545".
    // Not returned by the invoice list, so each invoice detail is read once and indexed locally.
    rrnSource: {
      entity: 'invoice',
      field: envString('POS_RRN_ZOHO_FIELD', 'notes'),
      // A custom field api_name / label can replace "notes" (POS_RRN_ZOHO_FIELD=cf_rrn) without code changes.
      label: /\bRRN\b/i,
      digits: 12,
    },
    // UAE merchants: DD/MM/YYYY.
    dateOrder: envString('POS_MASHREQ_DATE_ORDER', 'DMY') as 'DMY' | 'MDY',
    // Extra header aliases for Mashreq exports: {"rrn":["RRN NUMBER"],"grossAmount":["TXN AMT"]}.
    headerAliases: envJson('POS_MASHREQ_HEADER_ALIASES'),
    vatRate: 0.05,
    // VAT on Mashreq charges may be rounded per row by up to one fils.
    vatToleranceMinor: 1,
    // Matches the payment mode of the POS receipts already in Zoho.
    paymentMode: 'Card',
    // Posting stays off unless explicitly enabled on the server.
    postingEnabled: envString('POS_SETTLEMENT_POSTING_ENABLED', '').toLowerCase() === 'true',
    uncertainSettleMinutes: 5,
    // Invoices are indexed for RRN from a few days before the earliest transaction to a few after the latest.
    rrnScanDaysBefore: 3,
    rrnScanDaysAfter: 3,
    // Existing POS → RAK transfers and RAK deposits are searched in this window around the payout date.
    bankSearchDaysBefore: 2,
    bankSearchDaysAfter: 21,
    // Possible (never automatic) matches on amount: invoice dated within this many days of the transaction.
    possibleMatchDays: 2,
    // Every Zoho reference this workflow writes starts with this prefix (no app branding).
    referencePrefix: 'MSQ',
    accountRoles: POS_ACCOUNT_ROLES,
  }
}

module.exports = { POS_ACCOUNT_ROLE, POS_ACCOUNT_ROLES, POS_CHANNEL, SOURCE_FORMAT, getPosSettlementConfig }

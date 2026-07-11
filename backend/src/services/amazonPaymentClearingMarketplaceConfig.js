/**
 * Marketplace-specific config for Amazon Payment Clearing (KSA / UAE).
 */

const AMAZON_LIST_REPORTS_MAX_DAYS_BACK = Number(process.env.AMAZON_LIST_REPORTS_MAX_DAYS_BACK) || 90
const DEFAULT_SETTLEMENT_REPORT_TYPE = 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2'

const KSA_ZOHO_CUSTOMER_NAME = 'KSA-Amazon'
const LEGACY_KSA_ZOHO_CUSTOMER_NAME = 'Life Smile Business'
const UAE_ZOHO_CUSTOMER_NAME = 'Amazon'

/** @typedef {'ksa'|'uae'} MarketplaceKey */
/** @typedef {'KSA'|'UAE'} MarketplaceCode */

/**
 * @param {unknown} value
 * @returns {MarketplaceKey}
 */
function normalizeMarketplaceKey(value) {
  const k = String(value == null ? 'ksa' : value)
    .trim()
    .toLowerCase()
  return k === 'uae' ? 'uae' : 'ksa'
}

/**
 * @param {unknown} value
 * @returns {MarketplaceCode}
 */
function normalizeMarketplaceCode(value) {
  const k = String(value == null ? 'KSA' : value)
    .trim()
    .toUpperCase()
  return k === 'UAE' ? 'UAE' : 'KSA'
}

/**
 * @param {unknown} value
 * @returns {MarketplaceKey}
 */
function marketplaceKeyFromCodeOrKey(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase()
  if (raw === 'uae') return 'uae'
  if (raw === 'ksa') return 'ksa'
  const code = normalizeMarketplaceCode(value)
  return code === 'UAE' ? 'uae' : 'ksa'
}

/**
 * @param {MarketplaceKey} key
 */
function envPrefix(key) {
  return key === 'uae' ? 'AMAZON_UAE' : 'AMAZON_KSA'
}

/**
 * @param {MarketplaceKey} key
 * @param {string} suffix
 * @param {string} [fallback]
 */
function readEnv(key, suffix, fallback = '') {
  const v = process.env[`${envPrefix(key)}_${suffix}`]
  if (v == null || String(v).trim() === '') return fallback
  return String(v).trim()
}

/**
 * @param {MarketplaceKey} key
 * @param {string} suffix
 * @param {number} fallback
 */
function readEnvNumber(key, suffix, fallback) {
  const raw = process.env[`${envPrefix(key)}_${suffix}`]
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * @param {MarketplaceKey} key
 */
function paymentAccountEnvDefs(key) {
  const prefix = envPrefix(key)
  const names =
    key === 'uae'
      ? {
          undeposited: 'Amazon Undeposited Funds',
          commission: 'Amazon Uncleared Commission Exp',
          shipping: 'Amazon Uncleared Shipping Exp',
        }
      : {
          undeposited: 'KSA-Amazon Undeposited Funds',
          commission: 'KSA-Amazon Uncleared Commission Exp',
          shipping: 'KSA-Amazon Uncleared Shipping Exp',
        }
  return Object.freeze({
    1024: {
      id: `${prefix}_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID`,
      name: `${prefix}_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_NAME`,
      defaultName: names.undeposited,
    },
    1026: {
      id: `${prefix}_ZOHO_COMMISSION_ACCOUNT_ID`,
      name: `${prefix}_ZOHO_COMMISSION_ACCOUNT_NAME`,
      defaultName: names.commission,
    },
    1028: {
      id: `${prefix}_ZOHO_SHIPPING_FBA_ACCOUNT_ID`,
      name: `${prefix}_ZOHO_SHIPPING_FBA_ACCOUNT_NAME`,
      defaultName: names.shipping,
    },
  })
}

/**
 * Default fee-journal debit/credit account name suggestions by marketplace.
 * @param {MarketplaceKey} key
 */
function feeJournalAccountSuggestions(key) {
  if (key === 'uae') {
    return Object.freeze({
      STORAGE: {
        debitAccountName: 'Amazon Storage Exp',
        creditAccountName: 'Amazon Undeposited Funds',
      },
      ADVERTISING: {
        debitAccountName: 'Amazon Advertising Exp',
        creditAccountName: 'Amazon Undeposited Funds',
      },
      ADVERTISING_CREDIT: {
        debitAccountName: 'Amazon Undeposited Funds',
        creditAccountName: 'Amazon Advertising Exp',
      },
      PREMIUM_SERVICES: {
        debitAccountName: 'Amazon Commission Exp',
        creditAccountName: 'Amazon Uncleared Commission Exp',
      },
      COMMISSION: {
        debitAccountName: 'Amazon Commission Exp',
        creditAccountName: 'Amazon Uncleared Commission Exp',
      },
      SHIPPING_FBA: {
        debitAccountName: 'Amazon Shipping Exp',
        creditAccountName: 'Amazon Uncleared Shipping Exp',
      },
      OTHER_ACCOUNT_LEVEL_FEE: {
        debitAccountName: '',
        creditAccountName: '',
      },
    })
  }
  return Object.freeze({
    STORAGE: {
      debitAccountName: 'KSA Amazon Storage Exp',
      creditAccountName: 'KSA-Amazon Undeposited Funds',
    },
    ADVERTISING: {
      debitAccountName: 'KSA-Amazon Advertising Exp',
      creditAccountName: 'KSA-Amazon Undeposited Funds',
    },
    ADVERTISING_CREDIT: {
      debitAccountName: 'KSA-Amazon Undeposited Funds',
      creditAccountName: 'KSA-Amazon Advertising Exp',
    },
    PREMIUM_SERVICES: {
      debitAccountName: 'KSA Amazon Commission Exp',
      creditAccountName: 'KSA-Amazon Uncleared Commission Exp',
    },
    COMMISSION: {
      debitAccountName: 'KSA Amazon Commission Exp',
      creditAccountName: 'KSA-Amazon Uncleared Commission Exp',
    },
    SHIPPING_FBA: {
      debitAccountName: 'KSA Amazon Shipping Exp',
      creditAccountName: 'KSA-Amazon Uncleared Shipping Exp',
    },
    OTHER_ACCOUNT_LEVEL_FEE: {
      debitAccountName: '',
      creditAccountName: '',
    },
  })
}

/**
 * @param {MarketplaceKey} key
 */
function zohoCustomerOptions(key) {
  if (key === 'uae') {
    return Object.freeze([{ name: UAE_ZOHO_CUSTOMER_NAME, label: 'Amazon (UAE)' }])
  }
  return Object.freeze([
    { name: KSA_ZOHO_CUSTOMER_NAME, label: 'KSA-Amazon (current)' },
    { name: LEGACY_KSA_ZOHO_CUSTOMER_NAME, label: 'Life Smile Business (legacy 2025)' },
  ])
}

/**
 * @param {MarketplaceKey|MarketplaceCode|string} [marketplace]
 */
function getPaymentClearingMarketplaceConfig(marketplace) {
  const key = marketplaceKeyFromCodeOrKey(marketplace)
  const code = key === 'uae' ? 'UAE' : 'KSA'
  const paymentAccounts = paymentAccountEnvDefs(key)
  const undeposited = paymentAccounts['1024']
  const commission = paymentAccounts['1026']
  const shipping = paymentAccounts['1028']

  return {
    key,
    code,
    label: key === 'uae' ? 'Amazon UAE' : 'Amazon KSA',
    settlementReportType: readEnv(key, 'SETTLEMENT_REPORT_TYPE', DEFAULT_SETTLEMENT_REPORT_TYPE),
    settlementListDaysBack: readEnvNumber(key, 'SETTLEMENT_LIST_DAYS_BACK', AMAZON_LIST_REPORTS_MAX_DAYS_BACK),
    settlementListPageSize: readEnvNumber(key, 'SETTLEMENT_LIST_PAGE_SIZE', 100),
    settlementListMaxPages: readEnvNumber(key, 'SETTLEMENT_LIST_MAX_PAGES', 20),
    listReportsMaxDaysBack: AMAZON_LIST_REPORTS_MAX_DAYS_BACK,
    zohoCustomerIdEnv: `${envPrefix(key)}_ZOHO_CUSTOMER_ID`,
    zohoCustomerId: readEnv(key, 'ZOHO_CUSTOMER_ID', ''),
    defaultZohoCustomerName: key === 'uae' ? UAE_ZOHO_CUSTOMER_NAME : KSA_ZOHO_CUSTOMER_NAME,
    zohoCustomerOptions: zohoCustomerOptions(key),
    paymentAccountEnv: paymentAccounts,
    paymentAccountMapEnv: `${envPrefix(key)}_ZOHO_PAYMENT_ACCOUNT_MAP`,
    returnVarianceAccountIdEnv: `${envPrefix(key)}_ZOHO_RETURN_VARIANCE_ACCOUNT_ID`,
    returnVarianceAccountId: readEnv(key, 'ZOHO_RETURN_VARIANCE_ACCOUNT_ID', ''),
    returnFeeAccounts: Object.freeze({
      UNDEPOSITED: { accountCode: '1024', accountName: undeposited.defaultName },
      COMMISSION: { accountCode: '1026', accountName: commission.defaultName },
      SHIPPING_FBA: { accountCode: '1028', accountName: shipping.defaultName },
    }),
    paymentPreviewAccounts: Object.freeze({
      NET_BALANCE: {
        depositToAccountCode: '1024',
        depositToAccountName: undeposited.defaultName,
      },
      COMMISSION: {
        depositToAccountCode: '1026',
        depositToAccountName: commission.defaultName,
      },
      SHIPPING_FBA: {
        depositToAccountCode: '1028',
        depositToAccountName: shipping.defaultName,
      },
      REFUND_RETURN: {
        depositToAccountCode: 'credit_note_application',
        depositToAccountName: 'Zoho Credit Note Application',
      },
      ADJUSTMENT: {
        depositToAccountCode: 'adjustment_clearing',
        depositToAccountName: 'Amazon Adjustment Clearing',
      },
    }),
    undepositedAccountCode: '1024',
    undepositedAccountName: undeposited.defaultName,
    feeJournalAccountSuggestions: feeJournalAccountSuggestions(key),
    journalNotesLabel: key === 'uae' ? 'Amazon UAE' : 'Amazon KSA',
    settlementNotFoundCode:
      key === 'uae' ? 'AMAZON_UAE_SETTLEMENT_REPORT_NOT_FOUND' : 'AMAZON_KSA_SETTLEMENT_REPORT_NOT_FOUND',
    settlementNotFoundMessage:
      key === 'uae'
        ? 'No recent UAE settlement report found in Amazon SP-API.'
        : 'No recent KSA settlement report found in Amazon SP-API.',
    marketplaceMismatchCode: 'AMAZON_PAYMENT_CLEARING_MARKETPLACE_MISMATCH',
    supportsLegacySarToAed: key === 'ksa',
  }
}

/**
 * Assert a loaded batch belongs to the expected marketplace.
 * @param {{ marketplace?: string }|null|undefined} batch
 * @param {MarketplaceKey|MarketplaceCode|string} expected
 */
function assertBatchMarketplace(batch, expected) {
  const cfg = getPaymentClearingMarketplaceConfig(expected)
  const batchCode = normalizeMarketplaceCode(batch?.marketplace || cfg.code)
  if (batchCode !== cfg.code) {
    const err = new Error(
      `Batch marketplace is ${batchCode}, but this endpoint is for ${cfg.code}.`
    )
    err.code = cfg.marketplaceMismatchCode
    err.status = 409
    throw err
  }
  return cfg
}

module.exports = {
  AMAZON_LIST_REPORTS_MAX_DAYS_BACK,
  DEFAULT_SETTLEMENT_REPORT_TYPE,
  KSA_ZOHO_CUSTOMER_NAME,
  LEGACY_KSA_ZOHO_CUSTOMER_NAME,
  UAE_ZOHO_CUSTOMER_NAME,
  normalizeMarketplaceKey,
  normalizeMarketplaceCode,
  marketplaceKeyFromCodeOrKey,
  getPaymentClearingMarketplaceConfig,
  assertBatchMarketplace,
  paymentAccountEnvDefs,
  feeJournalAccountSuggestions,
  zohoCustomerOptions,
}

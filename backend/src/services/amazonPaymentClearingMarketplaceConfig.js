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
 * Clearing accounts per marketplace, keyed by the real Zoho account code.
 * UAE ids are the verified Zoho Books account ids; KSA ids come from env only.
 * @param {MarketplaceKey} key
 */
function clearingAccountDefs(key) {
  if (key === 'uae') {
    return Object.freeze({
      UNDEPOSITED: { accountCode: '1016', defaultName: 'Amazon Undeposided Funds', verifiedAccountId: '4265011000000781161' },
      COMMISSION: { accountCode: '1021', defaultName: 'Amazon Uncleared Commission', verifiedAccountId: '4265011000002206949' },
      SHIPPING_FBA: { accountCode: '1025', defaultName: 'Amazon Uncleared Shipping Expense', verifiedAccountId: '4265011000002230152' },
    })
  }
  return Object.freeze({
    UNDEPOSITED: { accountCode: '1024', defaultName: 'KSA-Amazon Undeposited Funds', verifiedAccountId: '' },
    COMMISSION: { accountCode: '1026', defaultName: 'KSA-Amazon Uncleared Commission Exp', verifiedAccountId: '' },
    SHIPPING_FBA: { accountCode: '1028', defaultName: 'KSA-Amazon Uncleared Shipping Exp', verifiedAccountId: '' },
  })
}

const ACCOUNT_ROLE_ENV_SUFFIX = Object.freeze({
  UNDEPOSITED: 'UNDEPOSITED_FUNDS',
  COMMISSION: 'COMMISSION',
  SHIPPING_FBA: 'SHIPPING_FBA',
})

/**
 * @param {MarketplaceKey} key
 */
function paymentAccountEnvDefs(key) {
  const prefix = envPrefix(key)
  const defs = clearingAccountDefs(key)
  const out = {}
  for (const [role, def] of Object.entries(defs)) {
    out[def.accountCode] = {
      role,
      id: `${prefix}_ZOHO_${ACCOUNT_ROLE_ENV_SUFFIX[role]}_ACCOUNT_ID`,
      name: `${prefix}_ZOHO_${ACCOUNT_ROLE_ENV_SUFFIX[role]}_ACCOUNT_NAME`,
      defaultName: def.defaultName,
      verifiedAccountId: def.verifiedAccountId,
    }
  }
  return Object.freeze(out)
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
        creditAccountName: 'Amazon Undeposided Funds',
      },
      ADVERTISING: {
        debitAccountName: 'Amazon Advertising Exp',
        creditAccountName: 'Amazon Undeposided Funds',
      },
      ADVERTISING_CREDIT: {
        debitAccountName: 'Amazon Undeposided Funds',
        creditAccountName: 'Amazon Advertising Exp',
      },
      PREMIUM_SERVICES: {
        debitAccountName: 'Amazon Commission Exp',
        creditAccountName: 'Amazon Uncleared Commission',
      },
      COMMISSION: {
        debitAccountName: 'Amazon Commission Exp',
        creditAccountName: 'Amazon Uncleared Commission',
      },
      SHIPPING_FBA: {
        debitAccountName: 'Amazon Shipping Exp',
        creditAccountName: 'Amazon Uncleared Shipping Expense',
      },
      SUBSCRIPTION: {
        debitAccountName: 'Amazon Commission Exp',
        creditAccountName: 'Amazon Uncleared Commission',
      },
      SAFET_REIMBURSEMENT: {
        debitAccountName: 'Amazon Undeposided Funds',
        creditAccountName: 'Amazon Safe-T Damage Claim',
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
    SUBSCRIPTION: {
      debitAccountName: 'KSA Amazon Commission Exp',
      creditAccountName: 'KSA-Amazon Uncleared Commission Exp',
    },
    SAFET_REIMBURSEMENT: {
      debitAccountName: 'KSA-Amazon Undeposited Funds',
      creditAccountName: 'KSA-Amazon Safe-T Damage Claim',
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
  const clearingAccounts = clearingAccountDefs(key)
  const undeposited = clearingAccounts.UNDEPOSITED
  const commission = clearingAccounts.COMMISSION
  const shipping = clearingAccounts.SHIPPING_FBA
  const commissionExpenseAccount = Object.freeze({
    accountCode: 'commission_expense',
    accountName: readEnv(key, 'ZOHO_COMMISSION_EXPENSE_ACCOUNT_NAME', key === 'uae' ? 'Amazon Commission Exp' : 'KSA Amazon Commission Exp'),
    accountId: readEnv(key, 'ZOHO_COMMISSION_EXPENSE_ACCOUNT_ID', key === 'uae' ? '4265011000000708205' : '4265011000012454629'),
  })
  const shippingExpenseAccount = Object.freeze({
    accountCode: 'shipping_expense',
    accountName: readEnv(key, 'ZOHO_SHIPPING_EXPENSE_ACCOUNT_NAME', key === 'uae' ? 'Amazon Shipping Exp.' : 'KSA Amazon Shipping Exp'),
    accountId: readEnv(key, 'ZOHO_SHIPPING_EXPENSE_ACCOUNT_ID', key === 'uae' ? '4265011000000747608' : '4265011000012454635'),
  })

  return {
    key,
    code,
    label: key === 'uae' ? 'Amazon UAE' : 'Amazon KSA',
    currency: key === 'uae' ? 'AED' : 'SAR',
    country: key === 'uae' ? 'AE' : 'SA',
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
    returnExpenseAccountIdEnv: `${envPrefix(key)}_ZOHO_RETURN_EXPENSE_ACCOUNT_ID`,
    returnExpenseAccount: Object.freeze({
      accountCode: 'return_expense',
      accountName: readEnv(key, 'ZOHO_RETURN_EXPENSE_ACCOUNT_NAME', key === 'uae' ? 'Amazon Return Exp' : 'KSA-Amazon Return Exp'),
      accountId: readEnv(key, 'ZOHO_RETURN_EXPENSE_ACCOUNT_ID', key === 'uae' ? '4265011000003287848' : ''),
    }),
    unclearedClearing: Object.freeze({
      vatRate: Number(readEnv(key, 'FEE_VAT_RATE', key === 'uae' ? '0.05' : '0.15')),
      inputVatAccountIdEnv: `${envPrefix(key)}_ZOHO_INPUT_VAT_ACCOUNT_ID`,
      inputVatAccount: Object.freeze({
        accountCode: 'input_vat',
        accountName: readEnv(key, 'ZOHO_INPUT_VAT_ACCOUNT_NAME', key === 'uae' ? 'Input VAT - All Except Basmat Goods WH' : 'KSA Input VAT'),
        accountId: readEnv(key, 'ZOHO_INPUT_VAT_ACCOUNT_ID', key === 'uae' ? '4265011000000077044' : ''),
      }),
      commissionExpenseAccountIdEnv: `${envPrefix(key)}_ZOHO_COMMISSION_EXPENSE_ACCOUNT_ID`,
      commissionExpenseAccount,
      shippingExpenseAccountIdEnv: `${envPrefix(key)}_ZOHO_SHIPPING_EXPENSE_ACCOUNT_ID`,
      shippingExpenseAccount,
    }),
    clearingAccounts,
    // Return fee reversals belong to orders settled earlier, so they post straight to
    // expense; only the settlement's own record payments sit on the uncleared accounts.
    returnFeeAccounts: Object.freeze({
      UNDEPOSITED: { accountCode: undeposited.accountCode, accountName: undeposited.defaultName },
      COMMISSION: { ...commissionExpenseAccount },
      SHIPPING_FBA: { ...shippingExpenseAccount },
    }),
    paymentPreviewAccounts: Object.freeze({
      NET_BALANCE: {
        depositToAccountCode: undeposited.accountCode,
        depositToAccountName: undeposited.defaultName,
      },
      COMMISSION: {
        depositToAccountCode: commission.accountCode,
        depositToAccountName: commission.defaultName,
      },
      SHIPPING_FBA: {
        depositToAccountCode: shipping.accountCode,
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
    undepositedAccountCode: undeposited.accountCode,
    undepositedAccountName: undeposited.defaultName,
    undepositedAccountId: undeposited.verifiedAccountId || '',
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
  clearingAccountDefs,
  feeJournalAccountSuggestions,
  zohoCustomerOptions,
}

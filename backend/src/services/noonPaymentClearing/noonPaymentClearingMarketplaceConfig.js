const MARKETPLACE = 'AE'

const ZOHO_CUSTOMER_NAME = process.env.NOON_AE_ZOHO_CUSTOMER_NAME || 'Noon'

function accountFromEnv(prefix, defaults) {
  return {
    accountCode: process.env[`${prefix}_CODE`] || defaults.accountCode || '',
    accountName: process.env[`${prefix}_NAME`] || defaults.accountName || '',
    accountId: process.env[`${prefix}_ID`] || defaults.accountId || '',
  }
}

/**
 * Noon AE payment clearing — Amazon-KSA parallel account roles.
 *
 * First Zoho writes (this settlement):
 *   Invoice Record Payments (customer = Noon):
 *     net → 1066 Undeposited
 *     commission/referral → 1067 Uncleared Commission 14%
 *     shipping/fulfillment (sale + assigned parent logistics) → 1068 Uncleared Shipping
 *   Fee journals (statement-level, e.g. advertising):
 *     Advertising → Dr 2053 (+ Input VAT 1085) / Cr 1066
 *   Uncleared reclass journals (same post, after payments):
 *     1067 → Dr 2143 net + Dr 1085 VAT / Cr 1067 gross
 *     1068 → Dr 2162 net + Dr 1085 VAT / Cr 1068 gross
 */
function getNoonPaymentClearingMarketplaceConfig() {
  const undepositedFunds = accountFromEnv('NOON_AE_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT', {
    accountCode: '1066',
    accountName: 'Noon Undeposited Funds',
  })
  const unclearedCommission = accountFromEnv('NOON_AE_ZOHO_COMMISSION_ACCOUNT', {
    accountCode: '1067',
    accountName: 'Noon Uncleared Commission 14%',
  })
  const unclearedShipping = accountFromEnv('NOON_AE_ZOHO_SHIPPING_ACCOUNT', {
    accountCode: '1068',
    accountName: 'Noon Uncleared Shipping Charges',
  })
  const shippingBenefit = accountFromEnv('NOON_AE_ZOHO_SHIPPING_BENEFIT_ACCOUNT', {
    accountCode: '1065',
    accountName: 'Noon Shipping Benefit',
  })
  const advertisingExpense = accountFromEnv('NOON_AE_ZOHO_ADVERTISING_EXPENSE_ACCOUNT', {
    accountCode: '2053',
    accountName: 'Noon Advertising Exp',
  })
  const shippingExpense = accountFromEnv('NOON_AE_ZOHO_SHIPPING_EXPENSE_ACCOUNT', {
    accountCode: '2162',
    accountName: 'Noon Shipping Exp',
  })
  const commissionExpense = accountFromEnv('NOON_AE_ZOHO_COMMISSION_EXPENSE_ACCOUNT', {
    accountCode: '2143',
    accountName: '14% Noon Commission',
  })
  const storageFees = accountFromEnv('NOON_AE_ZOHO_STORAGE_FEES_ACCOUNT', {
    accountCode: '1207',
    accountName: 'Noon Storage Fees',
  })
  const monthlyStorageFees = accountFromEnv('NOON_AE_ZOHO_MONTHLY_STORAGE_FEES_ACCOUNT', {
    accountCode: '1208',
    accountName: 'Noon Monthly Storage Fees',
  })
  const longTermStorageFees = accountFromEnv('NOON_AE_ZOHO_LONG_TERM_STORAGE_FEES_ACCOUNT', {
    accountCode: '1209',
    accountName: 'Noon Long Term Storage Fees',
  })
  const inputVat = accountFromEnv('NOON_AE_ZOHO_INPUT_VAT_ACCOUNT', {
    accountCode: '1085',
    accountName: 'Input VAT - All Except Basmat Goods WH',
  })

  return {
    marketplace: MARKETPLACE,
    marketplaceKey: 'ae',
    contractType: 'NOON-AE',
    currency: 'AED',
    channelPrefix: 'NOON-AE',
    vatRate: 0.05,
    /** Zoho Books CUSTOMER for invoice Record Payments — not a journal GL account. */
    zohoCustomerName: ZOHO_CUSTOMER_NAME,
    zohoCustomerOptions: [
      { name: ZOHO_CUSTOMER_NAME, label: `${ZOHO_CUSTOMER_NAME} (NOON-AE)`, available: true },
    ],
    undepositedFundsAccount: undepositedFunds,
    unclearedCommissionAccount: unclearedCommission,
    unclearedShippingAccount: unclearedShipping,
    shippingBenefitAccount: shippingBenefit,
    advertisingExpenseAccount: advertisingExpense,
    shippingExpenseAccount: shippingExpense,
    commissionExpenseAccount: commissionExpense,
    storageFeesAccount: storageFees,
    monthlyStorageFeesAccount: monthlyStorageFees,
    longTermStorageFeesAccount: longTermStorageFees,
    inputVatAccount: inputVat,
    paymentPreviewAccounts: {
      NET_BALANCE: {
        depositToAccountCode: undepositedFunds.accountCode,
        depositToAccountName: undepositedFunds.accountName,
        depositToAccountId: undepositedFunds.accountId,
      },
      COMMISSION: {
        depositToAccountCode: unclearedCommission.accountCode,
        depositToAccountName: unclearedCommission.accountName,
        depositToAccountId: unclearedCommission.accountId,
      },
      FULFILLMENT_SHIPPING: {
        depositToAccountCode: unclearedShipping.accountCode,
        depositToAccountName: unclearedShipping.accountName,
        depositToAccountId: unclearedShipping.accountId,
      },
    },
    /**
     * Settlement fee-journal mapping suggestions (statement-level only).
     * Commission/shipping expense codes 2143/2162 are later-reclass targets, not first-post journals.
     */
    feeJournalAccountSuggestions: [
      {
        normalizedFeeType: 'NOON_ADVERTISING_FEE',
        zohoAccountName: advertisingExpense.accountName,
        zohoAccountCode: advertisingExpense.accountCode,
        creditAccountName: undepositedFunds.accountName,
        creditAccountCode: undepositedFunds.accountCode,
      },
      {
        normalizedFeeType: 'ADVERTISING',
        zohoAccountName: advertisingExpense.accountName,
        zohoAccountCode: advertisingExpense.accountCode,
        creditAccountName: undepositedFunds.accountName,
        creditAccountCode: undepositedFunds.accountCode,
      },
      {
        normalizedFeeType: 'STATEMENT_FEE',
        zohoAccountName: advertisingExpense.accountName,
        zohoAccountCode: advertisingExpense.accountCode,
        creditAccountName: undepositedFunds.accountName,
        creditAccountCode: undepositedFunds.accountCode,
      },
      {
        normalizedFeeType: 'OTHER',
        zohoAccountName: '',
        creditAccountName: undepositedFunds.accountName,
        creditAccountCode: undepositedFunds.accountCode,
      },
    ],
  }
}

/**
 * Settlement fee-journal counter (credit for expenses / debit for reversals).
 * Advertising / statement fees → Undeposited 1066
 * (Commission/shipping uncleared counters are for later reclass journals only.)
 */
function getNoonFeeJournalCounterAccount(feeType, cfg = null) {
  const config = cfg || getNoonPaymentClearingMarketplaceConfig()
  const t = String(feeType || '')
    .trim()
    .toUpperCase()
  if (t.includes('COMMISSION') || t.includes('REFERRAL')) {
    return { ...config.unclearedCommissionAccount, role: 'uncleared_commission' }
  }
  if (
    t === 'FULFILLMENT' ||
    t === 'SHIPPING' ||
    t === 'PARENT_ORDER_CHARGE' ||
    t.includes('SHIP') ||
    t.includes('FULFILL')
  ) {
    return { ...config.unclearedShippingAccount, role: 'uncleared_shipping' }
  }
  return { ...config.undepositedFundsAccount, role: 'undeposited' }
}

module.exports = {
  MARKETPLACE,
  ZOHO_CUSTOMER_NAME,
  getNoonPaymentClearingMarketplaceConfig,
  getNoonFeeJournalCounterAccount,
}

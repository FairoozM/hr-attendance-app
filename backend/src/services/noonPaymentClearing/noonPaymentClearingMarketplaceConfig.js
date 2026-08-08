const MARKETPLACE = 'AE'

const ZOHO_CUSTOMER_NAME = process.env.NOON_AE_ZOHO_CUSTOMER_NAME || 'Noon'

function getNoonPaymentClearingMarketplaceConfig() {
  return {
    marketplace: MARKETPLACE,
    marketplaceKey: 'ae',
    contractType: 'NOON-AE',
    currency: 'AED',
    channelPrefix: 'NOON-AE',
    zohoCustomerName: ZOHO_CUSTOMER_NAME,
    zohoCustomerOptions: [
      { name: ZOHO_CUSTOMER_NAME, label: `${ZOHO_CUSTOMER_NAME} (NOON-AE)`, available: true },
    ],
    paymentPreviewAccounts: {
      NET_BALANCE: {
        depositToAccountCode: process.env.NOON_AE_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_CODE || '1024',
        depositToAccountName:
          process.env.NOON_AE_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_NAME || 'Noon Undeposited Funds',
        depositToAccountId: process.env.NOON_AE_ZOHO_UNDEPOSITED_FUNDS_ACCOUNT_ID || '',
      },
      COMMISSION: {
        depositToAccountCode: process.env.NOON_AE_ZOHO_COMMISSION_ACCOUNT_CODE || '1026',
        depositToAccountName:
          process.env.NOON_AE_ZOHO_COMMISSION_ACCOUNT_NAME || 'Noon Uncleared Commission Exp',
        depositToAccountId: process.env.NOON_AE_ZOHO_COMMISSION_ACCOUNT_ID || '',
      },
      FULFILLMENT_SHIPPING: {
        depositToAccountCode: process.env.NOON_AE_ZOHO_FULFILLMENT_ACCOUNT_CODE || '1028',
        depositToAccountName:
          process.env.NOON_AE_ZOHO_FULFILLMENT_ACCOUNT_NAME || 'Noon Uncleared Fulfillment Exp',
        depositToAccountId: process.env.NOON_AE_ZOHO_FULFILLMENT_ACCOUNT_ID || '',
      },
    },
    // Suggested Zoho expense/income account names per fee type.
    // Counter account is always the configured Noon clearing account (not per-fee).
    feeJournalAccountSuggestions: [
      { normalizedFeeType: 'NOON_ADVERTISING_FEE', zohoAccountName: 'Noon Advertising Exp' },
      { normalizedFeeType: 'ADVERTISING', zohoAccountName: 'Noon Advertising Exp' },
      { normalizedFeeType: 'STATEMENT_FEE', zohoAccountName: 'Noon Marketplace Fees' },
      { normalizedFeeType: 'FULFILLMENT', zohoAccountName: 'Noon Uncleared Fulfillment Exp' },
      { normalizedFeeType: 'SHIPPING', zohoAccountName: 'Noon Uncleared Fulfillment Exp' },
      { normalizedFeeType: 'PARENT_ORDER_CHARGE', zohoAccountName: 'Noon Uncleared Fulfillment Exp' },
      { normalizedFeeType: 'ORDER_ADJUSTMENT', zohoAccountName: 'Noon Marketplace Adjustments' },
      { normalizedFeeType: 'OTHER', zohoAccountName: 'Noon Marketplace Fees' },
    ],
  }
}

module.exports = {
  MARKETPLACE,
  ZOHO_CUSTOMER_NAME,
  getNoonPaymentClearingMarketplaceConfig,
}

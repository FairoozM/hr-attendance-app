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
    feeJournalAccountSuggestions: [
      { normalizedFeeType: 'ADVERTISING', debitAccountName: 'Noon Advertising Exp', creditAccountName: 'Noon Undeposited Funds' },
      { normalizedFeeType: 'STATEMENT_FEE', debitAccountName: 'Noon Marketplace Fees', creditAccountName: 'Noon Undeposited Funds' },
      { normalizedFeeType: 'FULFILLMENT', debitAccountName: 'Noon Uncleared Fulfillment Exp', creditAccountName: 'Noon Undeposited Funds' },
      { normalizedFeeType: 'SHIPPING', debitAccountName: 'Noon Uncleared Fulfillment Exp', creditAccountName: 'Noon Undeposited Funds' },
      { normalizedFeeType: 'PARENT_ORDER_CHARGE', debitAccountName: 'Noon Uncleared Fulfillment Exp', creditAccountName: 'Noon Undeposited Funds' },
      { normalizedFeeType: 'ORDER_ADJUSTMENT', debitAccountName: 'Noon Marketplace Adjustments', creditAccountName: 'Noon Undeposited Funds' },
      { normalizedFeeType: 'OTHER', debitAccountName: 'Noon Marketplace Fees', creditAccountName: 'Noon Undeposited Funds' },
    ],
  }
}

module.exports = {
  MARKETPLACE,
  ZOHO_CUSTOMER_NAME,
  getNoonPaymentClearingMarketplaceConfig,
}

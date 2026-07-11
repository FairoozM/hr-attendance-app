import type { PaymentClearingMarketplace } from '../../../api/amazonPaymentClearing'

export type ClearingMarketplace = PaymentClearingMarketplace

export function marketplaceFromPathname(pathname: string): ClearingMarketplace {
  return pathname.includes('/amazon-uae-payment-clearing') ? 'UAE' : 'KSA'
}

export function clearingBasePath(marketplace: ClearingMarketplace): string {
  return marketplace === 'UAE'
    ? '/management/amazon-uae-payment-clearing'
    : '/management/amazon-payment-clearing'
}

export function clearingPageTitle(marketplace: ClearingMarketplace): string {
  return marketplace === 'UAE' ? 'Amazon UAE Payment Clearing' : 'Amazon KSA Payment Clearing'
}

export function defaultZohoCustomerName(marketplace: ClearingMarketplace): string {
  return marketplace === 'UAE' ? 'Amazon' : 'KSA-Amazon'
}

export function undepositedFundsLabel(marketplace: ClearingMarketplace): string {
  return marketplace === 'UAE' ? 'Amazon Undeposited Funds' : 'KSA-Amazon Undeposited Funds'
}

export function commissionAccountLabel(marketplace: ClearingMarketplace): string {
  return marketplace === 'UAE'
    ? 'Amazon Uncleared Commission Exp'
    : 'KSA-Amazon Uncleared Commission Exp'
}

export function shippingAccountLabel(marketplace: ClearingMarketplace): string {
  return marketplace === 'UAE'
    ? 'Amazon Uncleared Shipping Exp'
    : 'KSA-Amazon Uncleared Shipping Exp'
}

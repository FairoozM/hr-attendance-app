import type { PosBankStatus, PosChannel } from '../../../api/posSettlements'
import type { Tone } from '../tabby/tabbyFormat'

export { formatAed, formatDateTime, humanize, recoveryTone, batchStatusTone as settlementStatusTone } from '../tabby/tabbyFormat'

export const CHANNEL_LABEL: Record<PosChannel, string> = {
  WEBSITE: 'Website',
  WEB_APP: 'Web app',
  BURJUMAN_SHOP: 'BurJuman shop',
  UNKNOWN: 'Unknown',
}

export function channelLabel(channel: string | null | undefined): string {
  return (channel && CHANNEL_LABEL[channel as PosChannel]) || channel || '—'
}

export function bankTone(status: PosBankStatus | string | null | undefined): Tone {
  switch (status) {
    case 'BANK_MATCHED':
    case 'BANK_NOT_REQUIRED':
      return 'ok'
    case 'BANK_DEPOSIT_SEEN':
      return 'info'
    case 'BANK_DEPOSIT_NOT_FOUND':
      return 'warn'
    case 'BANK_MATCH_AMBIGUOUS':
    case 'BANK_LOOKUP_FAILED':
      return 'bad'
    default:
      return 'muted'
  }
}

export function matchTone(status: string | null | undefined): Tone {
  if (status === 'MATCHED' || status === 'MANUAL') return 'ok'
  if (status === 'LOOKUP_FAILED') return 'warn'
  return status ? 'bad' : 'muted'
}

export const COMPONENT_LABEL: Record<string, string> = {
  RECEIPT_NET: 'NET receipt → POS Undeposited',
  RECEIPT_FEE: 'FEE receipt → POS Processing',
  RECEIPT_RECLASS: 'Reclassify existing receipts',
  FEE_RECOGNITION: 'Commission + VAT journal',
  BANK_CLEARING: 'POS Undeposited → RAK Bank',
}

export const BASIS_LABEL: Record<string, string> = {
  SETTLEMENT_ID: 'Mashreq settlement ID',
  BANK_REFERENCE: 'bank reference',
  SETTLEMENT_DATE: 'settlement date',
  TRANSACTION_DATE: 'transaction date (no settlement ID in the file)',
}

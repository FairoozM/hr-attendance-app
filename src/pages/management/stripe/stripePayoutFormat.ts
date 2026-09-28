import type {
  StripePayoutComponent,
  StripePayoutGroup,
  StripePayoutGroupStatus,
  StripePayoutLine,
  StripePayoutStatus,
  StripeRecoveryAction,
  StripeZohoAccount,
} from '../../../api/stripe'

export type Tone = 'ok' | 'warn' | 'bad' | 'muted'

export function aed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `AED ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function amount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const GROUP_TONE: Record<StripePayoutGroupStatus, Tone> = {
  READY: 'ok',
  READY_WITH_CUSTOMER_ADVANCE: 'ok',
  PARTIALLY_POSTED: 'warn',
  POSTED: 'muted',
  ALREADY_POSTED: 'muted',
  NEEDS_REVIEW: 'bad',
}

const PAYOUT_TONE: Record<StripePayoutStatus, Tone> = {
  READY: 'ok',
  PARTIALLY_CLEARED: 'warn',
  FULLY_CLEARED: 'muted',
  NEEDS_REVIEW: 'bad',
}

export function groupTone(status: StripePayoutGroupStatus): Tone {
  return GROUP_TONE[status] ?? 'muted'
}

export function payoutTone(status: StripePayoutStatus): Tone {
  return PAYOUT_TONE[status] ?? 'muted'
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

const COMPONENT_LABEL: Record<StripePayoutComponent['component'], string> = {
  NET: 'NET customer payment',
  FEE: 'FEE customer payment',
  CUSTOMER_ADVANCE: 'Customer advance journal',
  CUSTOMER_ADVANCE_REFUND: 'Customer advance refund journal',
}

export function componentLabel(kind: StripePayoutComponent['component']): string {
  return COMPONENT_LABEL[kind] ?? kind
}

const RECOVERY_LABEL: Record<StripeRecoveryAction, string> = {
  SKIP_VERIFIED: 'Verified in Zoho — keep',
  POST_ELIGIBLE: 'Not in Zoho yet',
  RETRY_ELIGIBLE: 'Missing — retry eligible',
  NEEDS_REVIEW: 'Needs review',
}

export function recoveryLabel(action: StripeRecoveryAction): string {
  return RECOVERY_LABEL[action] ?? action
}

export function accountLabel(account: StripeZohoAccount | null | undefined): string {
  if (!account) return 'Not resolved'
  return `[${account.accountCode}] ${account.accountName}`
}

/** Lines whose overpayment still waits for the admin, and can be confirmed now. */
export function confirmableAdvanceLines(group: StripePayoutGroup): StripePayoutLine[] {
  return group.lines.filter((l) => l.advance && !l.advance.confirmed && l.state === 'OPEN')
}

export function advanceLines(group: StripePayoutGroup): StripePayoutLine[] {
  return group.lines.filter((l) => l.advance)
}

/** Where the refund of an advance is (or will be) cleared. */
export function refundPayoutLabel(refundPayoutId: string | null | undefined): string {
  return refundPayoutId || 'Waiting for Stripe payout'
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return '—'
  return value.slice(0, 10)
}

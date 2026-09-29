import type { TabbyBankStatus, TabbyBatchStatus, TabbyRecoveryAction } from '../../../api/tabbyClearing'

export function formatAed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const fixed = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${value < 0 ? '−' : ''}${fixed}`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' })
}

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info'

export function batchStatusTone(status: TabbyBatchStatus | string | null | undefined): Tone {
  switch (status) {
    case 'POSTED':
      return 'ok'
    case 'READY':
      return 'info'
    case 'PARTIALLY_POSTED':
    case 'POSTING':
      return 'warn'
    case 'BLOCKED':
    case 'NEEDS_REVIEW':
      return 'bad'
    default:
      return 'muted'
  }
}

export function bankStatusTone(status: TabbyBankStatus | string | null | undefined): Tone {
  switch (status) {
    case 'BANK_MATCHED':
    case 'BANK_NOT_REQUIRED':
      return 'ok'
    case 'BANK_MATCH_PENDING':
      return 'info'
    case 'BANK_MATCH_AMBIGUOUS':
    case 'BANK_LOOKUP_FAILED':
      return 'bad'
    default:
      return 'muted'
  }
}

export function recoveryTone(action: TabbyRecoveryAction | string | null | undefined): Tone {
  switch (action) {
    case 'SKIP_VERIFIED':
      return 'ok'
    case 'POST_ELIGIBLE':
      return 'info'
    case 'RETRY_ELIGIBLE':
    case 'RECHECK_THEN_RETRY':
    case 'WAIT_UNCERTAIN':
      return 'warn'
    case 'NEEDS_REVIEW':
    case 'LOOKUP_FAILED':
      return 'bad'
    default:
      return 'muted'
  }
}

export function matchTone(status: string | null | undefined): Tone {
  if (!status) return 'muted'
  if (status === 'MATCHED') return 'ok'
  if (status === 'LOOKUP_FAILED' || status === 'NOT_CHECKED') return 'warn'
  return 'bad'
}

export function humanize(code: string | null | undefined): string {
  if (!code) return '—'
  return code
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

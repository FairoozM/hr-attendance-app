'use strict'

/**
 * Data freshness per Control Tower source.
 *
 * ERROR        latest attempt failed/interrupted after the last success (or never succeeded)
 * NEVER_SYNCED no success and no failure on record
 * FRESH / WARNING / STALE by age of the last success against the source's thresholds
 */

const FRESHNESS_STATUS = Object.freeze({
  FRESH: 'FRESH',
  WARNING: 'WARNING',
  STALE: 'STALE',
  NEVER_SYNCED: 'NEVER_SYNCED',
  ERROR: 'ERROR',
})

const HOUR = 60 * 60 * 1000

type FreshnessSourceDef = {
  key: string
  label: string
  jobType: string
  warnAfterMs: number
  staleAfterMs: number
}

const FRESHNESS_SOURCES: FreshnessSourceDef[] = [
  { key: 'listings', label: 'Listings / SKUs', jobType: 'listings', warnAfterMs: 26 * HOUR, staleAfterMs: 50 * HOUR },
  { key: 'orders', label: 'Orders (order report)', jobType: 'sales', warnAfterMs: 2 * HOUR, staleAfterMs: 6 * HOUR },
  { key: 'daily_sales', label: 'Daily sales rollup', jobType: 'rollup', warnAfterMs: 2 * HOUR, staleAfterMs: 6 * HOUR },
  { key: 'fba_inventory', label: 'FBA inventory', jobType: 'fba_inventory', warnAfterMs: 2 * HOUR, staleAfterMs: 6 * HOUR },
  { key: 'warehouse_inventory', label: 'Warehouse inventory (Zoho)', jobType: 'warehouse_stock', warnAfterMs: 4 * HOUR, staleAfterMs: 12 * HOUR },
]

type FreshnessInput = {
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  now: Date
  warnAfterMs: number
  staleAfterMs: number
}

type FreshnessResult = {
  status: string
  lastSuccessAt: string | null
  ageMs: number | null
  lastError: string | null
}

function toMs(value: string | null): number | null {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

function classifyFreshness(input: FreshnessInput): FreshnessResult {
  const success = toMs(input.lastSuccessAt)
  const failure = toMs(input.lastFailureAt)
  const ageMs = success == null ? null : Math.max(0, input.now.getTime() - success)
  const failedSince = failure != null && (success == null || failure > success)
  let status: string
  if (failedSince) status = FRESHNESS_STATUS.ERROR
  else if (success == null) status = FRESHNESS_STATUS.NEVER_SYNCED
  else if ((ageMs as number) >= input.staleAfterMs) status = FRESHNESS_STATUS.STALE
  else if ((ageMs as number) >= input.warnAfterMs) status = FRESHNESS_STATUS.WARNING
  else status = FRESHNESS_STATUS.FRESH
  return {
    status,
    lastSuccessAt: success == null ? null : new Date(success).toISOString(),
    ageMs,
    lastError: failedSince ? input.lastError : null,
  }
}

/** Latest of two ISO timestamps (either may be null). */
function laterOf(a: string | null, b: string | null): string | null {
  const ma = toMs(a)
  const mb = toMs(b)
  if (ma == null) return mb == null ? null : new Date(mb).toISOString()
  if (mb == null) return new Date(ma).toISOString()
  return new Date(Math.max(ma, mb)).toISOString()
}

module.exports = { FRESHNESS_STATUS, FRESHNESS_SOURCES, classifyFreshness, laterOf }

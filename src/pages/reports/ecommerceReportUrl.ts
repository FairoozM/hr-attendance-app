/**
 * Ecommerce Report URL helpers — date + optional section view in the query string.
 * Calendar dates are plain YYYY-MM-DD (no timezone shift).
 */

export const ECOMMERCE_REPORT_QUERY = {
  date: 'date',
  view: 'view',
} as const

export const ECOMMERCE_REPORT_VIEWS = [
  'day',
  'month',
  'year',
  'expenses',
  'returns',
  'ratios',
] as const

export type EcommerceReportView = (typeof ECOMMERCE_REPORT_VIEWS)[number]

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidReportYmd(value: string | null | undefined): boolean {
  if (!value || !YMD_RE.test(value)) return false
  const [ys, ms, ds] = value.split('-')
  const y = Number(ys)
  const m = Number(ms)
  const d = Number(ds)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  // Reject impossible calendar dates (e.g. 2026-02-31) without using local TZ.
  const utc = new Date(Date.UTC(y, m - 1, d))
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d
}

export function todayUaeYmd(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Add calendar days to a YYYY-MM-DD string; result is also YYYY-MM-DD (UAE civil date). */
export function addDaysYmd(dateYmd: string, delta: number): string {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const noon = new Date(
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00+04:00`
  )
  return todayUaeYmd(new Date(noon.getTime() + delta * 86400000))
}

export function parseEcommerceReportSearchParams(
  params: URLSearchParams,
  fallbackToday: string = todayUaeYmd(),
): { date: string; view: EcommerceReportView | null } {
  const rawDate = params.get(ECOMMERCE_REPORT_QUERY.date)
  const date = isValidReportYmd(rawDate) ? String(rawDate) : fallbackToday
  const rawView = params.get(ECOMMERCE_REPORT_QUERY.view)
  const view =
    rawView && (ECOMMERCE_REPORT_VIEWS as readonly string[]).includes(rawView)
      ? (rawView as EcommerceReportView)
      : null
  return { date, view }
}

/**
 * Merge date/view into existing search params (preserves unrelated keys).
 * Omits `view` when null so URLs stay clean.
 */
export function mergeEcommerceReportSearchParams(
  prev: URLSearchParams,
  opts: { date: string; view?: EcommerceReportView | null },
): URLSearchParams {
  const next = new URLSearchParams(prev)
  next.set(ECOMMERCE_REPORT_QUERY.date, opts.date)
  if (opts.view) next.set(ECOMMERCE_REPORT_QUERY.view, opts.view)
  else next.delete(ECOMMERCE_REPORT_QUERY.view)
  return next
}

/** Path + search for login return (HashRouter-safe). */
export function locationToReturnPath(loc: { pathname?: string; search?: string } | null | undefined): string {
  if (!loc?.pathname) return '/'
  const search = loc.search || ''
  return `${loc.pathname}${search}`
}

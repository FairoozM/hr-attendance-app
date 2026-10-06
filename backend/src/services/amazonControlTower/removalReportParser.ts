'use strict'

/**
 * GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA parser (read-only ingestion of removal orders created
 * in Seller Central or automatically by Amazon; the Control Tower never creates removals).
 *
 * KSA columns: request-date, order-id, order-source, order-type, service-speed, order-status,
 * last-updated-date, sku, fnsku, disposition, requested-quantity, cancelled-quantity, disposed-quantity,
 * shipped-quantity, in-process-quantity, removal-fee, currency. The report has no ASIN column and no
 * "completed" column: completed = shipped + disposed (derived).
 */

const { normalizeSku } = require('../../utils/normalizeSku')

type Row = Record<string, string>

const REMOVAL_STATUS_GROUP = Object.freeze({ OPEN: 'OPEN', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', UNKNOWN: 'UNKNOWN' })

function pick(row: Row, keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

function qty(value: unknown): number | null {
  const s = String(value ?? '').trim()
  if (!s || s === '-' || s === '--') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

function money(value: unknown): number | null {
  const s = String(value ?? '').trim()
  if (!s || s === '-' || s === '--') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function ts(value: unknown): string | null {
  const s = String(value ?? '').trim()
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Amazon order-status → OPEN / COMPLETED / CANCELLED / UNKNOWN (raw status is always kept too). */
function removalStatusGroup(rawStatus: string | null | undefined): string {
  const s = String(rawStatus || '').trim().toLowerCase()
  if (!s) return REMOVAL_STATUS_GROUP.UNKNOWN
  if (s.startsWith('cancel')) return REMOVAL_STATUS_GROUP.CANCELLED
  if (s === 'completed' || s === 'complete' || s === 'closed') return REMOVAL_STATUS_GROUP.COMPLETED
  if (['pending', 'planning', 'processing', 'in progress', 'in-progress', 'accepted', 'open', 'received'].includes(s)) {
    return REMOVAL_STATUS_GROUP.OPEN
  }
  return REMOVAL_STATUS_GROUP.UNKNOWN
}

function completedQuantity(shipped: number | null, disposed: number | null): number | null {
  if (shipped == null && disposed == null) return null
  return (shipped || 0) + (disposed || 0)
}

/**
 * A line Amazon marks Completed but whose requested units were all cancelled is grouped CANCELLED
 * (nothing was removed); the raw status stays "Completed".
 */
function lineStatusGroup(rawStatus: string | null, requested: number | null, cancelled: number | null): string {
  const group = removalStatusGroup(rawStatus)
  if (group === REMOVAL_STATUS_GROUP.COMPLETED && requested != null && requested > 0 && cancelled === requested) {
    return REMOVAL_STATUS_GROUP.CANCELLED
  }
  return group
}

function parseRemovalDetailRow(row: Row) {
  const removalOrderId = pick(row, ['order-id', 'order id', 'removal-order-id'])
  const sellerSku = pick(row, ['sku', 'seller-sku'])
  const normalizedSku = normalizeSku(sellerSku)
  if (!removalOrderId || !sellerSku || !normalizedSku) return null
  const requested = qty(row['requested-quantity'])
  const cancelled = qty(row['cancelled-quantity'])
  const disposed = qty(row['disposed-quantity'])
  const shipped = qty(row['shipped-quantity'])
  const orderStatus = pick(row, ['order-status']) || null
  return {
    removalOrderId,
    requestDate: ts(row['request-date']),
    orderSource: pick(row, ['order-source']) || null,
    orderType: pick(row, ['order-type']) || null,
    serviceSpeed: pick(row, ['service-speed']).replace(/^-$/, '') || null,
    orderStatus,
    statusGroup: lineStatusGroup(orderStatus, requested, cancelled),
    lastUpdatedAt: ts(row['last-updated-date']),
    sellerSku,
    normalizedSku,
    fnsku: pick(row, ['fnsku']) || '',
    disposition: pick(row, ['disposition']) || '',
    requestedQuantity: requested,
    cancelledQuantity: cancelled,
    disposedQuantity: disposed,
    shippedQuantity: shipped,
    inProcessQuantity: qty(row['in-process-quantity']),
    completedQuantity: completedQuantity(shipped, disposed),
    removalFee: money(row['removal-fee']),
    currency: pick(row, ['currency']) || null,
    raw: row,
  }
}

type RemovalLine = NonNullable<ReturnType<typeof parseRemovalDetailRow>>

function sumOrNull(values: (number | null)[]): number | null {
  const known = values.filter((v) => v != null) as number[]
  return known.length ? known.reduce((a, b) => a + b, 0) : null
}

/**
 * One header per removal order. Order group: any OPEN line → OPEN; otherwise COMPLETED if any line
 * completed; CANCELLED when every line is cancelled; UNKNOWN otherwise.
 */
function aggregateRemovalOrders(lines: RemovalLine[]) {
  const byOrder = new Map<string, RemovalLine[]>()
  for (const l of lines) {
    const list = byOrder.get(l.removalOrderId) || []
    list.push(l)
    byOrder.set(l.removalOrderId, list)
  }
  return [...byOrder.entries()].map(([removalOrderId, list]) => {
    const groups = new Set(list.map((l) => l.statusGroup))
    let statusGroup: string = REMOVAL_STATUS_GROUP.UNKNOWN
    if (groups.has(REMOVAL_STATUS_GROUP.OPEN)) statusGroup = REMOVAL_STATUS_GROUP.OPEN
    else if (groups.has(REMOVAL_STATUS_GROUP.COMPLETED)) statusGroup = REMOVAL_STATUS_GROUP.COMPLETED
    else if (groups.size === 1 && groups.has(REMOVAL_STATUS_GROUP.CANCELLED)) statusGroup = REMOVAL_STATUS_GROUP.CANCELLED
    const latest = (field: 'lastUpdatedAt' | 'requestDate') =>
      list.map((l) => l[field]).filter(Boolean).sort().at(-1) || null
    const earliestRequest = list.map((l) => l.requestDate).filter(Boolean).sort()[0] || null
    const first = list[0]
    return {
      removalOrderId,
      requestDate: earliestRequest || latest('requestDate'),
      orderSource: first.orderSource,
      orderType: first.orderType,
      serviceSpeed: first.serviceSpeed,
      orderStatus: [...new Set(list.map((l) => l.orderStatus).filter(Boolean))].join(' / ') || null,
      statusGroup,
      lastUpdatedAt: latest('lastUpdatedAt'),
      lineCount: list.length,
      requestedQuantity: sumOrNull(list.map((l) => l.requestedQuantity)),
      shippedQuantity: sumOrNull(list.map((l) => l.shippedQuantity)),
      cancelledQuantity: sumOrNull(list.map((l) => l.cancelledQuantity)),
      disposedQuantity: sumOrNull(list.map((l) => l.disposedQuantity)),
      inProcessQuantity: sumOrNull(list.map((l) => l.inProcessQuantity)),
      completedQuantity: sumOrNull(list.map((l) => l.completedQuantity)),
      removalFee: sumOrNull(list.map((l) => l.removalFee)),
      currency: first.currency,
      raw: { orderSource: first.orderSource, orderType: first.orderType, rawStatuses: [...new Set(list.map((l) => l.orderStatus))] },
    }
  })
}

/** An OPEN order not updated by Amazon for `stuckDays` or more. */
function isRemovalStuck(order: { statusGroup: string; lastUpdatedAt: string | null; requestDate: string | null }, now: Date, stuckDays: number): boolean {
  if (order.statusGroup !== REMOVAL_STATUS_GROUP.OPEN) return false
  const ref = order.lastUpdatedAt || order.requestDate
  if (!ref) return false
  return now.getTime() - new Date(ref).getTime() >= stuckDays * 86_400_000
}

module.exports = {
  REMOVAL_STATUS_GROUP,
  removalStatusGroup,
  lineStatusGroup,
  parseRemovalDetailRow,
  aggregateRemovalOrders,
  isRemovalStuck,
}

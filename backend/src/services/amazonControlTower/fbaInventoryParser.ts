'use strict'

/**
 * FBA Inventory API (`GET /fba/inventory/v1/summaries`, details=true) → per-bucket quantities.
 *
 * Amazon sends some buckets as objects (`unfulfillableQuantity.totalUnfulfillableQuantity`,
 * `researchingQuantity.totalResearchingQuantity`, `reservedQuantity.*`). A bucket Amazon did not
 * send, or sent in an unreadable shape, is `null` — never a fabricated 0.
 */

const { normalizeSku } = require('../../utils/normalizeSku')

type FbaInventoryDetail = {
  sellerSku: string
  normalizedSku: string
  asin: string | null
  fnsku: string | null
  productName: string | null
  fulfillableQuantity: number | null
  inboundWorkingQuantity: number | null
  inboundShippedQuantity: number | null
  inboundReceivingQuantity: number | null
  reservedQuantity: number | null
  reservedCustomerOrders: number | null
  reservedFcTransfer: number | null
  reservedFcProcessing: number | null
  unfulfillableQuantity: number | null
  researchingQuantity: number | null
  totalQuantity: number | null
  amazonLastUpdatedAt: string | null
}

/** Whole, non-negative quantity, or null when missing / not a number. */
function quantityOrNull(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'boolean' || typeof value === 'object') return null
  const text = String(value).replace(/,/g, '').trim()
  if (text === '') return null
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

/** Bucket that may be a plain number or an object carrying `totalKey`. */
function bucketOrNull(value: unknown, totalKey: string): number | null {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return quantityOrNull((value as Record<string, unknown>)[totalKey])
  }
  return quantityOrNull(value)
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null
  const t = String(value).trim()
  return t || null
}

function isoOrNull(value: unknown): string | null {
  const t = textOrNull(value)
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function parseFbaInventorySummary(row: unknown): FbaInventoryDetail | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, any>
  const sellerSku = textOrNull(r.sellerSku ?? r.SellerSKU ?? r.sku)
  if (!sellerSku) return null
  const detailsRaw = r.inventoryDetails
  const details: Record<string, any> = detailsRaw && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw) ? detailsRaw : {}
  const reservedRaw = details.reservedQuantity
  const reserved: Record<string, any> | null =
    reservedRaw && typeof reservedRaw === 'object' && !Array.isArray(reservedRaw) ? reservedRaw : null

  return {
    sellerSku,
    normalizedSku: normalizeSku(sellerSku),
    asin: textOrNull(r.asin),
    fnsku: textOrNull(r.fnSku ?? r.fnsku),
    productName: textOrNull(r.productName),
    fulfillableQuantity: quantityOrNull(details.fulfillableQuantity),
    inboundWorkingQuantity: quantityOrNull(details.inboundWorkingQuantity),
    inboundShippedQuantity: quantityOrNull(details.inboundShippedQuantity),
    inboundReceivingQuantity: quantityOrNull(details.inboundReceivingQuantity),
    reservedQuantity: reserved ? quantityOrNull(reserved.totalReservedQuantity) : quantityOrNull(reservedRaw),
    reservedCustomerOrders: reserved ? quantityOrNull(reserved.pendingCustomerOrderQuantity) : null,
    reservedFcTransfer: reserved ? quantityOrNull(reserved.pendingTransshipmentQuantity) : null,
    reservedFcProcessing: reserved ? quantityOrNull(reserved.fcProcessingQuantity) : null,
    unfulfillableQuantity: bucketOrNull(details.unfulfillableQuantity, 'totalUnfulfillableQuantity'),
    researchingQuantity: bucketOrNull(details.researchingQuantity, 'totalResearchingQuantity'),
    totalQuantity: quantityOrNull(r.totalQuantity),
    amazonLastUpdatedAt: isoOrNull(r.lastUpdatedTime),
  }
}

/** Sum of known inbound buckets; null only when Amazon sent none of them. */
function inboundTotal(d: Pick<FbaInventoryDetail, 'inboundWorkingQuantity' | 'inboundShippedQuantity' | 'inboundReceivingQuantity'>): number | null {
  const parts = [d.inboundWorkingQuantity, d.inboundShippedQuantity, d.inboundReceivingQuantity].filter((n): n is number => n != null)
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null
}

module.exports = { parseFbaInventorySummary, inboundTotal, quantityOrNull }

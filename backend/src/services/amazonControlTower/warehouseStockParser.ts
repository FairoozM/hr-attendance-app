'use strict'

/**
 * Zoho Inventory item (listed for the Life Smile warehouse) → separate stock figures.
 *
 * on_hand, available_for_sale and committed_stock are kept apart; nothing is combined with
 * max(available_for_sale, on_hand). Warehouse-scoped fields (`warehouse_*` / `location_*`, or the
 * matching entry in `item.warehouses[]` / `item.locations[]`) win; organisation-level fields are
 * only used when no warehouse-scoped value exists, and the row is then tagged
 * stock_scope='organization'. A figure Zoho did not send is null.
 */

type WarehouseStockRow = {
  zohoItemId: string
  itemCode: string | null
  itemName: string | null
  itemStatus: string | null
  onHand: number | null
  availableForSale: number | null
  committedStock: number | null
  stockScope: 'warehouse' | 'organization' | 'unknown'
}

function qtyOrNull(value: unknown): number | null {
  if (value == null || typeof value === 'object' || typeof value === 'boolean') return null
  const text = String(value).replace(/,/g, '').trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null
  const t = String(value).trim()
  return t || null
}

function pick(source: Record<string, unknown> | null, keys: string[]): number | null {
  if (!source) return null
  for (const k of keys) {
    const n = qtyOrNull(source[k])
    if (n != null) return n
  }
  return null
}

function idsMatch(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a).trim() !== '' && String(a).trim() === String(b).trim()
}

function findWarehouseEntry(item: Record<string, any>, warehouseId: string | null): Record<string, unknown> | null {
  if (!warehouseId) return null
  const lists = [item.warehouses, item.locations].filter((l) => Array.isArray(l) && l.length > 0)
  for (const list of lists) {
    const hit = list.find(
      (loc: any) =>
        loc &&
        (idsMatch(loc.warehouse_id, warehouseId) ||
          idsMatch(loc.location_id, warehouseId) ||
          idsMatch(loc.warehouse?.warehouse_id, warehouseId) ||
          idsMatch(loc.location?.location_id, warehouseId))
    )
    if (hit) return hit
  }
  return null
}

const SCOPED_ON_HAND = ['warehouse_stock_on_hand', 'location_stock_on_hand']
const SCOPED_AVAILABLE_FOR_SALE = [
  'warehouse_available_for_sale_stock',
  'location_available_for_sale_stock',
  'warehouse_actual_available_for_sale_stock',
  'location_actual_available_for_sale_stock',
]
const SCOPED_COMMITTED = [
  'warehouse_committed_stock',
  'location_committed_stock',
  'warehouse_actual_committed_stock',
  'location_actual_committed_stock',
]
const ORG_ON_HAND = ['stock_on_hand']
const ORG_AVAILABLE_FOR_SALE = ['available_for_sale_stock', 'actual_available_for_sale_stock']
const ORG_COMMITTED = ['committed_stock', 'actual_committed_stock']

function parseWarehouseStockItem(raw: unknown, warehouseId: string | null): WarehouseStockRow | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, any>
  const zohoItemId = textOrNull(item.item_id ?? item.id)
  if (!zohoItemId) return null

  const entry = findWarehouseEntry(item, warehouseId)
  const scoped = {
    onHand: pick(item, SCOPED_ON_HAND) ?? pick(entry, SCOPED_ON_HAND),
    availableForSale: pick(item, SCOPED_AVAILABLE_FOR_SALE) ?? pick(entry, SCOPED_AVAILABLE_FOR_SALE),
    committedStock: pick(item, SCOPED_COMMITTED) ?? pick(entry, SCOPED_COMMITTED),
  }
  const hasScoped = scoped.onHand != null || scoped.availableForSale != null || scoped.committedStock != null

  let figures = scoped
  let stockScope: WarehouseStockRow['stockScope'] = 'warehouse'
  if (!hasScoped) {
    figures = {
      onHand: pick(item, ORG_ON_HAND),
      availableForSale: pick(item, ORG_AVAILABLE_FOR_SALE),
      committedStock: pick(item, ORG_COMMITTED),
    }
    stockScope = figures.onHand != null || figures.availableForSale != null || figures.committedStock != null ? 'organization' : 'unknown'
  }

  return {
    zohoItemId,
    itemCode: textOrNull(item.sku ?? item.item_code ?? item.code),
    itemName: textOrNull(item.name ?? item.item_name),
    itemStatus: textOrNull(item.status ?? item.item_status),
    onHand: figures.onHand,
    availableForSale: figures.availableForSale,
    committedStock: figures.committedStock,
    stockScope,
  }
}

module.exports = { parseWarehouseStockItem }

export type ZohoDimensionStatus =
  | 'idle'
  | 'loading'
  | 'found'
  | 'missing_dimensions'
  | 'not_found'
  | 'manual'
  | 'error'
  | 'invalid'

export interface KsaShipmentBatch {
  id: string
  name: string
  shipmentDate: string
  freightRatePerCbm: number
  notes: string
  createdAt: string
  updatedAt: string
}

export interface KsaPricingRow {
  id: string
  itemCode: string
  purchasePriceEcommerce: number | ''
  length: number | ''
  width: number | ''
  height: number | ''
  dimensionUnit: 'cm' | 'in'
  cbm: number
  cargoCost: number
  storageCost: number | ''
  ksaShippingCost: number | ''
  commissionPercent: number
  advertisingPercent: number
  vatKsaPercent: number
  profitPercent: number
  commissionAmount: number
  advertisingAmount: number
  vatKsaAmount: number
  profitAmount: number
  totalBaseCost: number
  newPriceSar: number
  shipmentBatchId: string
  shipmentBatchName: string
  freightRatePerCbmSnapshot: number
  effectiveDate: string
  zohoDimensionStatus: ZohoDimensionStatus
  zohoItemId?: string
  zohoItemName?: string
  updatedAt: string
}

export interface KsaPricingStore {
  version: 1
  activeBatchId: string | null
  batches: KsaShipmentBatch[]
  rows: KsaPricingRow[]
  lastSavedAt: string | null
}

export interface KsaPricingHistoryEntry {
  historyId: string
  itemCode: string
  rowId: string
  shipmentBatchId: string
  shipmentBatchName: string
  freightRatePerCbmSnapshot: number
  effectiveDate: string
  purchasePriceEcommerce: number
  storageCost: number
  ksaShippingCost: number
  cbm: number
  cargoCost: number
  totalBaseCost: number
  newPriceSar: number
  recordedAt: string
  reason: string
}

export interface KsaPricingHistoryStore {
  version: 1
  entries: KsaPricingHistoryEntry[]
}

export interface ZohoDimensionLookupResult {
  /** Item code the client asked to resolve (catalogue code). */
  requestedSku: string
  /** Zoho Inventory SKU field (often a barcode). */
  sku: string
  itemId: string
  itemName: string
  length: number | null
  width: number | null
  height: number | null
  dimensionUnit: 'cm' | 'in'
  zohoDimensionStatus: ZohoDimensionStatus
  message: string
}

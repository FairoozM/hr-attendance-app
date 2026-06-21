import { PREF_KSA_PRICING_HISTORY, PREF_KSA_PRICING_STORE } from '../../../constants/userPreferenceKeys'
import {
  KSA_DEFAULT_PERCENTS,
  makeKsaBatchId,
  makeKsaRowId,
  recalcKsaRow,
} from './ksaPricingCalc'
import type {
  KsaPricingHistoryEntry,
  KsaPricingHistoryStore,
  KsaPricingRow,
  KsaPricingStore,
  KsaShipmentBatch,
} from './ksaPricingTypes'

export const KSA_PRICING_STORE_PREF = PREF_KSA_PRICING_STORE
export const KSA_PRICING_HISTORY_PREF = PREF_KSA_PRICING_HISTORY

const MAX_HISTORY = 500

export function emptyKsaPricingStore(): KsaPricingStore {
  return { version: 1, activeBatchId: null, batches: [], rows: [], lastSavedAt: null }
}

export function emptyKsaPricingHistory(): KsaPricingHistoryStore {
  return { version: 1, entries: [] }
}

export function normalizeKsaPricingStore(raw: unknown): KsaPricingStore {
  if (!raw || typeof raw !== 'object') return emptyKsaPricingStore()
  const obj = raw as Partial<KsaPricingStore>
  const batches = Array.isArray(obj.batches)
    ? obj.batches.map(normalizeBatch).filter(Boolean) as KsaShipmentBatch[]
    : []
  const rows = Array.isArray(obj.rows) ? obj.rows.map(normalizeRow).filter(Boolean) as KsaPricingRow[] : []
  const activeBatchId =
    obj.activeBatchId != null && String(obj.activeBatchId).trim() ? String(obj.activeBatchId) : null
  return {
    version: 1,
    activeBatchId: activeBatchId && batches.some((b) => b.id === activeBatchId) ? activeBatchId : batches[0]?.id || null,
    batches,
    rows,
    lastSavedAt: obj.lastSavedAt != null ? String(obj.lastSavedAt) : null,
  }
}

function normalizeBatch(entry: unknown): KsaShipmentBatch | null {
  if (!entry || typeof entry !== 'object') return null
  const b = entry as Partial<KsaShipmentBatch>
  const id = b.id != null ? String(b.id).trim() : ''
  if (!id) return null
  const now = new Date().toISOString()
  return {
    id,
    name: b.name != null ? String(b.name) : 'Shipment batch',
    shipmentDate: b.shipmentDate != null ? String(b.shipmentDate) : '',
    freightRatePerCbm: Number(b.freightRatePerCbm) >= 0 ? Number(b.freightRatePerCbm) : 0,
    notes: b.notes != null ? String(b.notes) : '',
    createdAt: b.createdAt != null ? String(b.createdAt) : now,
    updatedAt: b.updatedAt != null ? String(b.updatedAt) : now,
  }
}

function normalizeZohoDimensionStatus(
  raw: unknown,
  row: Partial<KsaPricingRow>
): KsaPricingRow['zohoDimensionStatus'] {
  const status = raw as KsaPricingRow['zohoDimensionStatus']
  if (status === 'loading') {
    if (row.zohoItemId) return 'found'
    const hasDims =
      Number(row.length) > 0 && Number(row.width) > 0 && Number(row.height) > 0
    return hasDims ? 'manual' : 'idle'
  }
  if (
    status === 'found' ||
    status === 'missing_dimensions' ||
    status === 'not_found' ||
    status === 'manual' ||
    status === 'error' ||
    status === 'idle'
  ) {
    return status
  }
  return 'idle'
}

function normalizeRow(entry: unknown): KsaPricingRow | null {
  if (!entry || typeof entry !== 'object') return null
  const r = entry as Partial<KsaPricingRow>
  const id = r.id != null ? String(r.id).trim() : makeKsaRowId()
  return {
    id,
    itemCode: r.itemCode != null ? String(r.itemCode).trim() : '',
    purchasePriceEcommerce: r.purchasePriceEcommerce === '' ? '' : Number(r.purchasePriceEcommerce) || 0,
    length: r.length === '' ? '' : Number(r.length) || 0,
    width: r.width === '' ? '' : Number(r.width) || 0,
    height: r.height === '' ? '' : Number(r.height) || 0,
    dimensionUnit: r.dimensionUnit === 'in' ? 'in' : 'cm',
    cbm: Number(r.cbm) || 0,
    cargoCost: Number(r.cargoCost) || 0,
    storageCost: r.storageCost === '' ? '' : Number(r.storageCost) || 0,
    ksaShippingCost: r.ksaShippingCost === '' ? '' : Number(r.ksaShippingCost) || 0,
    commissionPercent: Number(r.commissionPercent) || KSA_DEFAULT_PERCENTS.commissionPercent,
    advertisingPercent: Number(r.advertisingPercent) || KSA_DEFAULT_PERCENTS.advertisingPercent,
    vatKsaPercent: Number(r.vatKsaPercent) || KSA_DEFAULT_PERCENTS.vatKsaPercent,
    profitPercent: Number(r.profitPercent) || KSA_DEFAULT_PERCENTS.profitPercent,
    commissionAmount: Number(r.commissionAmount) || 0,
    advertisingAmount: Number(r.advertisingAmount) || 0,
    vatKsaAmount: Number(r.vatKsaAmount) || 0,
    profitAmount: Number(r.profitAmount) || 0,
    totalBaseCost: Number(r.totalBaseCost) || 0,
    newPriceSar: Number(r.newPriceSar) || 0,
    shipmentBatchId: r.shipmentBatchId != null ? String(r.shipmentBatchId) : '',
    shipmentBatchName: r.shipmentBatchName != null ? String(r.shipmentBatchName) : '',
    freightRatePerCbmSnapshot: Number(r.freightRatePerCbmSnapshot) || 0,
    effectiveDate: r.effectiveDate != null ? String(r.effectiveDate) : '',
    zohoDimensionStatus: normalizeZohoDimensionStatus(r.zohoDimensionStatus, r),
    zohoItemId: r.zohoItemId != null ? String(r.zohoItemId) : undefined,
    zohoItemName: r.zohoItemName != null ? String(r.zohoItemName) : undefined,
    updatedAt: r.updatedAt != null ? String(r.updatedAt) : new Date().toISOString(),
  }
}

export function normalizeKsaPricingHistory(raw: unknown): KsaPricingHistoryStore {
  if (!raw || typeof raw !== 'object') return emptyKsaPricingHistory()
  const obj = raw as Partial<KsaPricingHistoryStore>
  const entries = Array.isArray(obj.entries)
    ? obj.entries
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const e = entry as Partial<KsaPricingHistoryEntry>
          if (!e.itemCode) return null
          return {
            historyId: e.historyId || `hist-${Math.random().toString(36).slice(2, 9)}`,
            itemCode: String(e.itemCode),
            rowId: String(e.rowId || ''),
            shipmentBatchId: String(e.shipmentBatchId || ''),
            shipmentBatchName: String(e.shipmentBatchName || ''),
            freightRatePerCbmSnapshot: Number(e.freightRatePerCbmSnapshot) || 0,
            effectiveDate: String(e.effectiveDate || ''),
            purchasePriceEcommerce: Number(e.purchasePriceEcommerce) || 0,
            storageCost: Number(e.storageCost) || 0,
            ksaShippingCost: Number(e.ksaShippingCost) || 0,
            cbm: Number(e.cbm) || 0,
            cargoCost: Number(e.cargoCost) || 0,
            totalBaseCost: Number(e.totalBaseCost) || 0,
            newPriceSar: Number(e.newPriceSar) || 0,
            recordedAt: String(e.recordedAt || new Date().toISOString()),
            reason: String(e.reason || ''),
          } satisfies KsaPricingHistoryEntry
        })
        .filter(Boolean) as KsaPricingHistoryEntry[]
    : []
  return { version: 1, entries: entries.slice(0, MAX_HISTORY) }
}

export function createShipmentBatch(partial: Partial<KsaShipmentBatch> = {}): KsaShipmentBatch {
  const now = new Date().toISOString()
  return {
    id: partial.id || makeKsaBatchId(),
    name: partial.name?.trim() || `Shipment ${new Date().toLocaleDateString()}`,
    shipmentDate: partial.shipmentDate || new Date().toISOString().slice(0, 10),
    freightRatePerCbm: Number(partial.freightRatePerCbm) >= 0 ? Number(partial.freightRatePerCbm) : 0,
    notes: partial.notes || '',
    createdAt: partial.createdAt || now,
    updatedAt: now,
  }
}

export function createEmptyKsaRow(batch: KsaShipmentBatch | null): KsaPricingRow {
  const base: KsaPricingRow = {
    id: makeKsaRowId(),
    itemCode: '',
    purchasePriceEcommerce: '',
    length: '',
    width: '',
    height: '',
    dimensionUnit: 'cm',
    cbm: 0,
    cargoCost: 0,
    storageCost: '',
    ksaShippingCost: '',
    commissionPercent: KSA_DEFAULT_PERCENTS.commissionPercent,
    advertisingPercent: KSA_DEFAULT_PERCENTS.advertisingPercent,
    vatKsaPercent: KSA_DEFAULT_PERCENTS.vatKsaPercent,
    profitPercent: KSA_DEFAULT_PERCENTS.profitPercent,
    commissionAmount: 0,
    advertisingAmount: 0,
    vatKsaAmount: 0,
    profitAmount: 0,
    totalBaseCost: 0,
    newPriceSar: 0,
    shipmentBatchId: batch?.id || '',
    shipmentBatchName: batch?.name || '',
    freightRatePerCbmSnapshot: batch?.freightRatePerCbm || 0,
    effectiveDate: batch?.shipmentDate || '',
    zohoDimensionStatus: 'idle',
    updatedAt: new Date().toISOString(),
  }
  return batch ? recalcKsaRow(base, batch) : base
}

export function recalcAllRows(store: KsaPricingStore): KsaPricingStore {
  const batchById = new Map(store.batches.map((b) => [b.id, b]))
  const active = store.activeBatchId ? batchById.get(store.activeBatchId) || null : null
  return {
    ...store,
    rows: store.rows.map((row) => {
      const batch = batchById.get(row.shipmentBatchId) || active
      return recalcKsaRow(row, batch || null)
    }),
  }
}

export function appendKsaPricingHistory(
  history: KsaPricingHistoryStore,
  row: KsaPricingRow,
  reason: string
): KsaPricingHistoryStore {
  if (!row.itemCode?.trim() || !row.newPriceSar) return history
  const entry: KsaPricingHistoryEntry = {
    historyId: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemCode: row.itemCode,
    rowId: row.id,
    shipmentBatchId: row.shipmentBatchId,
    shipmentBatchName: row.shipmentBatchName,
    freightRatePerCbmSnapshot: row.freightRatePerCbmSnapshot,
    effectiveDate: row.effectiveDate,
    purchasePriceEcommerce: Number(row.purchasePriceEcommerce) || 0,
    storageCost: Number(row.storageCost) || 0,
    ksaShippingCost: Number(row.ksaShippingCost) || 0,
    cbm: row.cbm,
    cargoCost: row.cargoCost,
    totalBaseCost: row.totalBaseCost,
    newPriceSar: row.newPriceSar,
    recordedAt: new Date().toISOString(),
    reason,
  }
  return { version: 1, entries: [entry, ...history.entries].slice(0, MAX_HISTORY) }
}

export function parseKsaPasteLines(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.split('\t')[0]?.trim() || line.trim())
    .filter(Boolean)
}

import type { KsaPricingRow, KsaShipmentBatch } from './ksaPricingTypes'

export const KSA_DEFAULT_PERCENTS = {
  commissionPercent: 15,
  advertisingPercent: 15,
  vatKsaPercent: 15,
  profitPercent: 15,
} as const

export function makeKsaRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ksa-row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function makeKsaBatchId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ksa-batch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function toPositiveNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function toOptionalNumber(value: unknown): number | '' {
  if (value === '' || value == null) return ''
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : ''
}

/** Cubic meters from package dimensions (Zoho defaults to cm). */
export function computeCbm(
  length: number | '' | null | undefined,
  width: number | '' | null | undefined,
  height: number | '' | null | undefined,
  dimensionUnit: 'cm' | 'in' = 'cm'
): number {
  const l = toPositiveNumber(length)
  const w = toPositiveNumber(width)
  const h = toPositiveNumber(height)
  if (!l || !w || !h) return 0
  const product = l * w * h
  if (dimensionUnit === 'in') {
    return product * 0.000016387064
  }
  return product / 1_000_000
}

export function computeKsaRowPricing(
  row: Pick<
    KsaPricingRow,
    | 'purchasePriceEcommerce'
    | 'length'
    | 'width'
    | 'height'
    | 'dimensionUnit'
    | 'cbm'
    | 'storageCost'
    | 'ksaShippingCost'
    | 'commissionPercent'
    | 'advertisingPercent'
    | 'vatKsaPercent'
    | 'profitPercent'
  >,
  batch: Pick<KsaShipmentBatch, 'freightRatePerCbm'> | null | undefined
): Pick<
  KsaPricingRow,
  'cbm' | 'cargoCost' | 'totalBaseCost' | 'newPriceSar' | 'newPriceAfterVat' | 'freightRatePerCbmSnapshot'
> {
  const freightRatePerCbm = toPositiveNumber(batch?.freightRatePerCbm)
  const dimensionUnit = row.dimensionUnit === 'in' ? 'in' : 'cm'
  const cbm =
    toPositiveNumber(row.cbm) > 0
      ? toPositiveNumber(row.cbm)
      : computeCbm(row.length, row.width, row.height, dimensionUnit)
  const cargoCost = cbm * freightRatePerCbm
  const purchasePriceEcommerce = toPositiveNumber(row.purchasePriceEcommerce)
  const storageCost = toPositiveNumber(row.storageCost)
  const ksaShippingCost = toPositiveNumber(row.ksaShippingCost)
  const totalBaseCost = purchasePriceEcommerce + cargoCost + storageCost + ksaShippingCost

  const commission = toPositiveNumber(row.commissionPercent ?? KSA_DEFAULT_PERCENTS.commissionPercent) / 100
  const advertising = toPositiveNumber(row.advertisingPercent ?? KSA_DEFAULT_PERCENTS.advertisingPercent) / 100
  const vat = toPositiveNumber(row.vatKsaPercent ?? KSA_DEFAULT_PERCENTS.vatKsaPercent) / 100
  const profit = toPositiveNumber(row.profitPercent ?? KSA_DEFAULT_PERCENTS.profitPercent) / 100
  const divisor = 1 - commission - advertising - vat - profit

  let newPriceSar = 0
  if (divisor > 0 && divisor < 1 && totalBaseCost > 0) {
    newPriceSar = totalBaseCost / divisor
  }

  const vatAmount = newPriceSar * vat
  const newPriceAfterVat = Math.max(0, newPriceSar - vatAmount)

  return {
    cbm,
    cargoCost,
    totalBaseCost,
    newPriceSar,
    newPriceAfterVat,
    freightRatePerCbmSnapshot: freightRatePerCbm,
  }
}

export function recalcKsaRow(row: KsaPricingRow, batch: KsaShipmentBatch | null): KsaPricingRow {
  const computed = computeKsaRowPricing(row, batch)
  return {
    ...row,
    ...computed,
    shipmentBatchId: batch?.id || row.shipmentBatchId,
    shipmentBatchName: batch?.name || row.shipmentBatchName,
    effectiveDate: batch?.shipmentDate || row.effectiveDate,
  }
}

export function fmtSar(value: number | '' | null | undefined, digits = 2): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return n.toFixed(digits)
}

import { describe, expect, it } from 'vitest'
import {
  applyImportReview,
  applySafeDuplicateCleanup,
  buildHistoricalSnapshot,
  buildImportReview,
  DUPLICATE_CLASSIFICATION,
  IMPORT_STATUS,
  scanDuplicatePrices,
} from './allPricesVersioning'

const rates = { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }

describe('allPricesVersioning', () => {
  it('classifies dated duplicate groups and keeps the newest active price', () => {
    const scan = scanDuplicatePrices([
      { id: 'old', itemNo: ' brkh-64-1 ', purchasePrice: '10', shipping: '2', dateOfPrices: '2026-01-01' },
      { id: 'new', itemNo: 'BRKH-64-1', purchasePrice: '12', shipping: '2', dateOfPrices: '2026-02-01' },
    ], rates)

    expect(scan.summary.duplicateItemCount).toBe(1)
    expect(scan.groups[0].classification).toBe(DUPLICATE_CLASSIFICATION.SAFE_AUTO_LATEST_DATE)
    expect(scan.groups[0].keepRowId).toBe('new')
  })

  it('moves safe duplicates to historical snapshots without deleting data', () => {
    const result = applySafeDuplicateCleanup([
      { id: 'old', itemNo: 'SKU-1', purchasePrice: '10', shipping: '2', dateOfPrices: '2026-01-01' },
      { id: 'new', itemNo: 'sku-1', purchasePrice: '12', shipping: '2', dateOfPrices: '2026-02-01' },
    ], rates, { movedBy: 'Admin' })

    expect(result.activeRows).toHaveLength(1)
    expect(result.activeRows[0].id).toBe('new')
    expect(result.historyRows).toHaveLength(1)
    expect(result.historyRows[0].reason).toBe('Duplicate cleanup - older price date')
    expect(result.historyRows[0].movedBy).toBe('Admin')
  })

  it('builds full historical snapshots with computed pricing fields', () => {
    const snapshot = buildHistoricalSnapshot(
      { id: 'row-1', itemNo: 'SKU-1', purchasePrice: '10', shipping: '2', dateOfPrices: '2026-01-01' },
      rates,
      { reason: 'New production price', source: 'import_replacement' },
    )

    expect(snapshot.originalActivePriceId).toBe('row-1')
    expect(snapshot.normalizedItemNo).toBe('SKU-1')
    expect(snapshot.salesPriceAed).toBeGreaterThan(0)
    expect(snapshot.totalCost).toBeGreaterThan(0)
    expect(snapshot.reason).toBe('New production price')
  })

  it('classifies import rows and replaces newer changed prices via history', () => {
    const active = [
      { id: 'active-1', itemNo: 'SKU-1', purchasePrice: '10', shipping: '2', dateOfPrices: '2026-01-01' },
    ]
    const review = buildImportReview([
      { id: 'incoming-1', itemNo: 'sku-1', purchasePrice: '12', shipping: '2', dateOfPrices: '2026-02-01' },
      { id: 'incoming-2', itemNo: 'SKU-2', purchasePrice: '8', shipping: '1', dateOfPrices: '2026-02-01' },
    ], active, rates)

    expect(review.items[0].status).toBe(IMPORT_STATUS.CHANGED_NEWER_DATE)
    expect(review.items[1].status).toBe(IMPORT_STATUS.NEW_ITEM)

    const result = applyImportReview(active, review, rates)
    expect(result.activeRows).toHaveLength(2)
    expect(result.activeRows.find((row) => row.itemNo === 'sku-1')?.purchasePrice).toBe('12')
    expect(result.historyRows).toHaveLength(1)
    expect(result.historyRows[0].source).toBe('import_replacement')
  })

  it('marks same-date changed imports as conflicts', () => {
    const review = buildImportReview([
      { id: 'incoming-1', itemNo: 'SKU-1', purchasePrice: '12', shipping: '2', dateOfPrices: '2026-02-01' },
    ], [
      { id: 'active-1', itemNo: 'SKU-1', purchasePrice: '10', shipping: '2', dateOfPrices: '2026-02-01' },
    ], rates)

    expect(review.items[0].status).toBe(IMPORT_STATUS.CHANGED_SAME_DATE)
    expect(review.summary.conflictCount).toBe(1)
  })
})

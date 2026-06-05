/**
 * QA scenarios A–E: fingerprints, dirty detection, row-count thresholds.
 */
import { describe, expect, it } from 'vitest'
import {
  computeDraftFingerprint,
  deriveActiveListSaveStatus,
  fingerprintsEqual,
  formatRatesSummary,
  hasUnsavedChangesToActiveList,
  isSignificantRowCountChange,
  normalizeRowsForFingerprint,
} from './allPricesDraftSafety'

const DEFAULT_RATES = { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }

describe('allPricesDraftSafety', () => {
  it('fingerprint is stable for same content regardless of row order', () => {
    const rowsA = [
      { itemNo: 'B', purchasePrice: '2', shipping: '1', id: 'x1' },
      { itemNo: 'A', purchasePrice: '1', shipping: '0', id: 'x2' },
    ]
    const rowsB = [
      { itemNo: 'A', purchasePrice: '1', shipping: '0', id: 'y2' },
      { itemNo: 'B', purchasePrice: '2', shipping: '1', id: 'y1' },
    ]
    const fpA = computeDraftFingerprint({ activeSavedListId: 'list-1', rates: DEFAULT_RATES, rows: rowsA })
    const fpB = computeDraftFingerprint({ activeSavedListId: 'list-1', rates: DEFAULT_RATES, rows: rowsB })
    expect(fpA).toBe(fpB)
  })

  it('fingerprint changes when active list id or editable fields change', () => {
    const rows = [{ itemNo: 'A', purchasePrice: '1', shipping: '1' }]
    const base = computeDraftFingerprint({ activeSavedListId: 'a', rates: DEFAULT_RATES, rows })
    const otherList = computeDraftFingerprint({ activeSavedListId: 'b', rates: DEFAULT_RATES, rows })
    const edited = computeDraftFingerprint({
      activeSavedListId: 'a',
      rates: DEFAULT_RATES,
      rows: [{ itemNo: 'A', purchasePrice: '2', shipping: '1' }],
    })
    expect(base).not.toBe(otherList)
    expect(base).not.toBe(edited)
  })

  it('hasUnsavedChangesToActiveList detects dirty active list', () => {
    const loaded = computeDraftFingerprint({ activeSavedListId: 'x', rates: DEFAULT_RATES, rows: [] })
    const current = computeDraftFingerprint({
      activeSavedListId: 'x',
      rates: DEFAULT_RATES,
      rows: [{ itemNo: 'N', purchasePrice: '1', shipping: '1' }],
    })
    expect(
      hasUnsavedChangesToActiveList({
        activeSavedListId: 'x',
        loadedFingerprint: loaded,
        currentFingerprint: current,
      }),
    ).toBe(true)
    expect(
      hasUnsavedChangesToActiveList({
        activeSavedListId: null,
        loadedFingerprint: loaded,
        currentFingerprint: current,
      }),
    ).toBe(false)
  })

  it('deriveActiveListSaveStatus returns saved | unsaved | conflict', () => {
    const fp = computeDraftFingerprint({ activeSavedListId: 'x', rates: DEFAULT_RATES, rows: [] })
    expect(
      deriveActiveListSaveStatus({
        activeSavedListId: 'x',
        loadedFingerprint: fp,
        currentFingerprint: fp,
      }),
    ).toBe('saved')
    expect(
      deriveActiveListSaveStatus({
        activeSavedListId: 'x',
        loadedFingerprint: fp,
        currentFingerprint: 'other',
        revisionConflict: true,
      }),
    ).toBe('conflict')
  })

  it('isSignificantRowCountChange follows threshold rules', () => {
    expect(isSignificantRowCountChange(40, 200)).toBe(false)
    expect(isSignificantRowCountChange(50, 60)).toBe(false)
    expect(isSignificantRowCountChange(50, 149)).toBe(true)
    expect(isSignificantRowCountChange(50, 150)).toBe(true)
    expect(isSignificantRowCountChange(200, 250)).toBe(true)
    expect(isSignificantRowCountChange(200, 249)).toBe(false)
  })

  it('formatRatesSummary and normalizeRows strip non-editable fields', () => {
    expect(formatRatesSummary(DEFAULT_RATES)).toContain('VAT 5%')
    expect(formatRatesSummary(DEFAULT_RATES)).not.toContain('Profit')
    const norm = normalizeRowsForFingerprint([
      { itemNo: 'A', purchasePrice: '1', shipping: '2', id: 'ignore-me', extra: 99 },
    ])
    expect(norm[0]).not.toHaveProperty('id')
    expect(norm[0]).not.toHaveProperty('extra')
  })

  it('fingerprintsEqual compares strings', () => {
    expect(fingerprintsEqual('abc', 'abc')).toBe(true)
    expect(fingerprintsEqual('abc', 'def')).toBe(false)
  })
})

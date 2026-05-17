/**
 * QA scenarios F–G: recovery snapshot cap and undo data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RECOVERY_SNAPSHOT_MAX,
  persistRecoverySnapshots,
  pushRecoverySnapshot,
  readRecoverySnapshots,
  removeRecoverySnapshot,
} from './allPricesRecoverySnapshots'

const prefs = {}

vi.mock('../../lib/userPreferencesBridge', () => ({
  getUserPrefKey: vi.fn((key, fallback) => (Object.prototype.hasOwnProperty.call(prefs, key) ? prefs[key] : fallback)),
  requestUserPrefSave: vi.fn((key, value) => {
    prefs[key] = value
  }),
}))

const DEFAULT_RATES = { vatPct: 5, commissionPct: 15, advertisingPct: 15, requiredProfitPct: 25 }

describe('allPricesRecoverySnapshots', () => {
  beforeEach(() => {
    Object.keys(prefs).forEach((k) => delete prefs[k])
    vi.clearAllMocks()
  })

  it('pushRecoverySnapshot prepends and caps at 20', () => {
    for (let i = 0; i < 22; i += 1) {
      pushRecoverySnapshot({
        reason: 'before-reset-rates',
        rates: DEFAULT_RATES,
        rows: [{ itemNo: `R${i}`, purchasePrice: '1', shipping: '1' }],
        existing: readRecoverySnapshots(),
      })
    }
    const list = readRecoverySnapshots()
    expect(list).toHaveLength(RECOVERY_SNAPSHOT_MAX)
    expect(list[0].rows[0].itemNo).toBe('R21')
  })

  it('removeRecoverySnapshot removes by id', () => {
    const list = pushRecoverySnapshot({
      reason: 'before-delete-saved-list',
      rates: DEFAULT_RATES,
      rows: [],
    })
    const id = list[0].id
    removeRecoverySnapshot(id)
    expect(readRecoverySnapshots()).toHaveLength(0)
  })

  it('persistRecoverySnapshots normalizes invalid entries', () => {
    persistRecoverySnapshots([{ id: 'bad', reason: 'not-valid' }])
    expect(readRecoverySnapshots()).toHaveLength(0)
  })
})

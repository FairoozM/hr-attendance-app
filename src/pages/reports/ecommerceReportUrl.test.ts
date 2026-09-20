import { describe, expect, it } from 'vitest'
import {
  addDaysYmd,
  isValidReportYmd,
  locationToReturnPath,
  mergeEcommerceReportSearchParams,
  parseEcommerceReportSearchParams,
  todayUaeYmd,
} from './ecommerceReportUrl'

describe('ecommerceReportUrl', () => {
  it('accepts valid calendar YYYY-MM-DD and rejects impossible dates', () => {
    expect(isValidReportYmd('2026-09-18')).toBe(true)
    expect(isValidReportYmd('2026-02-31')).toBe(false)
    expect(isValidReportYmd('09/18/2026')).toBe(false)
    expect(isValidReportYmd('')).toBe(false)
  })

  it('reads date and view from search params without timezone shift', () => {
    const params = new URLSearchParams('date=2026-09-18&view=day&debug=1')
    expect(parseEcommerceReportSearchParams(params, '2026-09-21')).toEqual({
      date: '2026-09-18',
      view: 'day',
    })
  })

  it('falls back to today when date is missing or invalid', () => {
    expect(parseEcommerceReportSearchParams(new URLSearchParams(), '2026-09-21').date).toBe(
      '2026-09-21'
    )
    expect(
      parseEcommerceReportSearchParams(new URLSearchParams('date=nope'), '2026-09-21').date
    ).toBe('2026-09-21')
  })

  it('preserves unrelated query keys when updating date', () => {
    const prev = new URLSearchParams('debug=1&foo=bar')
    const next = mergeEcommerceReportSearchParams(prev, { date: '2026-09-18', view: 'month' })
    expect(next.get('date')).toBe('2026-09-18')
    expect(next.get('view')).toBe('month')
    expect(next.get('debug')).toBe('1')
    expect(next.get('foo')).toBe('bar')
  })

  it('addDaysYmd stays on calendar dates (UAE noon anchor)', () => {
    expect(addDaysYmd('2026-09-18', -1)).toBe('2026-09-17')
    expect(addDaysYmd('2026-09-18', 1)).toBe('2026-09-19')
  })

  it('todayUaeYmd matches Asia/Dubai en-CA', () => {
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    expect(todayUaeYmd()).toBe(expected)
  })

  it('locationToReturnPath keeps search for login return', () => {
    expect(
      locationToReturnPath({
        pathname: '/reports/ecommerce-report',
        search: '?date=2026-09-18&view=day',
      })
    ).toBe('/reports/ecommerce-report?date=2026-09-18&view=day')
    expect(locationToReturnPath(null)).toBe('/')
  })
})

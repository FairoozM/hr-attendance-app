/**
 * Ecommerce Report page — URL date + no auto-build on open.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const post = vi.fn()

vi.mock('../../api/client', () => ({
  api: { get, post },
}))

const { EcommerceReportPage } = await import('./EcommerceReportPage')

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: '/reports/ecommerce-report', element: <EcommerceReportPage /> }],
    { initialEntries: [path] }
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  get.mockResolvedValue({ status: 'missing', date: '2026-09-18', report: null })
})

afterEach(() => {
  cleanup()
})

describe('EcommerceReportPage URL + load gating', () => {
  it('restores date from URL and does not POST a build on open', async () => {
    renderAt('/reports/ecommerce-report?date=2026-09-18')
    await waitFor(() => {
      expect(screen.getByDisplayValue('2026-09-18')).toBeTruthy()
    })
    await waitFor(() => {
      expect(get).toHaveBeenCalled()
    })
    expect(post).not.toHaveBeenCalled()
    const cacheCalls = get.mock.calls.filter(([path]) => String(path).includes('/ecommerce/cached'))
    expect(cacheCalls.length).toBeGreaterThan(0)
    expect(String(cacheCalls[0][0])).toContain('date=2026-09-18')
    expect(screen.getByText(/No report loaded for this date/i)).toBeTruthy()
  })

  it('does not fetch today before the URL date', async () => {
    renderAt('/reports/ecommerce-report?date=2026-09-18')
    await waitFor(() => expect(get).toHaveBeenCalled())
    const paths = get.mock.calls.map(([p]) => String(p))
    expect(paths.some((p) => p.includes('2026-09-18'))).toBe(true)
    expect(paths.every((p) => !p.includes('date=2026-09-21'))).toBe(true)
    expect(post).not.toHaveBeenCalled()
  })

  it('Load Report is the only path that starts a build', async () => {
    post.mockResolvedValue({
      jobId: 'j1',
      date: '2026-09-18',
      status: 'completed',
      report: {
        reportDate: '2026-09-18',
        dayName: 'Friday',
        totalDays: 261,
        day: { cashSales: 0, creditSales: 1, saleReturn: 0, totalSales: 1 },
        month: {},
        year: {},
        expenses: {},
        returns: {},
        ratios: { day: 0, month: 0, year: 0 },
      },
    })
    renderAt('/reports/ecommerce-report?date=2026-09-18')
    await waitFor(() => expect(screen.getByText(/No report loaded/i)).toBeTruthy())
    expect(post).not.toHaveBeenCalled()
    const loadButtons = screen.getAllByRole('button', { name: /^Load Report$/i })
    await act(async () => {
      fireEvent.click(loadButtons[0])
    })
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(String(post.mock.calls[0][0])).toContain('/ecommerce/build')
    expect(post.mock.calls[0][1]).toEqual({ date: '2026-09-18' })
  })

  it('ignores a stale completed build for a previous date', async () => {
    let resolveSep18: (v: unknown) => void = () => {}
    const sep18Promise = new Promise((r) => {
      resolveSep18 = r
    })
    get.mockImplementation(async (path: string) => {
      if (String(path).includes('date=2026-09-18')) return sep18Promise
      return { status: 'missing', date: '2026-09-19', report: null }
    })
    renderAt('/reports/ecommerce-report?date=2026-09-18')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Next Day/i }))
    })
    await waitFor(() => {
      expect(screen.getByDisplayValue('2026-09-19')).toBeTruthy()
    })
    await act(async () => {
      resolveSep18({
        status: 'ready',
        date: '2026-09-18',
        report: {
          reportDate: '2026-09-18',
          dayName: 'Friday',
          totalDays: 261,
          day: { cashSales: 0, creditSales: 999, saleReturn: 0, totalSales: 999 },
          month: {},
          year: {},
          expenses: {},
          returns: {},
          ratios: { day: null, month: null, year: null },
        },
      })
      await Promise.resolve()
    })
    expect(screen.getByDisplayValue('2026-09-19')).toBeTruthy()
    expect(screen.queryByText('999.00')).toBeNull()
    expect(screen.getByText(/No report loaded for this date/i)).toBeTruthy()
  })
})

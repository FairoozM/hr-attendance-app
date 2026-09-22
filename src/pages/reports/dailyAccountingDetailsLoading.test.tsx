/**
 * Daily Accounting Details only talks to Zoho when a date is actually requested.
 *
 * A build costs dozens of Zoho calls against a rate-limited account, so opening
 * the page must stay idle, and the requested date must live in the URL so a
 * refresh or a shared link rebuilds exactly that day.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TODAY_UAE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const post = vi.fn()
const get = vi.fn()

vi.mock('../../api/client', () => ({
  api: { get, post },
  fetchBinary: vi.fn(),
  downloadBlob: vi.fn(),
}))

const { DailyEcommerceLedgerPage } = await import('./DailyEcommerceLedgerPage')

function emptySection(title: string) {
  return { title, opening: 0, closing: 0, netMovement: 0, rows: [] }
}

function ledgerReport(date: string) {
  return {
    reportDate: date,
    dayName: 'Wednesday',
    generatedAt: '2026-09-16T12:00:00Z',
    sections: {
      sales: { ...emptySection('Sales'), columns: ['reference', 'description', 'sale', 'balance'] },
      cashInHand: emptySection('Cash In Hand'),
      expenses: emptySection('Expenses'),
      purchasePayments: { ...emptySection('Purchase & Payments'), configMissing: true },
      basmatPayable: emptySection('BASMAT CASH FOR ECOMMERCE'),
      banks: [],
      creditCards: [],
    },
  }
}

/** MemoryRouter keeps its URL in memory, so surface it for the deep-link assertions. */
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>
}

function renderPage(initialUrl = '/reports/daily-accounting-details') {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <DailyEcommerceLedgerPage />
      <LocationProbe />
    </MemoryRouter>
  )
}

beforeEach(() => {
  post.mockReset()
  get.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('Daily Accounting Details loading', () => {
  it('stays idle on a bare visit instead of building a report', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText(/Nothing is fetched from Zoho/)).toBeTruthy())
    expect(post).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('builds only after Load Report is pressed, and records the date in the URL', async () => {
    post.mockResolvedValue({ jobId: 'job-1', date: '2026-09-16', status: 'queued' })
    get.mockResolvedValue({
      jobId: 'job-1',
      date: '2026-09-16',
      status: 'completed',
      report: ledgerReport('2026-09-16'),
    })

    renderPage()
    const input = screen.getByDisplayValue(TODAY_UAE) as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-09-16' } })
    expect(post).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load Report' }))
    })

    expect(post).toHaveBeenCalledWith('/api/reports/daily-ecommerce-ledger/build', {
      date: '2026-09-16',
    })
    await waitFor(() => expect(screen.getByText(/16 September 2026 \(Wednesday\)/)).toBeTruthy(), {
      timeout: 15_000,
    })
    expect(screen.getByTestId('url').textContent).toBe(
      '/reports/daily-accounting-details?date=2026-09-16'
    )
  }, 20_000)

  it('rebuilds the deep-linked date on load so a refresh keeps the same day', async () => {
    post.mockResolvedValue({ jobId: 'job-2', date: '2026-09-16', status: 'queued' })
    get.mockResolvedValue({
      jobId: 'job-2',
      date: '2026-09-16',
      status: 'completed',
      report: ledgerReport('2026-09-16'),
    })

    renderPage('/reports/daily-accounting-details?date=2026-09-16')

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/reports/daily-ecommerce-ledger/build', {
        date: '2026-09-16',
      })
    )
    expect(screen.getByDisplayValue('2026-09-16')).toBeTruthy()
  })

  it('ignores a malformed or future date in the URL', async () => {
    renderPage('/reports/daily-accounting-details?date=2099-01-01')
    await waitFor(() => expect(screen.getByText(/Nothing is fetched from Zoho/)).toBeTruthy())

    cleanup()
    renderPage('/reports/daily-accounting-details?date=not-a-date')
    await waitFor(() => expect(screen.getByText(/Nothing is fetched from Zoho/)).toBeTruthy())

    expect(post).not.toHaveBeenCalled()
  })
})

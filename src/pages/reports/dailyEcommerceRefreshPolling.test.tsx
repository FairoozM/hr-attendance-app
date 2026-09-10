/**
 * Refresh on the Daily Ecommerce Report page.
 *
 * A full refresh takes minutes on the server, so the page must start a job and poll it rather than
 * hold one long request open — a single request would be cut off by the CloudFront origin timeout
 * long before the marketplaces answered. These tests pin that behaviour.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The page opens on today in Dubai, so the expected request date is derived, never hardcoded. */
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

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', permissions: {} } }),
  hasPermission: () => true,
}))

const { DailyEcommerceReportPage } = await import('./DailyEcommerceReportPage')

function report(overrides: Record<string, unknown> = {}) {
  return {
    date: TODAY_UAE,
    timezone: 'Asia/Dubai',
    exchangeRate: { rate: 0.9787, rateDisplay: '0.9787', source: 'fixed' },
    channels: [],
    totals: {
      quantity: 0,
      adSpendAED: null,
      clicks: null,
      commissionAED: 0,
      shippingAED: 0,
      costPercentage: 0,
      salesAmountAED: 0,
      balanceAED: 0,
    },
    incomplete: false,
    warnings: [],
    generatedAt: '2026-09-09T12:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DailyEcommerceReportPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  post.mockReset()
  get.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('Daily Ecommerce refresh', () => {
  it('polls the job instead of waiting on one long request, then shows the refreshed report', async () => {
    let pollCount = 0
    get.mockImplementation(async (path: string) => {
      if (path.includes('/refresh/')) {
        pollCount += 1
        if (pollCount < 3) {
          return {
            jobId: 'job-1',
            date: TODAY_UAE,
            status: 'running',
            progress: { step: 'Pulling Amazon, Noon and Life Smile…', totalSteps: 5, completedSteps: pollCount },
          }
        }
        return {
          jobId: 'job-1',
          date: TODAY_UAE,
          status: 'completed',
          progress: { step: 'Refresh complete', totalSteps: 5, completedSteps: 5 },
          sync: { amazon_uae: { status: 'ok' } },
          report: report({ totals: { ...report().totals, salesAmountAED: 5990 } }),
        }
      }
      return report()
    })
    post.mockResolvedValue({ jobId: 'job-1', date: TODAY_UAE, status: 'queued' })

    renderPage()
    await waitFor(() => expect(get).toHaveBeenCalled())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })

    // The POST only starts the work; the result has to arrive through the status route.
    expect(post).toHaveBeenCalledWith('/api/reports/daily-ecommerce/refresh', { date: TODAY_UAE })
    await waitFor(() => expect(pollCount).toBeGreaterThan(1), { timeout: 15_000 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled(), {
      timeout: 15_000,
    })
    expect(pollCount).toBeGreaterThanOrEqual(3)
    const statusCalls = get.mock.calls.filter((c) => String(c[0]).includes('/refresh/'))
    expect(statusCalls[0][0]).toBe('/api/reports/daily-ecommerce/refresh/job-1')
    // Each poll must stay well inside the proxy timeout that broke the old single request.
    expect(statusCalls[0][1]).toMatchObject({ timeoutMs: 15_000 })
  }, 30_000)

  it('releases the Refresh button and reports the reason when the job fails', async () => {
    post.mockResolvedValue({ jobId: 'job-2', date: TODAY_UAE, status: 'queued' })
    get.mockImplementation(async (path: string) => {
      if (path.includes('/refresh/')) {
        return {
          jobId: 'job-2',
          status: 'failed',
          error: 'exchange rate source unavailable',
          sync: { noon: { status: 'error', message: 'noon export timed out' } },
        }
      }
      return report()
    })

    renderPage()
    await waitFor(() => expect(get).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })

    await waitFor(
      () => expect(screen.getByRole('alert')).toHaveTextContent(/exchange rate source unavailable/),
      { timeout: 15_000 },
    )
    // A failing integration is named rather than silently folded into a zero.
    expect(screen.getByRole('status')).toHaveTextContent(/noon: error — noon export timed out/)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  }, 30_000)

  it('releases the Refresh button when starting the job fails outright', async () => {
    get.mockResolvedValue(report())
    post.mockRejectedValue(new Error('Unauthorized'))

    renderPage()
    await waitFor(() => expect(get).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Unauthorized/))
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  }, 20_000)
})

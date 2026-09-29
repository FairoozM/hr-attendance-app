import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TabbyBatch, TabbyPostJob, TabbyPreview } from '../../../api/tabbyClearing'

const api = vi.hoisted(() => ({
  listTabbyBatches: vi.fn(),
  uploadTabbyStatement: vi.fn(),
  getTabbyPreview: vi.fn(),
  postTabbyBatch: vi.fn(),
  getTabbyPostJob: vi.fn(),
  getTabbyActivity: vi.fn(),
  chooseTabbyBankMatch: vi.fn(),
  getTabbyAccounts: vi.fn(),
  saveTabbyAccount: vi.fn(),
  clearTabbyAccount: vi.fn(),
}))
vi.mock('../../../api/tabbyClearing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/tabbyClearing')>()),
  ...api,
}))

import { TabbyClearingPage } from './TabbyClearingPage'

const STATEMENT = 'Tabby20260928AED'

function preview(overrides: Partial<TabbyPreview> = {}): TabbyPreview {
  return {
    batchId: '7',
    statementNumber: STATEMENT,
    date: '2026-09-29',
    status: 'READY',
    postingEnabled: true,
    canPost: true,
    fingerprint: 'fp-1',
    blockers: [],
    warnings: [],
    accounts: { resolved: {}, problems: [], mappings: [] },
    bank: {
      status: 'BANK_MATCHED',
      amount: 3077.85,
      matched: {
        transactionId: '4265011000042534510',
        date: '2026-09-28',
        amount: 3077.85,
        transactionType: 'transfer_fund',
        referenceNumber: '',
        offsetAccountName: 'RAK BANK MAIN 5061',
        status: 'manually_added',
      },
      candidates: [],
      reason: 'Existing Zoho transfer on 2026-09-28 (3,077.85).',
      linkedTransactionId: null,
    },
    sections: {
      settlement: {
        statementNumber: STATEMENT,
        statementDate: '2026-09-28',
        transferDate: '2026-09-28',
        companyName: null,
        currency: 'AED',
        fileName: `${STATEMENT}.xlsx`,
        fileHash: '177ad351',
        rows: { sales: 6, refunds: 0, payoutFees: 1 },
      },
      sales: { count: 6, gross: 3316.84, net: 3084.15, charges: 232.69 },
      commission: { refundable: 149.26, nonRefundable: 66.34, expense: 215.6, refundReversal: 0, net: 215.6 },
      fees: { transactionFixed: 6, rounding: 0, transactionTotalFee: 221.6, payoutFee: 6, refundReversal: 0, feesExpense: 12 },
      vat: { transaction: 11.09, payout: 0.3, refundReversal: 0, inputVat: 11.39 },
      clearing: { account: 'Tabby Un-cleared Commission', in: 232.69, out: 232.69, afterSales: 232.69, final: 0, totalDeduction: 232.69 },
      undeposited: {
        account: 'Tabby Undeposited Funds',
        saleNet: 3084.15,
        refunds: 0,
        prePayout: 3084.15,
        payoutFeeAndVat: -6.3,
        bankPayout: 3077.85,
        final: 0,
      },
      refunds: { count: 0, gross: 0, commissionReturned: 0, feesReturned: 0, vatReturned: 0, transfer: 0 },
      matching: { matched: 6, total: 6, byStatus: { MATCHED: 6 }, customers: { '4265011000000160061': 6 } },
      ledger: { final: { UNDEPOSITED: 0, PROCESSING: 0 } },
    },
    rows: [],
    components: [],
    counts: { components: 14, verified: 0, toPost: 14, uncertain: 0, review: 0 },
    ...overrides,
  }
}

const BATCH: TabbyBatch = {
  id: '7',
  statementNumber: STATEMENT,
  fileHash: '177ad351',
  fileName: `${STATEMENT}.xlsx`,
  statementDate: '2026-09-28',
  transferDate: '2026-09-28',
  companyName: null,
  currency: 'AED',
  status: 'READY',
  review: null,
  bankStatus: null,
  bankTransactionId: null,
  postingJob: null,
  importedBy: 'user:1',
  createdAt: '2026-09-29T08:00:00.000Z',
  updatedAt: '2026-09-29T08:00:00.000Z',
  postedAt: null,
}

function job(overrides: Partial<TabbyPostJob> = {}): TabbyPostJob {
  return {
    id: 'job-1',
    status: 'RUNNING',
    statementNumber: STATEMENT,
    actor: 'user:1',
    startedAt: '2026-09-29T16:20:00.000Z',
    heartbeatAt: '2026-09-29T16:20:05.000Z',
    finishedAt: null,
    progress: { phase: 'POSTING', done: 3, total: 14, current: `${STATEMENT}/21141/SALE_NET` },
    result: null,
    error: null,
    ...overrides,
  }
}

const SUCCEEDED = job({
  status: 'SUCCEEDED',
  finishedAt: '2026-09-29T16:21:18.000Z',
  progress: { phase: 'FINISHING', done: 14, total: 14, current: null },
  result: {
    status: 'POSTED',
    stoppedAt: null,
    stopReason: null,
    log: [{ key: `${STATEMENT}|PAYOUT_FEE|STATEMENT`, component: 'PAYOUT_FEE', reference: `${STATEMENT}/PAYOUT_FEE`, amount: 6.3, status: 'VERIFIED', zohoRecordId: 'J-1' }],
  },
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/management/tabby-clearing" element={<TabbyClearingPage pollMs={5} />} />
        <Route path="/management/tabby-clearing/batch/:batchId" element={<TabbyClearingPage pollMs={5} />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  api.listTabbyBatches.mockResolvedValue({ batches: [BATCH], postingEnabled: true })
  api.getTabbyActivity.mockResolvedValue({ events: [] })
  api.getTabbyPostJob.mockResolvedValue({ job: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('TabbyClearingPage', () => {
  it('shows the statement figures and keeps posting disabled while blockers exist', async () => {
    api.getTabbyPreview.mockResolvedValue({
      preview: preview({
        status: 'BLOCKED',
        canPost: false,
        blockers: [{ code: 'ACCOUNT_UNMAPPED', message: 'Tabby Fees Expense: no Zoho account named "Tabby Fees Expense".' }],
      }),
    })
    renderAt('/management/tabby-clearing/batch/7')

    expect(await screen.findByText(/Blocking posting/)).toBeTruthy()
    expect(screen.getByText(/Tabby Fees Expense: no Zoho account/)).toBeTruthy()
    expect(screen.getByText('3,316.84')).toBeTruthy()
    expect(screen.getByText('11.39')).toBeTruthy()
    expect(screen.getByText('1 blocker(s) must be resolved first.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Post to Zoho' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.getTabbyPreview).toHaveBeenCalledWith('7', { deep: false })
  })

  it('refreshes the saved statements list after a preview so its status is not stale', async () => {
    api.listTabbyBatches
      .mockResolvedValueOnce({ batches: [{ ...BATCH, status: 'BLOCKED' }], postingEnabled: true })
      .mockResolvedValue({ batches: [{ ...BATCH, status: 'READY' }], postingEnabled: true })
    api.getTabbyPreview.mockResolvedValue({ preview: preview() })
    renderAt('/management/tabby-clearing/batch/7')

    await waitFor(() => expect(api.listTabbyBatches).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Blocked')).toBeNull())
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0)
  })

  it('posts in the background after confirmation, shows progress, then the result', async () => {
    const posted = preview({ status: 'POSTED', canPost: false, counts: { components: 14, verified: 14, toPost: 0, uncertain: 0, review: 0 } })
    api.getTabbyPreview.mockResolvedValueOnce({ preview: preview() }).mockResolvedValue({ preview: posted })
    const confirm = vi.spyOn(window, 'confirm')
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)
    api.postTabbyBatch.mockResolvedValue({ job: job({ progress: { phase: 'QUEUED', done: 0, total: null, current: null } }) })
    api.getTabbyPostJob
      .mockResolvedValueOnce({ job: null })
      .mockResolvedValueOnce({ job: job() })
      .mockResolvedValue({ job: SUCCEEDED })
    renderAt('/management/tabby-clearing/batch/7')

    const button = await screen.findByRole('button', { name: 'Post to Zoho' })
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(api.postTabbyBatch).not.toHaveBeenCalled()

    fireEvent.click(button)
    await waitFor(() => expect(api.postTabbyBatch).toHaveBeenCalledWith('7', 'fp-1'))
    expect(await screen.findByText(`Posting 4 of 14 · ${STATEMENT}/21141/SALE_NET`)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Posting…' }) as HTMLButtonElement).disabled).toBe(true)

    expect(await screen.findByText('Posting result: Posted')).toBeTruthy()
    expect(screen.getByText('J-1')).toBeTruthy()
    expect(screen.getByText(`${STATEMENT} is Posted.`)).toBeTruthy()
    await waitFor(() => expect(api.getTabbyPreview).toHaveBeenCalledTimes(2))
  })

  it('shows why a background run failed and loads the new preview', async () => {
    api.getTabbyPreview
      .mockResolvedValueOnce({ preview: preview() })
      .mockResolvedValue({ preview: preview({ fingerprint: 'fp-2', date: '2026-09-30' }) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    api.postTabbyBatch.mockResolvedValue({ job: job() })
    api.getTabbyPostJob.mockResolvedValueOnce({ job: null }).mockResolvedValue({
      job: job({
        status: 'FAILED',
        finishedAt: '2026-09-29T16:20:09.000Z',
        error: { status: 409, code: 'PREVIEW_CHANGED', message: 'The statement, Zoho or the posting date changed since this preview.' },
      }),
    })
    renderAt('/management/tabby-clearing/batch/7')

    fireEvent.click(await screen.findByRole('button', { name: 'Post to Zoho' }))
    expect(await screen.findByText('Last posting run: Failed')).toBeTruthy()
    expect(await screen.findByText(/posting date 2026-09-30/)).toBeTruthy()
  })

  it('picks up a run that is already in progress when the page is reopened', async () => {
    api.getTabbyPreview.mockResolvedValue({ preview: preview() })
    api.getTabbyPostJob.mockResolvedValueOnce({ job: job() }).mockResolvedValueOnce({ job: job() }).mockResolvedValue({ job: SUCCEEDED })
    renderAt('/management/tabby-clearing/batch/7')

    expect(await screen.findByText(/Posting 4 of 14/)).toBeTruthy()
    expect(await screen.findByText('Posting result: Posted')).toBeTruthy()
    expect(api.postTabbyBatch).not.toHaveBeenCalled()
  })

  it('a second click while a run is going shows that run instead of starting another', async () => {
    api.getTabbyPreview.mockResolvedValue({ preview: preview() })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    api.postTabbyBatch.mockRejectedValue(
      Object.assign(new Error(`${STATEMENT} is already being posted.`), { status: 409, body: { code: 'POSTING_IN_PROGRESS', job: job() } })
    )
    api.getTabbyPostJob.mockResolvedValueOnce({ job: null }).mockResolvedValue({ job: job() })
    renderAt('/management/tabby-clearing/batch/7')

    fireEvent.click(await screen.findByRole('button', { name: 'Post to Zoho' }))
    expect(await screen.findByText(/already being posted; showing its progress/)).toBeTruthy()
    expect(screen.getByText(/Posting 4 of 14/)).toBeTruthy()
  })

  it('reopens an already-imported statement on re-upload', async () => {
    api.uploadTabbyStatement.mockResolvedValue({ result: 'ALREADY_IMPORTED', batchId: '7', preview: preview() })
    api.getTabbyPreview.mockResolvedValue({ preview: preview() })
    const { container } = renderAt('/management/tabby-clearing')

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], `${STATEMENT}.xlsx`)
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload and preview' }))

    expect(await screen.findByText(/already imported from this exact file/)).toBeTruthy()
    expect(api.uploadTabbyStatement).toHaveBeenCalledWith(file)
  })
})

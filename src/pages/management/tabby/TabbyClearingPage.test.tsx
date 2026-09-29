import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TabbyBatch, TabbyPreview } from '../../../api/tabbyClearing'

const api = vi.hoisted(() => ({
  listTabbyBatches: vi.fn(),
  uploadTabbyStatement: vi.fn(),
  getTabbyPreview: vi.fn(),
  postTabbyBatch: vi.fn(),
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
  importedBy: 'user:1',
  createdAt: '2026-09-29T08:00:00.000Z',
  updatedAt: '2026-09-29T08:00:00.000Z',
  postedAt: null,
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/management/tabby-clearing" element={<TabbyClearingPage />} />
        <Route path="/management/tabby-clearing/batch/:batchId" element={<TabbyClearingPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  api.listTabbyBatches.mockResolvedValue({ batches: [BATCH], postingEnabled: true })
  api.getTabbyActivity.mockResolvedValue({ events: [] })
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

  it('posts only after confirmation and sends the reviewed fingerprint', async () => {
    api.getTabbyPreview.mockResolvedValue({ preview: preview() })
    const confirm = vi.spyOn(window, 'confirm')
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)
    api.postTabbyBatch.mockResolvedValue({
      batchId: '7',
      status: 'POSTED',
      stoppedAt: null,
      stopReason: null,
      log: [{ key: `${STATEMENT}|PAYOUT_FEE|STATEMENT`, component: 'PAYOUT_FEE', reference: `${STATEMENT}/PAYOUT_FEE`, amount: 6.3, status: 'VERIFIED', zohoRecordId: 'J-1' }],
      preview: preview({ status: 'POSTED', canPost: false, counts: { components: 14, verified: 14, toPost: 0, uncertain: 0, review: 0 } }),
    })
    renderAt('/management/tabby-clearing/batch/7')

    const button = await screen.findByRole('button', { name: 'Post to Zoho' })
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(api.postTabbyBatch).not.toHaveBeenCalled()

    fireEvent.click(button)
    await waitFor(() => expect(api.postTabbyBatch).toHaveBeenCalledWith('7', 'fp-1'))
    expect(await screen.findByText('Posting result: Posted')).toBeTruthy()
    expect(screen.getByText('J-1')).toBeTruthy()
  })

  it('replaces a stale preview when the server reports it changed', async () => {
    api.getTabbyPreview.mockResolvedValue({ preview: preview() })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const changed = Object.assign(new Error('The statement, Zoho or the posting date changed since this preview.'), {
      status: 409,
      body: { code: 'PREVIEW_CHANGED', preview: preview({ fingerprint: 'fp-2', date: '2026-09-30' }) },
    })
    api.postTabbyBatch.mockRejectedValue(changed)
    renderAt('/management/tabby-clearing/batch/7')

    fireEvent.click(await screen.findByRole('button', { name: 'Post to Zoho' }))
    expect(await screen.findByText(/changed since this preview/)).toBeTruthy()
    expect(screen.getByText(/posting date 2026-09-30/)).toBeTruthy()
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

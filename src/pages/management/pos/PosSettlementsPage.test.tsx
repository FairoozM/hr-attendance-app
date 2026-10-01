import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { PosComponent, PosPostJob, PosPreview, PosSettlement, PosTransaction } from '../../../api/posSettlements'

const api = vi.hoisted(() => ({
  listPosSettlements: vi.fn(),
  uploadPosFile: vi.fn(),
  getPosPreview: vi.fn(),
  approvePosSettlement: vi.fn(),
  revokePosApproval: vi.fn(),
  postPosSettlement: vi.fn(),
  getPosPostJob: vi.fn(),
  getPosActivity: vi.fn(),
  linkPosBank: vi.fn(),
  unlinkPosBank: vi.fn(),
  dismissPosConflict: vi.fn(),
  searchPosInvoices: vi.fn(),
  getPosManualMappings: vi.fn(),
  savePosManualMapping: vi.fn(),
  revokePosManualMapping: vi.fn(),
  listPosTerminals: vi.fn(),
  savePosTerminal: vi.fn(),
  removePosTerminal: vi.fn(),
  getPosAccounts: vi.fn(),
  savePosAccount: vi.fn(),
  clearPosAccount: vi.fn(),
}))
vi.mock('../../../api/posSettlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/posSettlements')>()),
  ...api,
}))

import { PosSettlementsPage } from './PosSettlementsPage'

const CODE = 'MSQ-20260905-ABC123'
const SHOP = '4265011000038735005'

function txn(overrides: Partial<PosTransaction> = {}): PosTransaction {
  return {
    id: '1',
    sourceRow: 2,
    fileId: '1',
    merchantId: '200600123456',
    terminalId: 'BJ000001',
    rrn: '003042448545',
    stan: '000123',
    authCode: 'A1B2C3',
    transactionType: 'SALE',
    transactionDate: '2026-09-05',
    transactionTime: '13:10:00',
    batchNumber: null,
    cardScheme: null,
    maskedCard: null,
    gross: 227.8,
    commission: 4.2,
    otherFees: 0,
    vat: 0.21,
    net: 223.39,
    netDerived: false,
    match: { status: 'MATCHED', reason: '', matched: true, allocations: [{ invoiceId: 'I659', invoiceNumber: 'INV-043659', gross: 227.8 }], candidates: null, possible: [] },
    manualMapping: null,
    channel: 'BURJUMAN_SHOP',
    channelSource: 'WEBSITE_ORDER',
    channelEvidence: [],
    order: { orderNumber: '20947', shopOrder: true, userAgent: 'web', paymentMethod: 'pos' },
    problems: [],
    warnings: [],
    ...overrides,
  }
}

const COMPONENTS: PosComponent[] = [
  { key: `${CODE}|RECEIPT_NET|CUSTOMER:${SHOP}`, component: 'RECEIPT_NET', phase: 10, scope: `CUSTOMER:${SHOP}`, zohoRecordType: 'customer_payment', reference: `${CODE}/NET/SHOP`, amount: 324.24, date: '2026-09-05', customerId: SHOP, allocations: [{ invoiceId: 'I659', invoiceNumber: 'INV-043659', amount: 223.39 }, { invoiceId: 'I660', invoiceNumber: 'INV-043660', amount: 100.85 }], depositAccount: 'POS-Machine Undeposited Funds (1062)', fromAccount: null, toAccount: null, lines: [], payload: {}, local: null, zoho: { state: 'MISSING' }, recovery: { action: 'POST_ELIGIBLE' } },
  { key: `${CODE}|RECEIPT_FEE|CUSTOMER:${SHOP}`, component: 'RECEIPT_FEE', phase: 11, scope: `CUSTOMER:${SHOP}`, zohoRecordType: 'customer_payment', reference: `${CODE}/FEE/SHOP`, amount: 6.41, date: '2026-09-05', customerId: SHOP, allocations: [], depositAccount: 'POS-Machine Uncleared Commission Exp (1039)', fromAccount: null, toAccount: null, lines: [], payload: {}, local: null, zoho: { state: 'MISSING' }, recovery: { action: 'POST_ELIGIBLE' } },
  { key: `${CODE}|FEE_RECOGNITION|PAYOUT`, component: 'FEE_RECOGNITION', phase: 30, scope: 'PAYOUT', zohoRecordType: 'journal', reference: `${CODE}/FEES`, amount: 6.41, date: '2026-09-05', customerId: null, allocations: [], depositAccount: null, fromAccount: null, toAccount: null, lines: [{ role: 'FEE_EXPENSE', account: 'POS-Machine Transaction Fee (2126)', accountId: 'A', side: 'debit', amount: 6.1 }, { role: 'INPUT_VAT', account: 'Input VAT (1085)', accountId: 'B', side: 'debit', amount: 0.31 }, { role: 'PROCESSING', account: 'POS-Machine Uncleared Commission Exp (1039)', accountId: 'C', side: 'credit', amount: 6.41 }], payload: {}, local: null, zoho: { state: 'MISSING' }, recovery: { action: 'POST_ELIGIBLE' } },
]

function preview(overrides: Partial<PosPreview> = {}): PosPreview {
  return {
    settlementId: '5',
    settlementCode: CODE,
    payoutKey: 'TDATE:2026-09-05',
    basis: 'TRANSACTION_DATE',
    payoutDate: '2026-09-05',
    status: 'READY',
    postingEnabled: true,
    approval: null,
    approved: false,
    canApprove: true,
    canPost: false,
    fingerprint: 'fp-1',
    blockers: [],
    warnings: [],
    accounts: { resolved: {}, problems: [] },
    totals: { count: 2, gross: 330.65, commission: 6.1, otherFees: 0, vat: 0.31, charges: 6.41, net: 324.24 },
    byChannel: { BURJUMAN_SHOP: { count: 2, gross: 330.65, commission: 6.1, vat: 0.31, net: 324.24 } },
    merchants: ['200600123456'],
    terminals: ['BJ000001'],
    batches: [],
    firstDate: '2026-09-05',
    lastDate: '2026-09-05',
    transactions: [txn(), txn({ id: '2', sourceRow: 3, rrn: '003042523578', gross: 102.85, commission: 1.9, vat: 0.1, net: 100.85, match: { status: 'MATCHED', reason: '', matched: true, allocations: [{ invoiceId: 'I660', invoiceNumber: 'INV-043660', gross: 102.85 }], candidates: null, possible: [] } })],
    inactiveTransactions: [],
    invoices: [],
    bank: { status: 'BANK_MATCHED', amount: 324.24, matched: { transactionId: 'BRV01117', date: '2026-09-09', amount: 324.24, transactionType: 'transfer_fund', referenceNumber: 'BRV-01117', offsetAccountName: 'RAK BANK MAIN 5061', status: 'categorized' }, candidates: [], reason: 'Existing Zoho transfer BRV-01117 on 2026-09-09.', linkedTransactionId: null },
    feeRecognition: { status: 'NONE_FOUND', reason: 'No fee recognition found.' },
    components: COMPONENTS,
    ledger: { UNDEPOSITED: { account: 'POS-Machine Undeposited Funds (1062)', balance: 0 }, PROCESSING: { account: 'POS-Machine Uncleared Commission Exp (1039)', balance: 0 } },
    rrnIndex: { window: { dateFrom: '2026-09-02', dateTo: '2026-09-08' }, stats: { detailRead: 2, skippedUnchanged: 0 } },
    counts: { transactions: 2, matched: 2, components: 3, verified: 0, toPost: 3, review: 0 },
    zohoCalls: 14,
    ...overrides,
  }
}

const SETTLEMENT: PosSettlement = {
  id: '5',
  provider: 'MASHREQ',
  payoutKey: 'TDATE:2026-09-05',
  settlementCode: CODE,
  basis: 'TRANSACTION_DATE',
  payoutDate: '2026-09-05',
  currency: 'AED',
  status: 'READY',
  review: null,
  approval: null,
  bankStatus: null,
  bankTransactionId: null,
  postingJob: null,
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
  postedAt: null,
}

function job(overrides: Partial<PosPostJob> = {}): PosPostJob {
  return {
    id: 'job-1',
    status: 'RUNNING',
    settlementCode: CODE,
    actor: 'user:1',
    startedAt: '2026-09-10T09:00:00.000Z',
    heartbeatAt: '2026-09-10T09:00:01.000Z',
    finishedAt: null,
    progress: { phase: 'POSTING', done: 1, total: 3, current: `${CODE}/FEE/SHOP` },
    result: null,
    error: null,
    ...overrides,
  }
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/management/pos-settlements" element={<PosSettlementsPage pollMs={5} />} />
        <Route path="/management/pos-settlements/:settlementId" element={<PosSettlementsPage pollMs={5} />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  api.listPosSettlements.mockResolvedValue({ settlements: [SETTLEMENT], files: [], postingEnabled: true, sourceFormats: ['ENRICH_CSV', 'SIMPLE_CSV', 'DETAIL_TXT', 'MSA'] })
  api.getPosPostJob.mockResolvedValue({ job: null })
  api.getPosActivity.mockResolvedValue({ events: [] })
  api.getPosManualMappings.mockResolvedValue({ mappings: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('PosSettlementsPage', () => {
  it('shows the payout figures, channel breakdown and keeps approve/post disabled while blocked', async () => {
    api.getPosPreview.mockResolvedValue({
      preview: preview({ status: 'BLOCKED', canApprove: false, blockers: [{ code: 'CHANNEL_MISMATCH', message: 'Website order 20947 is a web-app order but the invoice is on the shop customer.' }] }),
    })
    renderAt('/management/pos-settlements/5')
    expect(await screen.findByText(/Blockers \(1\)/)).toBeTruthy()
    expect(screen.getByText(/web-app order but the invoice is on the shop customer/)).toBeTruthy()
    expect(screen.getAllByText('BurJuman shop').length).toBeGreaterThan(0)
    expect(screen.getAllByText('324.24').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Post to Zoho' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('approves the exact fingerprint, then posts and polls the background job', async () => {
    api.getPosPreview.mockResolvedValueOnce({ preview: preview() })
    const approved = preview({ approved: true, canPost: true, approval: { fingerprint: 'fp-1', by: 'user:1', at: '2026-09-10T08:30:00.000Z', note: 'checked with statement', totals: preview().totals, components: [] } })
    api.approvePosSettlement.mockResolvedValue({ approval: approved.approval, preview: approved })
    renderAt('/management/pos-settlements/5')
    fireEvent.change(await screen.findByLabelText('Approval note'), { target: { value: 'checked with statement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(api.approvePosSettlement).toHaveBeenCalledWith('5', 'fp-1', 'checked with statement'))
    expect(await screen.findByText('Approved and ready to post')).toBeTruthy()

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    api.postPosSettlement.mockResolvedValue({ job: job() })
    const done = job({ status: 'SUCCEEDED', finishedAt: '2026-09-10T09:00:09.000Z', result: { status: 'POSTED', stoppedAt: null, stopReason: null, log: [{ key: 'k', component: 'RECEIPT_NET', reference: `${CODE}/NET/SHOP`, amount: 324.24, status: 'VERIFIED', zohoRecordId: 'P-1' }] } })
    api.getPosPostJob.mockResolvedValue({ job: done })
    api.getPosPreview.mockResolvedValue({ preview: preview({ status: 'POSTED', approved: true, canPost: false, canApprove: false }) })
    fireEvent.click(screen.getByRole('button', { name: 'Post to Zoho' }))
    await waitFor(() => expect(api.postPosSettlement).toHaveBeenCalledWith('5', 'fp-1'))
    expect(await screen.findByText(/Posting result: Posted/)).toBeTruthy()
    expect(screen.getByText('P-1')).toBeTruthy()
  })

  it('explains that posting is off on the server even after approval', async () => {
    api.listPosSettlements.mockResolvedValue({ settlements: [SETTLEMENT], files: [], postingEnabled: false, sourceFormats: [] })
    api.getPosPreview.mockResolvedValue({ preview: preview({ postingEnabled: false, approved: true, canPost: false, approval: { fingerprint: 'fp-1', by: 'user:1', at: '2026-09-10T08:30:00.000Z', note: null, totals: preview().totals, components: [] } }) })
    renderAt('/management/pos-settlements/5')
    expect(await screen.findByText(/POS_SETTLEMENT_POSTING_ENABLED/)).toBeTruthy()
    expect(screen.getByText(/Uploads, previews and approvals work; nothing can be written to Zoho/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Post to Zoho' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('manual mapping: possible match prefilled, one customer, amounts must equal the gross, reason required', async () => {
    const unmatched = txn({
      match: {
        status: 'RRN_NOT_FOUND',
        reason: 'No Zoho invoice carries RRN 003042448545.',
        matched: false,
        allocations: [],
        candidates: null,
        possible: [{ invoiceId: 'I659', invoiceNumber: 'INV-043659', referenceNumber: '20947', customerId: SHOP, customerName: 'Burjman Shop - Web & App', date: '2026-09-05', status: 'sent', totalMinor: 22780, balanceMinor: 22780, currencyCode: 'AED' }],
      },
    })
    api.getPosPreview.mockResolvedValue({ preview: preview({ status: 'BLOCKED', canApprove: false, transactions: [unmatched], blockers: [{ code: 'RRN_NOT_FOUND', message: 'No Zoho invoice carries RRN 003042448545.' }] }) })
    api.searchPosInvoices.mockResolvedValue({ invoices: [{ invoiceId: 'IW', invoiceNumber: 'INV-W', referenceNumber: '30000', customerId: '4265011000000160061', customerName: 'Website', date: '2026-09-05', status: 'sent', totalMinor: 50000, balanceMinor: 50000, currencyCode: 'AED' }] })
    api.savePosManualMapping.mockResolvedValue({ mapping: {} })
    renderAt('/management/pos-settlements/5')

    fireEvent.click(await screen.findByRole('button', { name: 'Map manually' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /INV-043659/ }))
    const amount = within(dialog).getByLabelText('Amount for INV-043659') as HTMLInputElement
    expect(amount.value).toBe('227.80')
    const save = within(dialog).getByRole('button', { name: 'Save mapping' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Search invoices'), { target: { value: 'INV-W' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Search Zoho' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: /INV-W/ }))
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Customer receipt shows the invoice' } })
    expect(within(dialog).getByText(/same Zoho customer/)).toBeTruthy()
    expect(save.disabled).toBe(true)

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Remove' })[1])
    fireEvent.change(amount, { target: { value: '200' } })
    expect(within(dialog).getByText(/Allocated 200.00 of 227.80/)).toBeTruthy()
    fireEvent.change(amount, { target: { value: '227.80' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(api.savePosManualMapping).toHaveBeenCalledWith('1', [{ invoiceId: 'I659', amount: '227.80' }], 'Customer receipt shows the invoice'))
  })

  it('refused uploads list the row problems', async () => {
    api.getPosPreview.mockResolvedValue({ preview: preview() })
    const err = Object.assign(new Error('enrich.csv was not imported: 1 row problem(s)'), { body: { code: 'FILE_REFUSED', problems: [{ code: 'RRN_FORMAT', message: 'RRN "3042448545" has 10 digits, expected 12; leading zeros were probably lost.' }] } })
    api.uploadPosFile.mockRejectedValue(err)
    renderAt('/management/pos-settlements')
    const input = (await screen.findByLabelText('Mashreq file')) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'enrich.csv', { type: 'text/csv' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByText(/leading zeros were probably lost/)).toBeTruthy()
    expect(api.uploadPosFile).toHaveBeenCalledWith(expect.any(File))
    expect(screen.queryByLabelText('Source format')).toBeNull()
  })

  it('a refusal already naming its problem does not repeat it', async () => {
    api.getPosPreview.mockResolvedValue({ preview: preview() })
    const problem = 'The TR record(s) carry no settlement reference; expected one.'
    const err = Object.assign(new Error(`x.csv was not imported: ${problem}`), { body: { code: 'FILE_REFUSED', problems: [{ code: 'SETTLEMENT_REF', message: problem }] } })
    api.uploadPosFile.mockRejectedValue(err)
    renderAt('/management/pos-settlements')
    const input = (await screen.findByLabelText('Mashreq file')) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'x.csv', { type: 'text/csv' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    const banner = await screen.findByText(/was not imported/)
    expect(banner.textContent?.split(problem).length).toBe(2)
  })

  it('a used-up Zoho daily limit shows one plain message instead of a list of blockers', async () => {
    const limit = 'Zoho safe-stop active (8800/8500 calls today). Non-critical requests are blocked.'
    api.getPosPreview.mockResolvedValue({
      preview: preview({
        blockers: [
          { code: 'ZOHO_ACCOUNTS_UNAVAILABLE', message: `Zoho chart of accounts could not be read: ${limit}` },
          { code: 'NOT_CHECKED', message: 'Zoho invoices were not searched.' },
        ],
        canApprove: false,
      }),
    })
    renderAt('/management/pos-settlements/1')
    expect(await screen.findByText(/today's Zoho request limit is used up/)).toBeTruthy()
    expect(screen.queryByText(/Blockers \(/)).toBeNull()
    expect(screen.getByText('Waiting for Zoho (daily request limit reached).')).toBeTruthy()
  })

  it('MSA control files are not listed with the imported files', async () => {
    api.listPosSettlements.mockResolvedValue({
      settlements: [],
      postingEnabled: false,
      sourceFormats: [],
      files: [
        { id: '1', fileHash: 'a'.repeat(64), fileName: '100140318MSA-1.txt', sourceFormat: 'MSA', role: 'CONTROL', transactionCount: 0, newCount: 0, duplicateCount: 0, conflictCount: 0, importedBy: 'user:1', createdAt: null },
        { id: '2', fileHash: 'b'.repeat(64), fileName: '100140318_Enrich_csv1-12.csv', sourceFormat: 'ENRICH_CSV', role: 'TRANSACTIONS', transactionCount: 2, newCount: 2, duplicateCount: 0, conflictCount: 0, importedBy: 'user:1', createdAt: null },
      ],
    })
    renderAt('/management/pos-settlements')
    expect(await screen.findByText('Imported files (1)')).toBeTruthy()
    expect(screen.queryByText('100140318MSA-1.txt')).toBeNull()
  })
})

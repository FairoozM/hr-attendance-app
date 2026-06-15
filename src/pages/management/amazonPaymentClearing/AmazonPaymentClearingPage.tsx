import { useCallback, useMemo, useState } from 'react'
import {
  approveKsaPaymentClearingBatch,
  fetchKsaPaymentClearingBatch,
  fetchKsaSettlementReports,
  generateKsaPaymentClearingPaymentPreview,
  type PaymentClearingPaymentPreview,
  type PaymentPostingResult,
  previewKsaSettlementReport,
  postKsaPaymentClearingToZoho,
  type PaymentClearingPreview,
  type SettlementReport,
} from '../../../api/amazonPaymentClearing'
import './AmazonPaymentClearingPage.css'

function safeError(err: unknown) {
  return err instanceof Error ? err.message : 'Request failed'
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'SAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)
}

function dateText(value: string | null | undefined) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(d)
}

function dateRangeText(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return '-'
  return `${dateText(start)} - ${dateText(end)}`
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ainv-summary-card">
      <div className="ainv-summary-card__label">{label}</div>
      <div className="ainv-summary-card__value">{value}</div>
    </div>
  )
}


function PivotTable({ preview }: { preview: PaymentClearingPreview }) {
  if (!preview.pivot.length) return <div className="apc-empty">No category rows to show yet.</div>
  return (
    <div className="apc-table-wrap">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Count</th>
            <th className="apc-money">Total SAR</th>
          </tr>
        </thead>
        <tbody>
          {preview.pivot.map((row) => (
            <tr key={row.category}>
              <td>{row.category}</td>
              <td>{row.count}</td>
              <td className="apc-money">{money(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SettlementLevelFeesTable({ preview }: { preview: PaymentClearingPreview }) {
  if (!preview.settlementLevelFees.length) {
    return <div className="apc-empty">No settlement-level fees in this report.</div>
  }
  return (
    <div className="apc-table-wrap">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Count</th>
            <th className="apc-money">Total</th>
          </tr>
        </thead>
        <tbody>
          {preview.settlementLevelFees.map((row) => (
            <tr key={row.category}>
              <td>{row.category}</td>
              <td>{row.count}</td>
              <td className="apc-money">{money(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReconciliationStatusBadge({ status }: { status: 'reconciled' | 'mismatch' }) {
  const isReconciled = status === 'reconciled'
  return (
    <span className={`apc-status-badge ${isReconciled ? 'apc-status-badge--success' : 'apc-status-badge--danger'}`}>
      {isReconciled ? 'RECONCILED' : 'MISMATCH'}
    </span>
  )
}

function SettlementReconciliation({ preview }: { preview: PaymentClearingPreview }) {
  const summary = preview.reconciliationSummary
  const lines = [
    ['Order-Level Net Balance', summary.orderLevelNetBalance],
    ['Less Advertising Fees', summary.advertisingFeeTotal],
    ['Less Premium Service Fees', summary.premiumServiceFeeTotal],
    ['Less Premium Service Fee Tax', summary.premiumServiceFeeTaxTotal],
    ['Less Storage Fees', summary.storageFeeTotal],
    ['Less Easy Ship Charges', summary.easyShipChargesTotal],
    ['Less Other Settlement Fees', summary.otherSettlementFeeTotal],
  ] as const

  return (
    <div className="apc-reconciliation">
      <div className="apc-reconciliation__header">
        <p className="apc-muted">
          Reconciles order-level Amazon earnings to the final settlement amount deposited by Amazon after advertising,
          premium service fees, storage fees, and other settlement-level deductions.
        </p>
        <ReconciliationStatusBadge status={summary.reconciliationStatus} />
      </div>
      <div className="apc-table-wrap">
        <table className="apc-table">
          <tbody>
            {lines.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="apc-money">{money(value)}</td>
              </tr>
            ))}
            <tr className="apc-total-row">
              <td>Expected Amazon Deposit</td>
              <td className="apc-money">{money(summary.expectedAmazonDeposit)}</td>
            </tr>
            <tr>
              <td>Amazon Settlement Total</td>
              <td className="apc-money">{money(summary.actualAmazonSettlement)}</td>
            </tr>
            <tr className={summary.reconciliationStatus === 'mismatch' ? 'apc-reconciliation__difference--bad' : ''}>
              <td>Difference</td>
              <td className="apc-money">{money(summary.reconciliationDifference)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {summary.reconciliationStatus === 'mismatch' ? (
        <div className="apc-alert apc-alert--error" role="alert">
          Settlement total does not match calculated expected deposit.
        </div>
      ) : null}
    </div>
  )
}

function MatchedOrdersTable({ preview }: { preview: PaymentClearingPreview }) {
  if (!preview.matchedOrders.length) return <div className="apc-empty">No matched orders yet.</div>
  const shippingOffset = (row: PaymentClearingPreview['matchedOrders'][number]) => (
    (Number(row.shippingCollectedTotal) || 0) + (Number(row.shippingPromotionTotal) || 0)
  )
  const invoiceClearingFee = (row: PaymentClearingPreview['matchedOrders'][number]) => (
    (Number(row.commissionTotal) || 0) +
    (Number(row.fulfillmentFeeTotal) || 0) +
    (Number(row.closingFeeTotal) || 0) +
    (Number(row.otherAmazonFeeTotal) || 0) +
    shippingOffset(row)
  )
  const totals = preview.matchedOrders.reduce(
    (acc, row) => ({
      zohoInvoiceTotal: acc.zohoInvoiceTotal + (Number(row.zohoInvoiceTotal) || 0),
      principalTotal: acc.principalTotal + (Number(row.principalTotal) || 0),
      shippingCollectedTotal: acc.shippingCollectedTotal + (Number(row.shippingCollectedTotal) || 0),
      grossAmazonTotal: acc.grossAmazonTotal + (Number(row.grossAmazonTotal) || 0),
      commissionTotal: acc.commissionTotal + (Number(row.commissionTotal) || 0),
      fulfillmentFeeTotal: acc.fulfillmentFeeTotal + (Number(row.fulfillmentFeeTotal) || 0),
      closingFeeTotal: acc.closingFeeTotal + (Number(row.closingFeeTotal) || 0),
      shippingPromotionTotal: acc.shippingPromotionTotal + (Number(row.shippingPromotionTotal) || 0),
      shippingOffsetTotal: acc.shippingOffsetTotal + shippingOffset(row),
      otherAmazonFeeTotal: acc.otherAmazonFeeTotal + (Number(row.otherAmazonFeeTotal) || 0),
      invoiceClearingFeeTotal: acc.invoiceClearingFeeTotal + invoiceClearingFee(row),
      netSettlementAmount: acc.netSettlementAmount + (Number(row.netSettlementAmount) || 0),
    }),
    {
      zohoInvoiceTotal: 0,
      principalTotal: 0,
      shippingCollectedTotal: 0,
      grossAmazonTotal: 0,
      commissionTotal: 0,
      fulfillmentFeeTotal: 0,
      closingFeeTotal: 0,
      shippingPromotionTotal: 0,
      shippingOffsetTotal: 0,
      otherAmazonFeeTotal: 0,
      invoiceClearingFeeTotal: 0,
      netSettlementAmount: 0,
    }
  )
  return (
    <div className="apc-table-wrap apc-table-wrap--wide">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Amazon Order ID</th>
            <th>Zoho Invoice Number</th>
            <th>Zoho P.O.#</th>
            <th>Customer</th>
            <th className="apc-money">Zoho Invoice Total</th>
            <th className="apc-money">Principal</th>
            <th className="apc-money">Shipping Collected</th>
            <th className="apc-money">Gross Amazon Total</th>
            <th className="apc-money">Commission</th>
            <th className="apc-money">FBA Fee</th>
            <th className="apc-money">Closing Fee</th>
            <th className="apc-money">Shipping Promotion</th>
            <th className="apc-money">Shipping Offset</th>
            <th className="apc-money">Other Fees</th>
            <th className="apc-money">Invoice Clearing Fees</th>
            <th className="apc-money">Net Balance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {preview.matchedOrders.map((row) => (
            <tr key={row.orderId}>
              <td>{row.orderId}</td>
              <td>{row.zohoInvoiceNumber || '-'}</td>
              <td>{row.zohoPoNumber || '-'}</td>
              <td>{row.zohoCustomerName || '-'}</td>
              <td className="apc-money">{money(row.zohoInvoiceTotal)}</td>
              <td className="apc-money">{money(row.principalTotal)}</td>
              <td className="apc-money">{money(row.shippingCollectedTotal)}</td>
              <td className="apc-money">{money(row.grossAmazonTotal)}</td>
              <td className="apc-money">{money(row.commissionTotal)}</td>
              <td className="apc-money">{money(row.fulfillmentFeeTotal)}</td>
              <td className="apc-money">{money(row.closingFeeTotal)}</td>
              <td className="apc-money">{money(row.shippingPromotionTotal)}</td>
              <td className="apc-money">{money(shippingOffset(row))}</td>
              <td className="apc-money">{money(row.otherAmazonFeeTotal)}</td>
              <td className="apc-money">{money(invoiceClearingFee(row))}</td>
              <td className="apc-money">{money(row.netSettlementAmount)}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="apc-total-row">
            <td>Total matched orders</td>
            <td>{preview.matchedOrders.length}</td>
            <td>-</td>
            <td>-</td>
            <td className="apc-money">{money(totals.zohoInvoiceTotal)}</td>
            <td className="apc-money">{money(totals.principalTotal)}</td>
            <td className="apc-money">{money(totals.shippingCollectedTotal)}</td>
            <td className="apc-money">{money(totals.grossAmazonTotal)}</td>
            <td className="apc-money">{money(totals.commissionTotal)}</td>
            <td className="apc-money">{money(totals.fulfillmentFeeTotal)}</td>
            <td className="apc-money">{money(totals.closingFeeTotal)}</td>
            <td className="apc-money">{money(totals.shippingPromotionTotal)}</td>
            <td className="apc-money">{money(totals.shippingOffsetTotal)}</td>
            <td className="apc-money">{money(totals.otherAmazonFeeTotal)}</td>
            <td className="apc-money">{money(totals.invoiceClearingFeeTotal)}</td>
            <td className="apc-money">{money(totals.netSettlementAmount)}</td>
            <td>-</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function UnmatchedOrdersTable({ preview }: { preview: PaymentClearingPreview }) {
  if (!preview.unmatchedOrders.length) return <div className="apc-empty">No unmatched orders.</div>
  return (
    <div className="apc-table-wrap apc-table-wrap--wide">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Amazon Order ID</th>
            <th className="apc-money">Principal</th>
            <th className="apc-money">Gross Amazon Total</th>
            <th className="apc-money">Total Fees</th>
            <th className="apc-money">Net Balance</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {preview.unmatchedOrders.map((row) => (
            <tr key={row.orderId}>
              <td>{row.orderId}</td>
              <td className="apc-money">{money(row.principalTotal)}</td>
              <td className="apc-money">{money(row.grossAmazonTotal)}</td>
              <td className="apc-money">{money(row.totalFees)}</td>
              <td className="apc-money">{money(row.netSettlementAmount)}</td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaymentClearingPreviewTable({ paymentPreview }: { paymentPreview: PaymentClearingPaymentPreview }) {
  return (
    <div className="apc-table-wrap apc-table-wrap--wide">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Amazon Order ID</th>
            <th>Zoho Invoice Number</th>
            <th>Zoho P.O.#</th>
            <th className="apc-money">Invoice Total</th>
            <th className="apc-money">Shipping Offset</th>
            <th className="apc-money">Net Balance Payment<br /><span>KSA-Amazon Undeposited Funds (1024)</span></th>
            <th className="apc-money">Commission Payment<br /><span>KSA-Amazon Uncleared Commission Exp (1026)</span></th>
            <th className="apc-money">Shipping/FBA Payment<br /><span>KSA-Amazon Uncleared Shipping Exp (1028)</span></th>
            <th className="apc-money">Total Clearing</th>
            <th className="apc-money">Difference</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {paymentPreview.payments.map((row) => (
            <tr key={row.orderId || row.zohoInvoiceId}>
              <td>{row.orderId}</td>
              <td>{row.zohoInvoiceNumber || '-'}</td>
              <td>{row.zohoPoNumber || '-'}</td>
              <td className="apc-money">{money(row.invoiceTotal)}</td>
              <td className="apc-money">{money(row.shippingOffsetTotal)}</td>
              <td className="apc-money">{money(row.netBalancePayment.amount)}</td>
              <td className="apc-money">{money(row.commissionPayment.amount)}</td>
              <td className="apc-money">{money(row.shippingFbaPayment.amount)}</td>
              <td className="apc-money">{money(row.totalClearingAmount)}</td>
              <td className="apc-money">{money(row.remainingDifference)}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PostingResultTable({ result }: { result: PaymentPostingResult }) {
  return (
    <div className="apc-table-wrap apc-table-wrap--wide">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Payment Type</th>
            <th className="apc-money">Amount</th>
            <th>Payload customer_id</th>
            <th>Payload invoice_id</th>
            <th>Payload payment_date</th>
            <th>Payload account_id</th>
            <th>Payload account_name</th>
            <th>Payload reference_number</th>
            <th>Invoice allocations</th>
            <th>Status</th>
            <th>Zoho Payment ID</th>
          </tr>
        </thead>
        <tbody>
          {result.payments.map((row) => (
            <tr key={`${row.invoiceId}-${row.paymentType}`}>
              <td>{row.invoiceNumber || row.invoiceId}</td>
              <td>{row.paymentLabel || row.paymentType}</td>
              <td className="apc-money">{money(row.zohoPayloadPreview?.amount ?? row.amount)}</td>
              <td>{row.zohoPayloadPreview?.customer_id || '-'}</td>
              <td>{row.zohoPayloadPreview?.invoice_id || row.invoiceId}</td>
              <td>{row.zohoPayloadPreview?.payment_date || '-'}</td>
              <td>{row.zohoPayloadPreview?.account_id || '-'}</td>
              <td>{row.zohoPayloadPreview?.account_name || row.accountName}</td>
              <td>{row.zohoPayloadPreview?.reference_number || '-'}</td>
              <td>
                {row.zohoPayloadPreview?.invoices?.length ? (
                  <div className="apc-allocation-list">
                    {row.zohoPayloadPreview.invoices.map((invoice) => (
                      <div key={`${row.paymentType}-${invoice.invoice_id}`}>
                        {invoice.invoice_id}: {money(invoice.amount_applied)}
                      </div>
                    ))}
                  </div>
                ) : '-'}
              </td>
              <td>{row.status}</td>
              <td>{row.zohoPaymentId || row.reason || row.error || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AmazonPaymentClearingPage() {
  const [reportId, setReportId] = useState('')
  const [reportDocumentId, setReportDocumentId] = useState('')
  const [reports, setReports] = useState<SettlementReport[]>([])
  const [preview, setPreview] = useState<PaymentClearingPreview | null>(null)
  const [loadingReports, setLoadingReports] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [approving, setApproving] = useState(false)
  const [generatingPaymentPreview, setGeneratingPaymentPreview] = useState(false)
  const [paymentPreview, setPaymentPreview] = useState<PaymentClearingPaymentPreview | null>(null)
  const [posting, setPosting] = useState(false)
  const [postingResult, setPostingResult] = useState<PaymentPostingResult | null>(null)
  const [reopening, setReopening] = useState(false)
  const [batchIdToOpen, setBatchIdToOpen] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const selectedReport = useMemo(
    () => reports.find((row) => row.reportId === reportId || row.reportDocumentId === reportDocumentId),
    [reports, reportDocumentId, reportId]
  )

  const loadLatestReports = useCallback(async () => {
    setLoadingReports(true)
    setError('')
    try {
      const json = await fetchKsaSettlementReports()
      const rows = Array.isArray(json.reports) ? json.reports : []
      setReports(rows)
      if (rows[0]) {
        setReportId(rows[0].reportId || '')
        setReportDocumentId(rows[0].reportDocumentId || '')
      }
    } catch (e) {
      setError(safeError(e))
    } finally {
      setLoadingReports(false)
    }
  }, [])

  const runPreview = useCallback(async () => {
    setPreviewing(true)
    setError('')
    setNotice('')
    try {
      const json = await previewKsaSettlementReport({
        reportId: reportId.trim() || undefined,
        reportDocumentId: reportDocumentId.trim() || undefined,
        daysBack: 60,
      })
      setPreview(json)
      setPaymentPreview(null)
      setPostingResult(null)
    } catch (e) {
      setError(safeError(e))
    } finally {
      setPreviewing(false)
    }
  }, [reportDocumentId, reportId])

  const approveCurrentBatch = useCallback(async () => {
    const batchId = preview?.batch?.batchId
    if (!batchId || preview?.status === 'approved' || preview?.batch?.status === 'approved') return
    setApproving(true)
    setError('')
    setNotice('')
    try {
      const json = await approveKsaPaymentClearingBatch(batchId)
      setPreview(json)
      setPaymentPreview(null)
      setPostingResult(null)
      setNotice(json.message || 'Settlement approved and saved.')
    } catch (e) {
      setError(safeError(e))
    } finally {
      setApproving(false)
    }
  }, [preview])

  const reopenBatch = useCallback(async () => {
    const id = batchIdToOpen.trim()
    if (!id) return
    setReopening(true)
    setError('')
    setNotice('')
    try {
      const json = await fetchKsaPaymentClearingBatch(id)
      setPreview(json)
      setPaymentPreview(null)
      setPostingResult(null)
      setNotice(`Loaded saved settlement batch ${id}.`)
    } catch (e) {
      setError(safeError(e))
    } finally {
      setReopening(false)
    }
  }, [batchIdToOpen])

  const isPosted = preview?.status === 'posted' || preview?.batch?.status === 'posted'
  const isApproved = !isPosted && (preview?.status === 'approved' || preview?.batch?.status === 'approved')
  const approvedBy = preview?.approvedBy ?? preview?.batch?.approvedBy ?? null
  const approvedAt = preview?.approvedAt ?? preview?.batch?.approvedAt ?? null
  const postedBy = preview?.postedBy ?? preview?.batch?.postedBy ?? null
  const postedAt = preview?.postedAt ?? preview?.batch?.postedAt ?? null
  const canGeneratePaymentPreview = Boolean(
    preview?.batch?.batchId &&
      isApproved &&
      Math.abs(Number(preview.reconciliationSummary?.reconciliationDifference) || 0) <= 0.01 &&
      preview.unmatchedOrders.length === 0
  )
  const canPostToZoho = Boolean(canGeneratePaymentPreview && paymentPreview)

  const generatePaymentPreview = useCallback(async () => {
    const batchId = preview?.batch?.batchId
    if (!batchId || !canGeneratePaymentPreview) return
    setGeneratingPaymentPreview(true)
    setError('')
    setNotice('')
    try {
      const json = await generateKsaPaymentClearingPaymentPreview(batchId)
      setPaymentPreview(json)
      setPostingResult(null)
      setNotice('Payment clearing preview generated. No Zoho payments have been created.')
    } catch (e) {
      setError(safeError(e))
    } finally {
      setGeneratingPaymentPreview(false)
    }
  }, [canGeneratePaymentPreview, preview?.batch?.batchId])

  const runPosting = useCallback(async (dryRun: boolean) => {
    const batchId = preview?.batch?.batchId
    if (!batchId) return
    if (!dryRun) {
      const ok = window.confirm(
        `You are about to create 3 grouped Zoho Record Payments.\n\nSettlement: ${batchId}\n\nThis action cannot be automatically reversed.`
      )
      if (!ok) return
    }
    setPosting(true)
    setError('')
    setNotice('')
    try {
      const json = await postKsaPaymentClearingToZoho(batchId, dryRun)
      setPostingResult(json)
      setNotice(dryRun ? 'Dry run completed. No Zoho payments were created.' : 'Zoho posting completed.')
      if (!dryRun && json.summary.errors === 0) {
        const refreshed = await fetchKsaPaymentClearingBatch(batchId)
        setPreview(refreshed)
      }
    } catch (e) {
      setError(safeError(e))
    } finally {
      setPosting(false)
    }
  }, [preview?.batch?.batchId])

  return (
    <div className="ainv-page apc-page">
      <section className="ainv-page__header">
        <div className="ainv-page__eyebrow ainv-page__eyebrow--amber">Management · Amazon · KSA</div>
        <h1 className="ainv-page__title">Amazon KSA Payment Clearing</h1>
        <p className="ainv-page__lead">
          Import Amazon settlement reports, match Zoho invoices, and review payout/fee breakdown before posting.
        </p>
        <div className="ainv-callout-emerald">
          <strong>Zoho posting guarded.</strong> Stage 2C can create Zoho Record Payments only after approval,
          reconciliation, a generated payment preview, and explicit confirmation.
        </div>
      </section>

      <section className="ainv-panel">
        <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Fetch Settlement</h2>
        <div className="apc-actions">
          <label className="ainv-label">
            reportId
            <input
              className="ainv-input"
              value={reportId}
              onChange={(e) => setReportId(e.target.value)}
              placeholder="Leave blank to use latest KSA settlement"
            />
          </label>
          <label className="ainv-label">
            reportDocumentId
            <input
              className="ainv-input"
              value={reportDocumentId}
              onChange={(e) => setReportDocumentId(e.target.value)}
              placeholder="Optional direct report document ID"
            />
          </label>
          <label className="ainv-label">
            saved batchId
            <input
              className="ainv-input"
              value={batchIdToOpen}
              onChange={(e) => setBatchIdToOpen(e.target.value)}
              placeholder="Open approved/previewed batch"
            />
          </label>
          <div className="apc-button-row">
            <button className="ainv-btn" type="button" onClick={loadLatestReports} disabled={loadingReports || previewing}>
              {loadingReports ? 'Fetching...' : 'Fetch Latest KSA Settlement'}
            </button>
            <button className="ainv-btn ainv-btn--primary-sky" type="button" onClick={runPreview} disabled={previewing || loadingReports}>
              {previewing ? 'Previewing...' : 'Preview Report'}
            </button>
            <button className="ainv-btn" type="button" onClick={reopenBatch} disabled={reopening || previewing || loadingReports || !batchIdToOpen.trim()}>
              {reopening ? 'Opening...' : 'Open Saved Batch'}
            </button>
          </div>
        </div>
        {selectedReport ? (
          <p className="apc-muted">
            Selected report: {selectedReport.reportId || '-'} · range{' '}
            {dateRangeText(selectedReport.dataStartTime, selectedReport.dataEndTime)} · created {dateText(selectedReport.createdTime)}
          </p>
        ) : null}
        {reports.length ? (
          <div className="apc-table-wrap">
            <table className="apc-table">
              <thead>
                <tr>
                  <th>Amazon Report Range</th>
                  <th>Report ID</th>
                  <th>Created</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((row) => (
                  <tr key={row.reportId || row.reportDocumentId}>
                    <td>
                      <button
                        className="apc-link-button"
                        type="button"
                        onClick={() => {
                          setReportId(row.reportId || '')
                          setReportDocumentId(row.reportDocumentId || '')
                        }}
                      >
                        {dateRangeText(row.dataStartTime, row.dataEndTime)}
                      </button>
                    </td>
                    <td>{row.reportId || '-'}</td>
                    <td>{dateText(row.createdTime)}</td>
                    <td>{row.processingStatus || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {error ? <div className="apc-alert apc-alert--error" role="alert">{error}</div> : null}
      {notice ? <div className="apc-alert" role="status">{notice}</div> : null}

      {preview ? (
        <>
          {isPosted ? (
            <section className="ainv-panel apc-approved-panel">
              <div>
                <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Settlement posted to Zoho.</h2>
                <p className="apc-muted">
                  Status: <strong>POSTED</strong> · Posted By {postedBy ?? '-'} · Posted At {dateText(postedAt)}
                </p>
              </div>
            </section>
          ) : null}

          {isApproved ? (
            <section className="ainv-panel apc-approved-panel">
              <div>
                <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Settlement approved and saved.</h2>
                <p className="apc-muted">
                  Status: <strong>APPROVED FOR ZOHO POSTING</strong> · Approved By {approvedBy ?? '-'} · Approved At {dateText(approvedAt)}
                </p>
              </div>
            </section>
          ) : null}

          {(isApproved || isPosted) ? (
            <section className="ainv-panel apc-stage-panel">
              <div className="ainv-page__eyebrow ainv-page__eyebrow--amber">Stage 2B/2C · Zoho posting</div>
              <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Zoho Invoice Payment Clearing</h2>
              <div className="apc-alert">
                <strong>Stage 2C writes to Zoho.</strong> Use Dry Run first, then POST TO ZOHO after confirming the preview.
              </div>
              <p className="apc-muted">
                Creates a preview plan for three Zoho Record Payment entries per invoice: net balance, commission
                clearing, and shipping/FBA clearing.
              </p>
              <div className="apc-button-row">
                <button
                  className="ainv-btn ainv-btn--primary-sky"
                  type="button"
                  onClick={generatePaymentPreview}
                  disabled={!canGeneratePaymentPreview || generatingPaymentPreview || isPosted}
                >
                  {generatingPaymentPreview ? 'Generating...' : 'Generate Stage 2B Payment Preview'}
                </button>
              </div>
              {!canGeneratePaymentPreview ? (
                <p className="apc-muted">
                  Payment preview requires an approved, reconciled batch with zero unmatched orders.
                </p>
              ) : null}
              {paymentPreview ? (
                <>
                  <section className="apc-summary-grid">
                    <SummaryCard label="Invoices" value={paymentPreview.paymentPlanSummary.invoiceCount} />
                    <SummaryCard label="Payment Entries" value={paymentPreview.paymentPlanSummary.paymentEntryCount} />
                    <SummaryCard label="Net Balance Payments" value={money(paymentPreview.paymentPlanSummary.netBalanceTotal)} />
                    <SummaryCard label="Commission Clearing" value={money(paymentPreview.paymentPlanSummary.commissionClearingTotal)} />
                    <SummaryCard label="Shipping/FBA Clearing" value={money(paymentPreview.paymentPlanSummary.shippingFbaClearingTotal)} />
                    <SummaryCard label="Total Clearing" value={money(paymentPreview.paymentPlanSummary.totalPaymentAmount)} />
                    <SummaryCard label="Difference" value={money(paymentPreview.paymentPlanSummary.difference)} />
                  </section>
                  <PaymentClearingPreviewTable paymentPreview={paymentPreview} />
                  <div className="apc-button-row">
                    <button
                      className="ainv-btn"
                      type="button"
                      onClick={() => runPosting(true)}
                      disabled={!canPostToZoho || posting || isPosted}
                    >
                      {posting ? 'Posting...' : 'Dry Run'}
                    </button>
                    <button
                      className="ainv-btn ainv-btn--danger"
                      type="button"
                      onClick={() => runPosting(false)}
                      disabled={!canPostToZoho || posting || isPosted}
                    >
                      POST TO ZOHO
                    </button>
                  </div>
                  {paymentPreview.warnings.length ? (
                    <div className="apc-alert apc-alert--error">
                      <ul>
                        {paymentPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {postingResult ? (
                    <>
                      <section className="apc-summary-grid">
                        <SummaryCard label="Invoices Posted" value={postingResult.summary.invoicesPosted} />
                        <SummaryCard label="Payments Created" value={postingResult.summary.paymentsCreated} />
                        <SummaryCard label="Payments Skipped" value={postingResult.summary.paymentsSkipped} />
                        <SummaryCard label="Errors" value={postingResult.summary.errors} />
                      </section>
                      <PostingResultTable result={postingResult} />
                    </>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          <section className="apc-summary-grid">
            <SummaryCard label="Amazon Settlement Total" value={money(preview.totals.amazonSettlementTotal)} />
            <SummaryCard label="Product Sales" value={money(preview.totals.productSalesTotal)} />
            <SummaryCard label="Amazon Fees" value={money(preview.totals.feesTotal)} />
            <SummaryCard label="Refunds" value={money(preview.totals.refundsTotal)} />
            <SummaryCard label="Order Net Balance" value={money(preview.reconciliationSummary.orderLevelNetBalance)} />
            <SummaryCard label="Settlement Deductions" value={money(preview.reconciliationSummary.settlementLevelDeductions)} />
            <SummaryCard label="Expected Deposit" value={money(preview.reconciliationSummary.expectedAmazonDeposit)} />
            <SummaryCard label="Matched Orders" value={preview.matchedOrders.length} />
            <SummaryCard label="Unmatched Orders" value={preview.unmatchedOrders.length} />
            <SummaryCard label="Difference" value={money(preview.totals.difference)} />
          </section>

          <section className="ainv-panel">
            <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Report Summary</h2>
            <p className="apc-muted">
              Batch {preview.batch?.batchId ?? '-'} · Status {isPosted ? 'POSTED' : isApproved ? 'APPROVED FOR ZOHO POSTING' : (preview.batch?.status || preview.status || 'previewed')} · Settlement {preview.report.settlementId || '-'} · {dateText(preview.report.settlementStartDate)} to {dateText(preview.report.settlementEndDate)} · {preview.rawRowCount} rows
            </p>
            <div className="apc-button-row">
              <button
                className="ainv-btn ainv-btn--primary-sky"
                type="button"
                onClick={approveCurrentBatch}
                disabled={approving || isApproved || isPosted || !preview.batch?.batchId}
              >
                {isPosted ? 'Posted to Zoho' : isApproved ? 'Approved and Saved' : approving ? 'Approving...' : 'Approve Settlement'}
              </button>
            </div>
          </section>

          <section className="ainv-panel">
            <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Category Breakdown</h2>
            <PivotTable preview={preview} />
          </section>

          <section className="ainv-panel">
            <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Settlement-Level Fees</h2>
            <p className="apc-muted">
              Charges without an Amazon order ID, such as advertising and premium service fees. These are not matched to Zoho invoices.
            </p>
            <SettlementLevelFeesTable preview={preview} />
          </section>

          <section className="ainv-panel">
            <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Settlement Reconciliation</h2>
            <SettlementReconciliation preview={preview} />
          </section>

          <section className="ainv-panel">
            <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Matched Orders</h2>
            <MatchedOrdersTable preview={preview} />
          </section>

          <section className="ainv-panel">
            <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Unmatched Orders</h2>
            <UnmatchedOrdersTable preview={preview} />
          </section>

          <section className="ainv-panel">
            <h2 className="ainv-page__title" style={{ fontSize: '1.25rem' }}>Warnings</h2>
            {preview.warnings.length ? (
              <div className="apc-alert">
                <ul>
                  {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            ) : (
              <div className="apc-empty">No warnings returned for this preview.</div>
            )}
          </section>
        </>
      ) : (
        <section className="ainv-panel">
          <div className="apc-empty">Fetch the latest KSA settlement or enter a report/reportDocument ID, then preview.</div>
        </section>
      )}

    </div>
  )
}

export default AmazonPaymentClearingPage

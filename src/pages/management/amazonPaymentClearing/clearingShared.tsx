import type {
  ParsedRowStatus,
  PaymentClearingPaymentPreview,
  PaymentClearingPreview,
  PaymentPostingResult,
  PostingReference,
  RefundReturnCreditNoteRow,
  SettlementReference,
  AmazonFeeJournalMapping,
  AmazonFeeJournalLine,
} from '../../../api/amazonPaymentClearing'
import { LIFECYCLE_LABEL } from './clearingSteps'

export function safeError(err: unknown) {
  return err instanceof Error ? err.message : 'Request failed'
}

export function money(value: number | null | undefined) {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'SAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)
}

export function dateText(value: string | null | undefined) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(d)
}

export function dateRangeText(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return '-'
  return `${dateText(start)} - ${dateText(end)}`
}

export function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ainv-summary-card">
      <div className="ainv-summary-card__label">{label}</div>
      <div className="ainv-summary-card__value">{value}</div>
    </div>
  )
}

const ROW_STATUS_CLASS: Record<ParsedRowStatus, string> = {
  ok: 'apc-pill--neutral',
  matched: 'apc-pill--success',
  unmatched: 'apc-pill--danger',
  missing_order_id: 'apc-pill--danger',
  account_level_fee: 'apc-pill--info',
  blocked: 'apc-pill--danger',
  review: 'apc-pill--warn',
  unknown: 'apc-pill--warn',
}

const ROW_STATUS_LABEL: Record<ParsedRowStatus, string> = {
  ok: 'OK',
  matched: 'Matched',
  unmatched: 'Unmatched',
  missing_order_id: 'No order ID',
  account_level_fee: 'Account-level fee',
  blocked: 'Blocked',
  review: 'Review',
  unknown: 'Unknown',
}

export function RowStatusPill({ status }: { status: ParsedRowStatus }) {
  const cls = ROW_STATUS_CLASS[status] || 'apc-pill--neutral'
  return <span className={`apc-pill ${cls}`}>{ROW_STATUS_LABEL[status] || status}</span>
}

export function LifecycleBadge({ status }: { status?: string }) {
  const key = status || 'draft'
  const cls =
    key === 'posted'
      ? 'apc-pill--success'
      : key === 'approved' || key === 'ready_to_post'
        ? 'apc-pill--info'
        : key === 'force_repost_required'
          ? 'apc-pill--danger'
          : 'apc-pill--neutral'
  return <span className={`apc-pill ${cls}`}>{LIFECYCLE_LABEL[key] || key}</span>
}

export function PivotTable({ preview }: { preview: PaymentClearingPreview }) {
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

export function SettlementLevelFeesTable({ preview }: { preview: PaymentClearingPreview }) {
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

export function AmazonFeeJournalMappingTable({ rows }: { rows: AmazonFeeJournalMapping[] }) {
  if (!rows.length) return <div className="apc-empty">No account-level Amazon fees need manual journal mapping.</div>
  return (
    <div className="apc-table-wrap apc-table-wrap--wide">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Fee type</th>
            <th>Raw transaction type</th>
            <th>Description</th>
            <th>Row count</th>
            <th className="apc-money">Total amount</th>
            <th>Suggested Zoho debit account</th>
            <th>Suggested Zoho credit account</th>
            <th>Mapping status</th>
            <th>Action / edit mapping</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.feeType || '-'}</td>
              <td>{row.rawTransactionType || '-'}</td>
              <td>{row.description || '-'}</td>
              <td>{row.rowCount}</td>
              <td className="apc-money">{money(row.totalAmount)}</td>
              <td>
                {row.debitAccountName || '-'}
                {row.debitAccountId ? <div className="apc-muted apc-cell-sub">id: {row.debitAccountId}</div> : null}
              </td>
              <td>
                {row.creditAccountName || '-'}
                {row.creditAccountId ? <div className="apc-muted apc-cell-sub">id: {row.creditAccountId}</div> : null}
              </td>
              <td>
                <span className={`apc-pill ${row.mappingStatus === 'needs_mapping' ? 'apc-pill--danger' : 'apc-pill--success'}`}>
                  {row.mappingStatus === 'needs_mapping'
                    ? 'Needs mapping'
                    : row.mappingStatus === 'not_required'
                      ? 'Not required'
                      : 'Mapped'}
                </span>
              </td>
              <td>
                <code className="apc-ref">AMAZON_KSA_FEE_JOURNAL_ACCOUNT_MAP</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AmazonFeeJournalPreviewTable({ rows }: { rows: AmazonFeeJournalLine[] }) {
  if (!rows.length) return <div className="apc-empty">No Amazon fee journal lines in this preview.</div>
  return (
    <div className="apc-table-wrap apc-table-wrap--wide">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Fee type</th>
            <th>Reference Number</th>
            <th>Notes</th>
            <th>Debit</th>
            <th>Credit</th>
            <th className="apc-money">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.feeType}</td>
              <td><code className="apc-ref">{row.referenceNumber || '-'}</code></td>
              <td>{row.notes || '-'}</td>
              <td>{row.debit.accountName || '-'}{row.debit.accountId ? <div className="apc-muted apc-cell-sub">id: {row.debit.accountId}</div> : null}</td>
              <td>{row.credit.accountName || '-'}{row.credit.accountId ? <div className="apc-muted apc-cell-sub">id: {row.credit.accountId}</div> : null}</td>
              <td className="apc-money">{money(Math.abs(row.totalAmount))}</td>
              <td>{row.status}</td>
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

export function SettlementReconciliation({ preview }: { preview: PaymentClearingPreview }) {
  const summary = preview.reconciliationSummary
  const lines = [
    ['Order-Level Net Balance', summary.orderLevelNetBalance],
    ['Refund/Return Impact', summary.refundReturnImpact || 0],
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

export function ReturnCreditNotesTable({ rows, emptyText }: { rows: RefundReturnCreditNoteRow[]; emptyText: string }) {
  if (!rows.length) return <div className="apc-empty">{emptyText}</div>
  return (
    <div className="apc-table-wrap apc-table-wrap--wide">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Amazon Order ID</th>
            <th>Type</th>
            <th className="apc-money">Amazon Refund</th>
            <th>Zoho Invoice</th>
            <th>Zoho Credit Note</th>
            <th className="apc-money">Credit Note Amount</th>
            <th className="apc-money">Difference</th>
            <th>Status</th>
            <th>Blocking Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.orderId}-${row.zohoCreditNoteId || row.blockingReason || idx}`}>
              <td>{row.orderId || '-'}</td>
              <td>{row.rowClass}</td>
              <td className="apc-money">{money(row.amazonRefundAmount)}</td>
              <td>{row.zohoInvoiceNumber || row.zohoInvoiceId || '-'}</td>
              <td>{row.zohoCreditNoteNumber || row.zohoCreditNoteId || '-'}</td>
              <td className="apc-money">{money(row.creditNoteAmount)}</td>
              <td className="apc-money">{money(row.creditNoteDifference)}</td>
              <td>{row.status}</td>
              <td>{row.blockingReason || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AmountDifferencesTable({ preview }: { preview: PaymentClearingPreview }) {
  const rows = preview.amountDifferences || []
  if (!rows.length) return <div className="apc-empty">No matched orders differ from their Zoho invoice total above 0.01.</div>
  return (
    <div className="apc-table-wrap">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Amazon Order ID</th>
            <th>Zoho Invoice</th>
            <th className="apc-money">Amazon Order Total</th>
            <th className="apc-money">Zoho Invoice Total</th>
            <th className="apc-money">Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.orderId}>
              <td>{row.orderId}</td>
              <td>{row.zohoInvoiceNumber || row.zohoInvoiceId || '-'}</td>
              <td className="apc-money">{money(row.amazonOrderTotal)}</td>
              <td className="apc-money">{money(row.zohoInvoiceTotal)}</td>
              <td className="apc-money">{money(row.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DifferencesTable({ preview }: { preview: PaymentClearingPreview }) {
  const creditNoteDiffs = preview.matchedReturns?.filter((row) => Math.abs(Number(row.creditNoteDifference) || 0) > 0.01) || []
  const rows = [
    {
      label: 'Settlement reconciliation',
      difference: preview.reconciliationSummary.reconciliationDifference,
      status: preview.reconciliationSummary.reconciliationStatus,
      reason: preview.reconciliationSummary.reconciliationStatus === 'mismatch' ? 'Settlement total does not match expected deposit.' : '',
    },
    ...creditNoteDiffs.map((row) => ({
      label: `Credit note ${row.zohoCreditNoteNumber || row.orderId}`,
      difference: row.creditNoteDifference || 0,
      status: row.status,
      reason: row.blockingReason || '',
    })),
  ].filter((row) => Math.abs(Number(row.difference) || 0) > 0.01)

  if (!rows.length) return <div className="apc-empty">No blocking differences above 0.01.</div>
  return (
    <div className="apc-table-wrap">
      <table className="apc-table">
        <thead>
          <tr>
            <th>Check</th>
            <th className="apc-money">Difference</th>
            <th>Status</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td className="apc-money">{money(row.difference)}</td>
              <td>{row.status}</td>
              <td>{row.reason || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MatchedOrdersTable({ preview }: { preview: PaymentClearingPreview }) {
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
              <td>
                <span className="apc-match-check" aria-label="Matched" title="Matched">✓</span>
                {row.orderId}
              </td>
              <td>{row.zohoInvoiceNumber || '-'}</td>
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

export function UnmatchedOrdersTable({ preview }: { preview: PaymentClearingPreview }) {
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

export function PaymentClearingPreviewTable({ paymentPreview }: { paymentPreview: PaymentClearingPaymentPreview }) {
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
      {paymentPreview.refundReturnCreditNoteApplications?.length ? (
        <>
          <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Refund/Return Credit Note Applications</h3>
          <ReturnCreditNotesTable
            rows={paymentPreview.refundReturnCreditNoteApplications.map((row) => ({
              rowClass: 'refund' as const,
              category: 'Refund / Return',
              orderId: row.orderId,
              amazonRefundAmount: row.amazonRefundAmount,
              transactionType: '',
              amountType: '',
              amountDescription: '',
              zohoInvoiceId: row.zohoInvoiceId,
              zohoInvoiceNumber: row.zohoInvoiceNumber,
              zohoCreditNoteId: row.zohoCreditNoteId,
              zohoCreditNoteNumber: row.zohoCreditNoteNumber,
              creditNoteAmount: row.creditNoteAmount,
              creditNoteDifference: row.difference,
              status: row.status === 'matched' ? ('matched' as const) : ('blocked' as const),
              blockingReason: row.blockingReason,
            }))}
            emptyText="No refund/return credit-note applications."
          />
        </>
      ) : null}
      {paymentPreview.adjustmentClearings?.length ? (
        <>
          <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Adjustment Clearing</h3>
          <div className="apc-table-wrap">
            <table className="apc-table">
              <thead>
                <tr>
                  <th>Amazon Order ID</th>
                  <th>Amount Type</th>
                  <th>Description</th>
                  <th className="apc-money">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {paymentPreview.adjustmentClearings.map((row) => (
                  <tr key={row.key}>
                    <td>{row.orderId || '-'}</td>
                    <td>{row.amountType || '-'}</td>
                    <td>{row.amountDescription || '-'}</td>
                    <td className="apc-money">{money(row.originalAmount)}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}

export function PostingResultTable({ result }: { result: PaymentPostingResult }) {
  return (
    <div className="apc-step-stack">
      <div className="apc-table-wrap apc-table-wrap--wide">
        <p className="apc-muted apc-table-caption">Exactly what Zoho will receive for each grouped Record Payment.</p>
        <table className="apc-table">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Zoho account</th>
              <th className="apc-money">Amount</th>
              <th>Reference (sent to Zoho)</th>
              <th>Description (sent to Zoho)</th>
              <th>Invoice allocations</th>
              <th>Status</th>
              <th>Zoho Payment ID</th>
            </tr>
          </thead>
          <tbody>
            {result.payments.map((row) => {
              const reference = row.zohoPayloadPreview?.reference_number || row.referenceNumber || '-'
              const description = row.zohoPayloadPreview?.description || row.description || ''
              const accountName = row.zohoPayloadPreview?.account_name || row.accountName || ''
              const accountId = row.zohoPayloadPreview?.account_id || ''
              return (
                <tr key={`${row.invoiceId}-${row.paymentType}`}>
                  <td>{row.entryLabel || row.paymentLabel || row.paymentType}</td>
                  <td>
                    {accountName || '-'}
                    {accountId ? <div className="apc-muted apc-cell-sub">id: {accountId}</div> : null}
                  </td>
                  <td className="apc-money">{money(row.zohoPayloadPreview?.amount ?? row.amount)}</td>
                  <td><code className="apc-ref">{reference}</code></td>
                  <td>{description ? <pre className="apc-description">{description}</pre> : '-'}</td>
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
              )
            })}
          </tbody>
        </table>
      </div>
      {result.journals?.length ? (
        <div className="apc-table-wrap apc-table-wrap--wide">
          <p className="apc-muted apc-table-caption">Exactly what Zoho will receive for each Amazon fee manual journal.</p>
          <table className="apc-table">
            <thead>
              <tr>
                <th>Fee type</th>
                <th className="apc-money">Amount</th>
                <th>Reference</th>
                <th>Notes</th>
                <th>Journal lines</th>
                <th>Status</th>
                <th>Zoho Journal ID</th>
              </tr>
            </thead>
            <tbody>
              {result.journals.map((row) => (
                <tr key={row.key || row.paymentType}>
                  <td>{row.feeType}</td>
                  <td className="apc-money">{money(Math.abs(row.totalAmount))}</td>
                  <td><code className="apc-ref">{row.zohoPayloadPreview?.reference_number || row.referenceNumber || '-'}</code></td>
                  <td>{row.zohoPayloadPreview?.notes || row.notes || '-'}</td>
                  <td>
                    {row.zohoPayloadPreview?.line_items?.length ? (
                      <div className="apc-allocation-list">
                        {row.zohoPayloadPreview.line_items.map((line) => (
                          <div key={`${row.key}-${line.debit_or_credit}`}>
                            {line.debit_or_credit}: {line.account_name || line.account_id} {money(line.amount)}
                          </div>
                        ))}
                      </div>
                    ) : '-'}
                  </td>
                  <td>{row.status}</td>
                  <td>{row.zohoJournalId || row.reason || row.error || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

export function SettlementReferenceCard({
  reference,
  postingReferences,
}: {
  reference?: SettlementReference
  postingReferences?: PostingReference[]
}) {
  if (!reference) return null
  return (
    <section className="apc-ref-card">
      <div className="apc-ref-card__head">
        <div>
          <div className="apc-ref-card__eyebrow">Zoho reference for this settlement</div>
          <div className="apc-ref-card__base"><code className="apc-ref">{reference.referenceBase}</code></div>
        </div>
        <dl className="apc-ref-card__meta">
          {reference.periodText ? (
            <div><dt>Period</dt><dd>{reference.periodText}</dd></div>
          ) : null}
          {reference.settlementId ? (
            <div><dt>Settlement ID</dt><dd>{reference.settlementId}</dd></div>
          ) : null}
          {reference.reportId ? (
            <div><dt>Report ID</dt><dd>{reference.reportId}</dd></div>
          ) : null}
        </dl>
      </div>
      {Array.isArray(postingReferences) && postingReferences.length ? (
        <div className="apc-table-wrap apc-table-wrap--wide">
          <table className="apc-table">
            <thead>
              <tr>
                <th>Entry</th>
                <th>Zoho account</th>
                <th className="apc-money">Amount</th>
                <th>Reference (sent to Zoho)</th>
                <th>Description (sent to Zoho)</th>
              </tr>
            </thead>
            <tbody>
              {postingReferences.map((row) => (
                <tr key={row.paymentType}>
                  <td>{row.entryLabel}</td>
                  <td>{row.depositToAccountName} <span className="apc-muted">({row.depositToAccountCode})</span></td>
                  <td className="apc-money">{money(row.amount)}</td>
                  <td><code className="apc-ref">{row.referenceNumber}</code></td>
                  <td><pre className="apc-description">{row.description}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

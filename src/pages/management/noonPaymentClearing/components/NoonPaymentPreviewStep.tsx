import { useState } from 'react'
import type {
  NoonLineSection,
  NoonLineType,
  NoonPaymentClearingPreview,
  NoonPaymentPreview,
} from '../../../../api/noonPaymentClearing'

function money(value: unknown) {
  const v = Number(value)
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const VAT_POLICY_LABEL: Record<string, string> = {
  none: 'No VAT',
  component_sum: 'VAT from fee columns',
  total_gross: 'VAT from Total',
  deferred_to_reclass: 'VAT at reclass',
}

const MECHANISM_LABEL: Record<string, string> = {
  record_payment: 'Record Payment',
  fee_journal: 'Fee journal',
  settlement_adjustment_journal: 'Adjustment journal',
  credit_note_refund: 'Credit note refund',
  return_fee_journal: 'Return fee journal',
  folded_into_invoice_payment: 'Folded into invoice payment',
  none: 'Not posted',
}

function LineTypeCard({ lineType }: { lineType: NoonLineType }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`npc-linetype${lineType.isGap ? ' npc-linetype--gap' : ''}`}>
      <div className="npc-linetype__head">
        <div>
          <strong>{lineType.label}</strong>
          {lineType.isGap ? <span className="npc-linetype__flag">no posting path</span> : null}
          <div className="npc-muted">{lineType.description}</div>
          <div className="npc-muted">
            {MECHANISM_LABEL[lineType.mechanism] || lineType.mechanism}
            {' · '}
            {VAT_POLICY_LABEL[lineType.vatPolicy] || lineType.vatPolicy}
            {lineType.glAccounts.length ? ` · ${lineType.glAccounts.join(' / ')}` : ''}
          </div>
        </div>
        <div className="npc-linetype__totals">
          <div className="npc-money">{money(lineType.totalAmount)}</div>
          <div className="npc-muted">
            {lineType.rowCount} row{lineType.rowCount === 1 ? '' : 's'} · VAT {money(lineType.totalVat)}
          </div>
        </div>
      </div>
      <button type="button" className="npc-btn npc-btn--ghost" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Show'} rows ({lineType.rowCount})
      </button>
      {open ? (
        <div className="npc-table-wrap">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Order</th>
                <th>Zoho invoice</th>
                <th>Net proceeds</th>
                <th>Total</th>
                <th>VAT</th>
              </tr>
            </thead>
            <tbody>
              {lineType.rows.map((row, idx) => (
                <tr key={`lt-${lineType.id}-${row.rowNumber ?? idx}`}>
                  <td>{row.rowNumber ?? '—'}</td>
                  <td>
                    <code className="npc-ref">{row.itemOrderId || row.parentOrderId || row.title || '—'}</code>
                    {row.excluded ? <div className="npc-muted">excluded from payment</div> : null}
                  </td>
                  <td>{row.zohoInvoiceNumber || '—'}</td>
                  <td className="npc-money">{money(row.netProceed)}</td>
                  <td className="npc-money">{money(row.total)}</td>
                  <td className="npc-money">{money(row.vat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function LineSection({ section }: { section: NoonLineSection }) {
  return (
    <section className="npc-linesection">
      <div className="npc-linesection__head">
        <h3>{section.label}</h3>
        <div className="npc-linesection__totals">
          <span className="npc-money">{money(section.totalAmount)}</span>
          <span className="npc-muted">
            {section.rowCount} row{section.rowCount === 1 ? '' : 's'} · VAT {money(section.totalVat)}
          </span>
        </div>
      </div>
      {section.lineTypes.map((lineType) => (
        <LineTypeCard key={lineType.id} lineType={lineType} />
      ))}
    </section>
  )
}

/**
 * Every statement row grouped by what the backend decided it is.
 *
 * The sections and their contents come entirely from the line type registry, so
 * adding a type there surfaces it here with no change to this file.
 */
function StatementByLineType({ paymentPreview }: { paymentPreview: NoonPaymentPreview }) {
  const breakdown = paymentPreview.lineTypeBreakdown
  if (!breakdown?.sections?.length) return null
  return (
    <>
      <h3>Statement by line type</h3>
      <p className="npc-muted">
        Every row in the statement, grouped by the treatment the engine resolved for it. Each type
        shows how it reaches Zoho and how its VAT is handled.
      </p>
      {breakdown.unroutedRowCount > 0 ? (
        <div className="npc-alert npc-alert--error" role="alert">
          {breakdown.unroutedRowCount} row(s) have no posting path. They affect the expected
          Undeposited balance but nothing plans for them.
        </div>
      ) : null}
      {breakdown.sections.map((section) => (
        <LineSection key={section.section} section={section} />
      ))}
    </>
  )
}

export function NoonPaymentPreviewStep({
  preview,
  paymentPreview,
  error,
  loading,
  isApproved,
  isPosted,
  onGeneratePaymentPreview,
}: {
  preview: NoonPaymentClearingPreview | null
  paymentPreview: NoonPaymentPreview | null
  error: string | null
  loading: boolean
  isApproved: boolean
  isPosted: boolean
  onGeneratePaymentPreview: () => void
}) {
  const [showSettlementAdjustmentDetail, setShowSettlementAdjustmentDetail] = useState(false)

  return (
    <div className="npc-step-stack">
      {error ? (
        <div className="npc-alert npc-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      <button
        type="button"
        className="ainv-btn ainv-btn--primary-sky"
        disabled={(!isApproved && !isPosted) || loading}
        onClick={onGeneratePaymentPreview}
      >
        {loading ? 'Generating…' : 'Generate payment preview'}
      </button>
      {!isApproved && !isPosted ? (
        <p className="npc-muted">
          Statement is not approved yet (status: {String(preview?.status || preview?.batch?.status || '—')}).
          Go to <strong>Step 9</strong> and click Approve settlement.
        </p>
      ) : !paymentPreview ? (
        <p className="npc-muted">
          Settlement is approved. Click <strong>Generate payment preview</strong> above.
        </p>
      ) : null}
      {paymentPreview ? (
        <>
          <div className="npc-summary-grid">
            <div className="ainv-summary-card">
              <span>Invoice payments</span>
              <strong>{money(paymentPreview.summary.totalInvoicePayments)}</strong>
            </div>
            <div className="ainv-summary-card">
              <span>Statement fee journals</span>
              <strong>{money(paymentPreview.summary.totalFeesJournals)}</strong>
            </div>
            <div className="ainv-summary-card">
              <span>Expected settlement</span>
              <strong>{money(paymentPreview.summary.expectedNoonSettlement)}</strong>
            </div>
            {paymentPreview.summary.targetUndeposited1066 != null ? (
              <div className="ainv-summary-card">
                <span>Undeposited target (1066, pre-advertising)</span>
                <strong>{money(paymentPreview.summary.targetUndeposited1066)}</strong>
                <div className="npc-muted">
                  planned {money(paymentPreview.summary.plannedUndeposited1066)}
                </div>
              </div>
            ) : null}
            {(paymentPreview.summary.settlementAdjustmentLineCount ?? 0) > 0 ? (
              <div className="ainv-summary-card">
                <span>Settlement adjustment journal (1066)</span>
                <strong>{money(paymentPreview.summary.settlementAdjustment1066)}</strong>
                <div className="npc-muted">
                  {paymentPreview.summary.settlementAdjustmentLineCount ?? 0} source row(s) · gross −
                  {money(paymentPreview.summary.settlementAdjustmentGrossNegative)} / +
                  {money(paymentPreview.summary.settlementAdjustmentGrossPositive)}
                </div>
              </div>
            ) : null}
            {(paymentPreview.summary.paidInvoiceSubsidyLineCount ?? 0) > 0 ? (
              <div className="ainv-summary-card">
                <span>Paid-invoice subsidies (in adjustment journal)</span>
                <strong>{money(paymentPreview.summary.paidInvoiceSubsidy1066)}</strong>
                <div className="npc-muted">
                  {paymentPreview.summary.paidInvoiceSubsidyLineCount ?? 0} line(s) · Dr 1066 / Cr expense
                </div>
              </div>
            ) : null}
            {(paymentPreview.summary.inStatementShippingToUncleared ?? 0) > 0 ? (
              <div className="ainv-summary-card">
                <span>In-statement shipping → 1068 (uncleared)</span>
                <strong>{money(paymentPreview.summary.inStatementShippingToUncleared)}</strong>
                <div className="npc-muted">
                  {paymentPreview.summary.inStatementShippingLineCount ?? 0} invoice line(s) · reclass
                  journal gross {money(paymentPreview.summary.shippingReclassJournalGross)}
                </div>
              </div>
            ) : null}
          </div>

          <StatementByLineType paymentPreview={paymentPreview} />

          {(paymentPreview.summary.returnRowCount ?? 0) > 0 ? (
            <>
              <h3>Returns &amp; return fee reversals</h3>
              {paymentPreview.summary.returnBlocked ? (
                <div className="npc-alert npc-alert--error" role="alert">
                  RETURN BLOCKED — matched Credit Note required before posting (
                  {(paymentPreview.creditNoteBlockingRows || [])[0]?.blockCode || 'RETURN_CREDIT_NOTE_MISSING'}
                  ).
                </div>
              ) : null}
              <div className="npc-summary-grid">
                <div className="ainv-summary-card">
                  <span>Product refund (CN → 1066)</span>
                  <strong>{money(paymentPreview.summary.returnPrincipal1066)}</strong>
                </div>
                <div className="ainv-summary-card">
                  <span>Commission reversal (1066)</span>
                  <strong>{money(paymentPreview.summary.returnFeeReversal1066)}</strong>
                </div>
              </div>
              <div className="npc-table-wrap">
                <table className="npc-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Refund</th>
                      <th>Comm. gross</th>
                      <th>Comm. net</th>
                      <th>VAT</th>
                      <th>Net settlement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(paymentPreview.returns || []).map((row) => (
                      <tr key={`pv-ret-${row.itemOrderId}`}>
                        <td>
                          <code className="npc-ref">{row.itemOrderId}</code>
                        </td>
                        <td className="npc-money">{money(row.productRefundAmount)}</td>
                        <td className="npc-money">
                          {money(
                            paymentPreview.returnFeeReversals?.find((r) => r.itemOrderId === row.itemOrderId)
                              ?.commissionReversalGross
                          )}
                        </td>
                        <td className="npc-money">
                          {money(
                            paymentPreview.returnFeeReversals?.find((r) => r.itemOrderId === row.itemOrderId)
                              ?.commissionReversalNet
                          )}
                        </td>
                        <td className="npc-money">
                          {money(
                            paymentPreview.returnFeeReversals?.find((r) => r.itemOrderId === row.itemOrderId)
                              ?.commissionReversalVat
                          )}
                        </td>
                        <td className="npc-money">{money(row.netSettlementEffect)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <h3>Invoice payments (Net 1066 / Commission 1067 / Shipping 1068)</h3>
          <p className="npc-muted">
            Noon CSV &quot;Net Proceeds&quot; is invoice gross. 1066 gets the residual after commission and
            shipping (e.g. 759 − 119.54 − 33.60 = 605.86). Zoho gets exactly three grouped payments
            (net / commission / shipping) — not one payment per invoice line.
          </p>
          {(paymentPreview.summary?.invoiceOverpaymentCount ?? 0) > 0 ? (
            <div className="npc-alert npc-alert--error" role="alert">
              Blocked: payment totals exceed Zoho invoice value on{' '}
              {paymentPreview.summary.invoiceOverpaymentCount} invoice(s). Fix matching / logistics
              before posting.
            </div>
          ) : null}
          {paymentPreview.summary?.blocked &&
          Math.abs(Number(paymentPreview.summary.undepositedPlanningDifference) || 0) >= 0.01 &&
          (paymentPreview.summary.invoiceOverpaymentCount ?? 0) === 0 ? (
            <div className="npc-alert npc-alert--error" role="alert">
              Blocked: Noon undeposited reconciliation differs by AED{' '}
              {money(Math.abs(Number(paymentPreview.summary.undepositedPlanningDifference) || 0))}. Target{' '}
              {money(paymentPreview.summary.targetUndeposited1066)} vs planned{' '}
              {money(paymentPreview.summary.plannedUndeposited1066)}.
              {Array.isArray(paymentPreview.undepositedReconciliation?.nonZeroDeltas) &&
              paymentPreview.undepositedReconciliation.nonZeroDeltas.length > 0 ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: '1.2rem' }}>
                  {paymentPreview.undepositedReconciliation.nonZeroDeltas.slice(0, 8).map((row) => (
                    <li key={`delta-${String(row.rowNumber)}`}>
                      Row {String(row.rowNumber)} · {String(row.itemOrderId || row.parentOrderId)} · delta{' '}
                      {money(Number(row.delta) || 0)} · {String(row.reason || '')}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="npc-table-wrap">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Item Order</th>
                  <th>Zoho Invoice</th>
                  <th>Net undeposited (1066)</th>
                  <th>Commission (1067)</th>
                  <th>Shipping / Fulfillment (1068)</th>
                  <th>Total (must = invoice)</th>
                </tr>
              </thead>
              <tbody>
                {paymentPreview.invoicePayments.map((p) => (
                  <tr key={p.itemOrderId}>
                    <td>
                      <code className="npc-ref">{p.itemOrderId}</code>
                      {p.parentLogisticsAddOn ? (
                        <div className="npc-muted">
                          incl. parent/adj logistics {money(p.parentLogisticsAddOn)}
                          {Array.isArray(p.parentLogisticsSources) && p.parentLogisticsSources[0]
                            ? ` (row ${p.parentLogisticsSources[0].rowNumber}: total ${money(p.parentLogisticsSources[0].total)})`
                            : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {p.zohoInvoiceNumber}
                      {p.invoiceTotal != null ? (
                        <div className="npc-muted">{money(p.invoiceTotal)}</div>
                      ) : null}
                    </td>
                    <td className="npc-money">
                      {money(p.netBalancePayment?.amount ?? p.invoiceClearingNetBalance)}
                    </td>
                    <td className="npc-money">
                      {money(p.commissionPayment?.amount ?? p.referralFee)}
                    </td>
                    <td className="npc-money">
                      {money(p.fulfillmentPayment?.amount ?? p.fulfillmentShipping)}
                      {p.parentLogisticsOrphanAddOn ? (
                        <div className="npc-muted">
                          incl. orphan logistics {money(p.parentLogisticsOrphanAddOn)}
                        </div>
                      ) : null}
                    </td>
                    <td className="npc-money">{money(p.totalClearingAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Parent / adjustment logistics (folded into invoice payments → uncleared)</h3>
          <p className="npc-muted">
            Parent shipping lines with no sale in this statement are matched to existing Noon Zoho
            invoices by order id (no Excel upload). &quot;No child assignment&quot; means Zoho also has no
            invoice for that Noon parent order.
          </p>
          <div className="npc-table-wrap">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Charge</th>
                  <th>Amount</th>
                  <th>Clearing detail</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...(paymentPreview.parentLevelCharges || []),
                  ...(paymentPreview.adjustmentClearings || []).filter(
                    (line) => line.clearingPath === 'invoice_payment_uncleared'
                  ),
                ].map((line, idx) => (
                  <tr key={`folded-${idx}`}>
                    <td>
                      <strong>{String(line.displayLabel || line.feeType || '')}</strong>
                      {line.accountingTreatment ? (
                        <div className="npc-muted">{String(line.accountingTreatment)}</div>
                      ) : null}
                    </td>
                    <td className="npc-money">
                      {money(Number(line.signedAmount != null ? line.signedAmount : line.amount) || 0)}
                    </td>
                    <td>
                      {line.previewNote ? (
                        <span className="npc-muted">{String(line.previewNote)}</span>
                      ) : (
                        String(line.parentOrderId || '—')
                      )}
                    </td>
                  </tr>
                ))}
                {(paymentPreview.parentLevelCharges || []).length === 0 &&
                (paymentPreview.adjustmentClearings || []).filter(
                  (line) => line.clearingPath === 'invoice_payment_uncleared'
                ).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="npc-empty">
                      No parent/adjustment logistics folded into payments.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <h3>Uncleared → expense reclass (same post)</h3>
          <p className="npc-muted">
            After payments park amounts on 1067 / 1068, journals move them to Commission Exp (2143) /
            Shipping Exp (2162) and Input VAT (1085).
          </p>
          <div className="npc-table-wrap">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Reclass</th>
                  <th>Gross / Expense after VAT / Input VAT</th>
                  <th>Journal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(paymentPreview.unclearedReclassJournals || []).map((line, idx) => (
                  <tr key={`reclass-${idx}`}>
                    <td>
                      <strong>{String(line.displayLabel || line.feeType || '')}</strong>
                    </td>
                    <td className="npc-money">
                      <div>Gross: {money(line.grossInclVat ?? line.signedAmount)}</div>
                      <div>Expense after VAT: {money(line.netExpense)}</div>
                      <div>Input VAT 5%: {money(line.inputVatAmount)}</div>
                    </td>
                    <td>
                      {line.accountingPreview?.lines && line.accountingPreview.lines.length > 0 ? (
                        <div className="npc-muted">
                          {line.accountingPreview.lines.map((jl, i) => (
                            <div key={`${idx}-${i}`}>
                              {String(jl.debitOrCredit || '').toUpperCase()}: {String(jl.accountName || '—')}{' '}
                              {money(jl.amount)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{line.mappingStatus === 'mapped' ? 'Ready' : 'Needs accounts'}</td>
                  </tr>
                ))}
                {(paymentPreview.unclearedReclassJournals || []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="npc-empty">
                      No uncleared commission/shipping to reclass.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {paymentPreview.settlementAdjustmentJournal ? (
            <>
              <h3>Settlement adjustment journal (cross-week charges)</h3>
              <p className="npc-muted">
                Zero-sale shipping/logistics from prior weeks — not Record Payment. One journal per
                statement with per-order expense/VAT detail; aggregated Cr/Dr 1066.
              </p>
              <div className="npc-table-wrap">
                <table className="npc-table">
                  <thead>
                    <tr>
                      <th>Journal</th>
                      <th>Net 1066 impact</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>
                          {String(
                            paymentPreview.settlementAdjustmentJournal.displayLabel ||
                              'Noon Settlement Adjustments'
                          )}
                        </strong>
                        <div className="npc-muted">
                          {String(paymentPreview.settlementAdjustmentJournal.accountingTreatment || '')}
                        </div>
                        {paymentPreview.settlementAdjustmentJournal.referenceNumber ? (
                          <div className="npc-muted">
                            Ref: {String(paymentPreview.settlementAdjustmentJournal.referenceNumber)}
                          </div>
                        ) : null}
                      </td>
                      <td className="npc-money">
                        {money(Number(paymentPreview.summary.settlementAdjustment1066) || 0)}
                      </td>
                      <td className="npc-muted">
                        {paymentPreview.summary.settlementAdjustmentLineCount ?? 0} rows · expense{' '}
                        {money(paymentPreview.summary.settlementAdjustmentNetExpense)} · VAT{' '}
                        {money(paymentPreview.summary.settlementAdjustmentInputVat)}
                        {paymentPreview.settlementAdjustmentJournal?.journalAudit ? (
                          <div>
                            Journal balance: debits{' '}
                            {money(paymentPreview.settlementAdjustmentJournal.journalAudit.totalDebits)} · credits{' '}
                            {money(paymentPreview.settlementAdjustmentJournal.journalAudit.totalCredits)} · diff{' '}
                            {money(paymentPreview.settlementAdjustmentJournal.journalAudit.difference)}
                            {paymentPreview.settlementAdjustmentJournal.journalAudit.balanced
                              ? ' ✓'
                              : ' — blocked'}
                          </div>
                        ) : null}
                        <div>{String(paymentPreview.settlementAdjustmentJournal.previewNote || '')}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="npc-btn npc-btn--ghost"
                onClick={() => setShowSettlementAdjustmentDetail((v) => !v)}
              >
                {showSettlementAdjustmentDetail ? 'Hide' : 'View'} source order detail (
                {paymentPreview.settlementAdjustmentLines?.length ??
                  paymentPreview.settlementAdjustmentJournal.sourceLineCount ??
                  0}
                )
              </button>
              {showSettlementAdjustmentDetail ? (
                <div className="npc-table-wrap">
                  <table className="npc-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Parent / Item order</th>
                        <th>Type</th>
                        <th>Gross</th>
                        <th>Net expense</th>
                        <th>VAT</th>
                        <th>Expense acct</th>
                        <th>Related invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(paymentPreview.settlementAdjustmentLines ||
                        paymentPreview.settlementAdjustmentJournal.sourceLines ||
                        []).map((line, idx) => (
                        <tr key={`adj-${line.rowNumber ?? idx}-${line.assignedItemOrderId ?? line.parentOrderId ?? idx}`}>
                          <td>{line.rowNumber ?? '—'}</td>
                          <td>
                            <code className="npc-ref">{line.parentOrderId || '—'}</code>
                            {line.assignedItemOrderId ? (
                              <div className="npc-muted">→ {line.assignedItemOrderId}</div>
                            ) : line.itemOrderId ? (
                              <div className="npc-muted">{line.itemOrderId}</div>
                            ) : null}
                          </td>
                          <td>
                            {String(line.displayLabel || 'Adjustment')}
                            {line.paidInvoiceSubsidy ? (
                              <div className="npc-muted">paid-invoice subsidy</div>
                            ) : null}
                          </td>
                          <td className="npc-money">{money(line.signedGrossAmount ?? line.grossAmount)}</td>
                          <td className="npc-money">{money(line.netExpenseAmount)}</td>
                          <td className="npc-money">{money(line.vatAmount)}</td>
                          <td>{line.expenseAccountCode || line.expenseAccountName || '—'}</td>
                          <td>{line.assignedZohoInvoiceNumber || line.assignedZohoInvoiceId || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}

            <h3>Statement fee journals (Advertising etc.)</h3>
            {(paymentPreview.summary.feeJournalVatWarnings || []).map((warning) => (
              <div
                key={`vat-warn-${warning.rowNumber ?? warning.code}`}
                className="npc-alert"
                role="alert"
              >
                Row {warning.rowNumber ?? '—'}: {warning.message}
              </div>
            ))}
          <div className="npc-table-wrap">
            <table className="npc-table">
              <thead>
                <tr>
                  <th>Charge</th>
                  <th>Amount</th>
                  <th>Clearing detail</th>
                </tr>
              </thead>
              <tbody>
                {(paymentPreview.statementLevelCharges || []).map((line, idx) => (
                  <tr key={`stmt-${idx}`}>
                    <td>
                      <strong>{String(line.displayLabel || line.feeType || '')}</strong>
                      {line.accountingTreatment ? (
                        <div className="npc-muted">{String(line.accountingTreatment)}</div>
                      ) : null}
                    </td>
                    <td className="npc-money">
                      {money(Number(line.signedAmount != null ? line.signedAmount : line.amount) || 0)}
                    </td>
                    <td>
                      {line.previewNote ? (
                        <span className="npc-muted">{String(line.previewNote)}</span>
                      ) : (
                        'Fee journal vs Undeposited Funds'
                      )}
                    </td>
                  </tr>
                ))}
                {(paymentPreview.statementLevelCharges || []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="npc-empty">
                      No statement fee journals.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}

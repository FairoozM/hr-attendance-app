import { AmazonFeeJournalPreviewTable, money, PaymentClearingPreviewTable, SettlementReferenceCard, SummaryCard } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

export function Step7Preview({ ctx }: { ctx: ClearingContext }) {
  const { preview, paymentPreview } = ctx
  if (!preview) return null
  return (
    <div className="apc-step-stack">
      <div className="apc-alert">
        <strong>This is a preview only.</strong> No Zoho payments are created here. It splits each invoice into net
        balance, commission, shipping/FBA, plus credit-note application and adjustment clearing.
      </div>
      <div className="apc-button-row">
        <button
          className="ainv-btn ainv-btn--primary-sky"
          type="button"
          onClick={ctx.onGeneratePaymentPreview}
          disabled={!ctx.canGeneratePaymentPreview || ctx.generatingPaymentPreview}
        >
          {ctx.generatingPaymentPreview ? 'Generating...' : 'Generate Payment Preview'}
        </button>
      </div>
      {!ctx.canGeneratePaymentPreview ? (
        <p className="apc-muted">
          Payment preview requires an approved, reconciled batch with zero unmatched orders and no credit-note blockers.
          Unmapped Amazon fee journals can be previewed, but they block posting until mapped.
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
            <SummaryCard label="Refund/Credit Notes" value={money(paymentPreview.paymentPlanSummary.refundReturnCreditNoteApplicationTotal || 0)} />
            <SummaryCard label="Adjustment Clearing" value={money(paymentPreview.paymentPlanSummary.adjustmentClearingTotal || 0)} />
            <SummaryCard label="Amazon Fee Journals" value={money(paymentPreview.paymentPlanSummary.amazonFeeJournalTotal || 0)} />
            <SummaryCard label="Total Clearing" value={money(paymentPreview.paymentPlanSummary.totalPaymentAmount)} />
            <SummaryCard label="Difference" value={money(paymentPreview.paymentPlanSummary.difference)} />
          </section>
          <SettlementReferenceCard
            reference={paymentPreview.settlementReference}
            postingReferences={paymentPreview.postingReferences}
          />
          <PaymentClearingPreviewTable paymentPreview={paymentPreview} />
          <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Amazon Fee Journal Preview</h3>
          <AmazonFeeJournalPreviewTable rows={paymentPreview.amazonFeeJournalLines || []} />
          {paymentPreview.warnings.length ? (
            <div className="apc-alert apc-alert--error">
              <ul>
                {paymentPreview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

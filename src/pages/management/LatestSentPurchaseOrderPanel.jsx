import { Badge } from './PurchasePlanningBadges'
import { computePlanReviewSummary, fmtPrice, formatUploadDate } from './purchasePlanningUtils'

export function LatestSentPurchaseOrderPanel({ plan, summary, onOpenSentPlan, onStartNew }) {
  if (!plan || plan.status !== 'sent_to_zoho') return null

  const review = summary || computePlanReviewSummary(plan)
  const poLabel =
    plan.purchaseOrderNumber?.trim() ||
    plan.zohoPurchaseOrderId?.trim() ||
    '—'
  const sentWhen = plan.updatedAt || plan.createdAt

  return (
    <section className="pp-latest-sent-panel" aria-labelledby="pp-latest-sent-title">
      <div className="pp-latest-sent-panel__head">
        <div>
          <p className="pp-latest-sent-panel__eyebrow">Latest sent purchase order</p>
          <h2 id="pp-latest-sent-title" className="pp-latest-sent-panel__title">
            {plan.planNumber}
          </h2>
        </div>
        <Badge tone="success">Sent to Zoho</Badge>
      </div>
      <dl className="pp-dl pp-dl--wide pp-latest-sent-panel__stats">
        <div>
          <dt>Zoho PO ID</dt>
          <dd>{plan.zohoPurchaseOrderId || '—'}</dd>
        </div>
        <div>
          <dt>PO number</dt>
          <dd>{poLabel}</dd>
        </div>
        <div>
          <dt>Sent / updated</dt>
          <dd>{formatUploadDate(sentWhen)}</dd>
        </div>
        <div>
          <dt>Included lines</dt>
          <dd>{review.includedCount ?? plan.includedCount ?? '—'}</dd>
        </div>
        <div>
          <dt>Total final qty</dt>
          <dd>{review.totalFinalQty ?? plan.totalFinalQty ?? '—'}</dd>
        </div>
        <div>
          <dt>Est. value</dt>
          <dd>{fmtPrice(review.estimatedValue ?? plan.estimatedTotalValue)}</dd>
        </div>
      </dl>
      <div className="pp-latest-sent-panel__actions">
        <button type="button" className="btn btn--primary" onClick={() => onOpenSentPlan(plan.id)}>
          Open Sent Plan
        </button>
        <button type="button" className="btn" onClick={onStartNew}>
          Start New Purchase Plan
        </button>
      </div>
      <p className="pp-hint">
        This plan is locked in Zoho. Upload a new low-stock file to start another batch — previous sent plans stay in
        history below.
      </p>
    </section>
  )
}

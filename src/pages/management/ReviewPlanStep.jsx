import { Badge } from './PurchasePlanningBadges'
import { PurchasePlanTable } from './PurchasePlanTable'
import { computePlanReviewSummary, fmtPrice } from './purchasePlanningUtils'

export function ReviewPlanStep({
  plan,
  filters,
  onFiltersChange,
  onItemChange,
  onRefreshZohoData,
  refreshBusy,
  readOnly,
  plans,
  onOpenPlan,
  onDeletePlan,
  deleteBusy,
}) {
  const summary = computePlanReviewSummary(plan)
  const draftPlans = (plans || []).filter((p) => p.status === 'draft')

  if (!plan) {
    return (
      <div className="pp-step-content">
        <p className="pp-hint">Generate a draft plan in Step 4, or open an existing draft below.</p>
        {draftPlans.length > 0 && (
          <div className="pp-plan-list">
            {draftPlans.map((p) => (
              <button key={p.id} type="button" className="pp-plan-card" onClick={() => onOpenPlan(p.id)}>
                <strong>{p.planNumber}</strong>
                <span>{p.itemsCount} items</span>
                <Badge tone="warning">draft</Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const isSent = plan.status === 'sent_to_zoho'
  const isReadOnly = readOnly || isSent

  return (
    <div className="pp-step-content">
      <div className="pp-plan-header-bar">
        <div>
          <h3>{plan.planNumber}</h3>
          <Badge tone={isSent ? 'success' : plan.status === 'failed' ? 'danger' : 'warning'}>{plan.status}</Badge>
          {plan.zohoPurchaseOrderId && <span className="pp-hint">Zoho PO: {plan.zohoPurchaseOrderId}</span>}
        </div>
        {plan.status === 'draft' && onRefreshZohoData && (
          <div className="pp-secondary-actions">
            <button type="button" className="btn" disabled={refreshBusy} onClick={onRefreshZohoData}>
              {refreshBusy ? 'Refreshing…' : 'Refresh Zoho Data'}
            </button>
          </div>
        )}
      </div>

      {plan.status === 'draft' && (
        <p className="pp-hint pp-hint--warn">
          Refresh Zoho Data may overwrite manual quantity edits. Refresh currently uses the <strong>latest</strong> Vigil
          upload, not necessarily the upload stored on this plan.
        </p>
      )}

      {isReadOnly && (
        <p className="pp-hint pp-hint--warn">This plan was sent to Zoho and is read-only. Create a new batch to plan again.</p>
      )}

      <div className="doc-summary-cards pp-review-summary">
        <div className="doc-summary-card doc-summary-card--total">
          <span className="doc-summary-card__count">{summary.totalSkus}</span>
          <span className="doc-summary-card__label">Total SKUs</span>
        </div>
        <div className="doc-summary-card doc-summary-card--ok">
          <span className="doc-summary-card__count">{summary.includedCount}</span>
          <span className="doc-summary-card__label">Included</span>
        </div>
        <div className="doc-summary-card doc-summary-card--due-soon">
          <span className="doc-summary-card__count">{summary.excludedCount}</span>
          <span className="doc-summary-card__label">Excluded</span>
        </div>
        <div className="doc-summary-card doc-summary-card--urgent">
          <span className="doc-summary-card__count">{summary.totalFinalQty}</span>
          <span className="doc-summary-card__label">Final qty</span>
        </div>
        <div className="doc-summary-card doc-summary-card--total">
          <span className="doc-summary-card__count">{fmtPrice(summary.estimatedValue)}</span>
          <span className="doc-summary-card__label">Est. value</span>
        </div>
        <div className="doc-summary-card doc-summary-card--expired">
          <span className="doc-summary-card__count">{summary.missingPricesCount}</span>
          <span className="doc-summary-card__label">Missing prices</span>
        </div>
        <div className="doc-summary-card doc-summary-card--due-soon">
          <span className="doc-summary-card__count">{summary.cappedByVigilCount}</span>
          <span className="doc-summary-card__label">Vigil capped</span>
        </div>
      </div>

      {summary.missingPricesCount > 0 && (
        <p className="pp-hint pp-hint--warn">
          {summary.missingPricesCount} included line(s) need purchase price in All Prices before creating a PO.
        </p>
      )}

      <PurchasePlanTable
        plan={plan}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onItemChange={onItemChange}
        readOnly={isReadOnly}
      />

      {plan.status === 'draft' && onDeletePlan && (
        <div className="pp-secondary-actions pp-secondary-actions--danger">
          <button type="button" className="btn" disabled={deleteBusy} onClick={() => onDeletePlan(plan)}>
            Delete draft plan
          </button>
          <p className="pp-hint pp-hint--warn">
            Deleting this draft will not return planned SKUs to pending.
          </p>
        </div>
      )}
    </div>
  )
}

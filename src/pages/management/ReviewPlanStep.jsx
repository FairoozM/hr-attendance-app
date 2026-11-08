import { Badge } from './PurchasePlanningBadges'
import { PurchasePlanTable } from './PurchasePlanTable'
import { computePlanReviewSummary, computePoReadiness, fmtPrice, isEditablePlanStatus } from './purchasePlanningUtils'

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
  onContinueToPo,
  currentStep,
  pricesReady = true,
}) {
  const summary = computePlanReviewSummary(plan)
  const poReadiness = computePoReadiness(plan, { pricesReady })
  const editable = isEditablePlanStatus(plan?.status)
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
  const isReadOnly = readOnly || !editable

  return (
    <div className="pp-step-content">
      <div className="pp-plan-header-bar">
        <div>
          <h3>{plan.planNumber}</h3>
          <Badge tone={isSent ? 'success' : plan.status === 'failed' ? 'danger' : 'warning'}>{plan.status}</Badge>
          {plan.zohoPurchaseOrderId && <span className="pp-hint">Zoho PO: {plan.zohoPurchaseOrderId}</span>}
        </div>
        {editable && onRefreshZohoData && (
          <div className="pp-secondary-actions">
            <button type="button" className="btn" disabled={refreshBusy} onClick={onRefreshZohoData}>
              {refreshBusy ? 'Refreshing…' : 'Refresh Zoho Data'}
            </button>
          </div>
        )}
      </div>

      {editable && (
        <p className="pp-hint pp-hint--warn">
          Refresh Zoho Data may overwrite manual quantity edits. It uses the latest Vigil upload.
        </p>
      )}

      {isSent && (
        <div className="pp-readonly-banner" role="status">
          This purchase plan has already been sent to Zoho and is read-only.
        </div>
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
        <div className="doc-summary-card doc-summary-card--expired">
          <span className="doc-summary-card__count">{summary.inactiveCount}</span>
          <span className="doc-summary-card__label">Inactive in Zoho</span>
        </div>
        <div className="doc-summary-card doc-summary-card--due-soon">
          <span className="doc-summary-card__count">{summary.cappedByVigilCount}</span>
          <span className="doc-summary-card__label">Vigil capped</span>
        </div>
      </div>

      {plan.status === 'failed' && plan.zohoError && (
        <div className="page-error" role="alert">
          Last Zoho error: {plan.zohoError}
        </div>
      )}

      {!pricesReady && <p className="pp-hint">Purchase prices are still loading from All Prices.</p>}

      {pricesReady && summary.missingPricesCount > 0 && (
        <p className="pp-hint pp-hint--warn">
          {summary.missingPricesCount} included line(s) need a purchase price in All Prices before creating a PO.
        </p>
      )}

      {summary.inactiveCount > 0 && (
        <p className="pp-hint pp-hint--warn">
          {summary.inactiveCount} included line(s) are inactive or deleted in Zoho. Exclude them or reactivate in Zoho
          before creating a PO: {summary.inactiveItems
            .slice(0, 8)
            .map((item) => item.sku)
            .join(', ')}
          {summary.inactiveCount > 8 ? '…' : ''}
        </p>
      )}

      {editable && (
        <p className="pp-hint">
          Quantity and include changes save when you leave a field. Continue when the lines look right.
        </p>
      )}

      <PurchasePlanTable
        plan={plan}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onItemChange={onItemChange}
        readOnly={isReadOnly}
      />

      {editable && onContinueToPo && (
        <div className="pp-continue-po-card">
          <div>
            <strong>Ready for Zoho?</strong>
            <p className="pp-hint">
              {poReadiness.ready
                ? `${poReadiness.includedLines.length} included line(s) · ${summary.totalFinalQty} total qty · ${fmtPrice(summary.estimatedValue)} est. value`
                : 'Fix the issues below before creating a purchase order.'}
            </p>
            {!poReadiness.ready && poReadiness.reasons.length > 0 && (
              <ul className="pp-blocker-list">
                {poReadiness.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!poReadiness.ready}
            onClick={onContinueToPo}
          >
            {currentStep === 6 ? 'PO step is open' : 'Continue to create Zoho PO'}
          </button>
        </div>
      )}

      {plan.status === 'draft' && onDeletePlan && (
        <div className="pp-secondary-actions pp-secondary-actions--danger">
          <button type="button" className="btn" disabled={deleteBusy} onClick={() => onDeletePlan(plan)}>
            Delete draft plan
          </button>
          <p className="pp-hint">
            Deleting this draft puts its planned SKUs back in the pending batch.
          </p>
        </div>
      )}
    </div>
  )
}

import { Badge } from './PurchasePlanningBadges'
import { computePoReadiness, fmtPrice } from './purchasePlanningUtils'

export function CreateZohoPoStep({
  plan,
  purchaseOrderNumber,
  onPurchaseOrderNumberChange,
  onCreatePo,
  busy,
  vendorLabel,
}) {
  const readiness = computePoReadiness(plan)
  const summary = readiness.summary
  const isSent = plan?.status === 'sent_to_zoho'

  if (!plan) {
    return <p className="pp-hint">Complete Steps 1–5 and open a draft plan before creating a Zoho purchase order.</p>
  }

  if (isSent) {
    return (
      <div className="pp-po-success">
        <h3>Purchase order sent</h3>
        <p>
          Plan <strong>{plan.planNumber}</strong> was sent to Zoho successfully.
        </p>
        <dl className="pp-dl">
          <div>
            <dt>Zoho PO ID</dt>
            <dd>{plan.zohoPurchaseOrderId || '—'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <Badge tone="success">sent_to_zoho</Badge>
            </dd>
          </div>
        </dl>
        <p className="pp-hint">This plan is locked. Duplicate PO creation is blocked by the server.</p>
      </div>
    )
  }

  if (plan.status !== 'draft') {
    return (
      <p className="pp-hint pp-hint--warn">
        Only draft plans can create a purchase order. Current status: {plan.status}.
      </p>
    )
  }

  return (
    <div className="pp-step-content">
      <div className="pp-po-confirm-card">
        <h3>Final confirmation</h3>
        <p>Review totals before sending a draft purchase order to Zoho Inventory.</p>
        <dl className="pp-dl pp-dl--wide">
          <div>
            <dt>Plan</dt>
            <dd>{plan.planNumber}</dd>
          </div>
          <div>
            <dt>Vendor</dt>
            <dd>{vendorLabel || 'Configured in server env (ZOHO_PURCHASE_VENDOR_ID)'}</dd>
          </div>
          <div>
            <dt>Included lines</dt>
            <dd>{readiness.includedLines.length}</dd>
          </div>
          <div>
            <dt>Total quantity</dt>
            <dd>{summary.totalFinalQty}</dd>
          </div>
          <div>
            <dt>Estimated total</dt>
            <dd>{fmtPrice(summary.estimatedValue)}</dd>
          </div>
          <div>
            <dt>Missing prices</dt>
            <dd>{summary.missingPricesCount}</dd>
          </div>
        </dl>

        {!readiness.ready && (
          <ul className="pp-blocker-list">
            {readiness.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}

        <label className="pp-po-number-field">
          <span>PO number (required)</span>
          <input
            className="pp-po-number-input"
            value={purchaseOrderNumber}
            onChange={(e) => onPurchaseOrderNumberChange(e.target.value)}
            placeholder="e.g. PO-2026-001"
            disabled={busy}
          />
        </label>

        <div className="pp-step-primary-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!readiness.ready || !purchaseOrderNumber.trim() || busy}
            onClick={onCreatePo}
          >
            {busy ? 'Creating in Zoho…' : 'Create Draft PO in Zoho'}
          </button>
        </div>
        <p className="pp-hint">Prices are taken from your All Prices preferences for included lines.</p>
      </div>
    </div>
  )
}

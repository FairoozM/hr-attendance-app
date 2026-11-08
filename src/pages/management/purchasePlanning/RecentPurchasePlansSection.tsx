import { Trash2 } from 'lucide-react'
import { PlanStatusBadge } from './PurchasePlanningBadges'
import type { PurchasePlan } from './purchasePlanningTypes'
import { fmtPrice, formatUploadDate } from './purchasePlanningUtils'

interface RecentPurchasePlansSectionProps {
  plans: PurchasePlan[]
  activePlanId: number | null
  onOpenPlan: (planId: number) => void
  onDeletePlan: (plan: PurchasePlan) => void
  deleteBusy: boolean
}

export function RecentPurchasePlansSection({
  plans,
  activePlanId,
  onOpenPlan,
  onDeletePlan,
  deleteBusy,
}: RecentPurchasePlansSectionProps) {
  if (plans.length === 0) return null

  return (
    <section className="pp-recent-plans" aria-labelledby="pp-recent-plans-title">
      <h2 id="pp-recent-plans-title" className="pp-recent-plans__title">
        Recent purchase plans
      </h2>
      <p className="pp-hint">Open any plan to review lines. Only draft plans can be deleted.</p>
      <div className="pp-recent-plans__table-wrap">
        <table className="pp-recent-plans__table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Status</th>
              <th>Zoho PO</th>
              <th>Lines</th>
              <th>Qty</th>
              <th>Est. value</th>
              <th>Created</th>
              <th>Updated</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} className={activePlanId === plan.id ? 'pp-recent-plans__row--active' : undefined}>
                <td>
                  <strong>{plan.planNumber}</strong>
                </td>
                <td>
                  <PlanStatusBadge status={plan.status} />
                </td>
                <td>{plan.purchaseOrderNumber || plan.zohoPurchaseOrderId || '—'}</td>
                <td>
                  {plan.includedCount != null
                    ? `${plan.includedCount} incl. / ${plan.itemsCount ?? '—'}`
                    : plan.itemsCount ?? '—'}
                </td>
                <td>{plan.totalFinalQty ?? '—'}</td>
                <td>{fmtPrice(plan.estimatedTotalValue)}</td>
                <td>{formatUploadDate(plan.createdAt)}</td>
                <td>{formatUploadDate(plan.updatedAt || plan.createdAt)}</td>
                <td className="pp-recent-plans__actions">
                  <button type="button" className="btn btn--sm" onClick={() => onOpenPlan(plan.id)}>
                    Open
                  </button>
                  {plan.status === 'draft' && (
                    <button
                      type="button"
                      className="pp-plan-card__delete"
                      aria-label={`Delete draft ${plan.planNumber}`}
                      title="Delete draft"
                      disabled={deleteBusy}
                      onClick={() => onDeletePlan(plan)}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

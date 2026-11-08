import { Trash2 } from 'lucide-react'
import { Badge } from './PurchasePlanningBadges'
import { formatUploadDate, getLatestVigilUpload } from './purchasePlanningUtils'

export function GeneratePlanStep({
  uploads,
  workflow,
  plans,
  activePlan,
  busy,
  onGenerate,
  onOpenPlan,
  onDeletePlan,
  onGoToStep,
}) {
  const latestVigil = getLatestVigilUpload(uploads)
  const blocker = workflow.blockers[4]
  const canGenerate =
    workflow.hasVigil &&
    workflow.hasPendingUpload &&
    !workflow.pendingWithoutZoho?.length &&
    workflow.stepStatuses[3] === 'completed'

  const batchAlreadyPlanned = Boolean(workflow.batchConsumed && !workflow.hasPendingUpload)
  const checklist = batchAlreadyPlanned
    ? [
        { label: 'Vigil stock uploaded', ok: true, step: 1 },
        { label: 'Low-stock batch already planned', ok: true, step: 2 },
        { label: 'Zoho enrichment already finished for that batch', ok: true, step: 3 },
      ]
    : [
        {
          label: 'Vigil stock uploaded',
          ok: workflow.hasVigil,
          step: 1,
        },
        {
          label: 'Low-stock SKUs uploaded',
          ok: workflow.hasPendingUpload,
          step: 2,
        },
        {
          label: 'Zoho enrichment completed (all pending SKUs have Zoho item IDs)',
          ok: workflow.hasPendingUpload && workflow.pendingWithoutZoho?.length === 0,
          step: 3,
        },
        {
          label: `${workflow.pendingWithZoho?.length ?? 0} pending SKU(s) ready for plan`,
          ok: (workflow.pendingWithZoho?.length ?? 0) > 0,
          step: 3,
        },
      ]

  const draftPlans = (plans || []).filter((p) => p.status === 'draft')

  return (
    <div className="pp-step-content">
      <div className="pp-readiness-card">
        <h3>Readiness checklist</h3>
        <ul className="pp-checklist">
          {checklist.map((item) => (
            <li key={item.label} className={item.ok ? 'pp-checklist__item--ok' : 'pp-checklist__item--pending'}>
              <span className="pp-checklist__mark">{item.ok ? '✓' : '○'}</span>
              <span>{item.label}</span>
              {!item.ok && onGoToStep && (
                <button type="button" className="pp-checklist__link" onClick={() => onGoToStep(item.step)}>
                  Go to Step {item.step}
                </button>
              )}
            </li>
          ))}
        </ul>
        {blocker && <p className="pp-hint pp-hint--warn">{blocker}</p>}
        <div className="pp-step-primary-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canGenerate || busy}
            title={blocker || undefined}
            onClick={onGenerate}
          >
            {busy ? 'Generating…' : 'Generate Draft Purchase Plan'}
          </button>
        </div>
        <p className="pp-hint">
          Generating a plan marks the pending SKUs as planned. They leave the upload batch and stay on the draft until you
          delete it or send the purchase order.
        </p>
        {batchAlreadyPlanned && (
          <p className="pp-hint">
            This batch is already on a draft. Upload a new low-stock file when you want another plan.
          </p>
        )}
        {latestVigil && (
          <p className="pp-hint">Source Vigil upload: {latestVigil.fileName} · {formatUploadDate(latestVigil.uploadedAt)}</p>
        )}
      </div>

      {activePlan?.status === 'draft' && (
        <div className="pp-summary-card pp-summary-card--highlight">
          <h3>Active draft: {activePlan.planNumber}</h3>
          <p>
            {(activePlan.items || []).length} lines · created {formatUploadDate(activePlan.createdAt)}
          </p>
          <button type="button" className="btn" onClick={() => onOpenPlan(activePlan.id)}>
            Continue to review (Step 5)
          </button>
        </div>
      )}

      <div className="pp-draft-list-section">
        <h3>Draft plans</h3>
        {draftPlans.length === 0 ? (
          <p className="pp-hint">No draft plans yet.</p>
        ) : (
          <div className="pp-plan-list">
            {draftPlans.map((plan) => (
              <div key={plan.id} className="pp-plan-card-row">
                <button type="button" className="pp-plan-card" onClick={() => onOpenPlan(plan.id)}>
                  <strong>{plan.planNumber}</strong>
                  <span>
                    {plan.itemsCount} items · final qty {plan.totalFinalQty}
                  </span>
                  <Badge tone="warning">{plan.status}</Badge>
                </button>
                <button
                  type="button"
                  className="pp-plan-card__delete"
                  aria-label={`Delete draft ${plan.planNumber}`}
                  title="Delete draft"
                  onClick={() => onDeletePlan(plan)}
                >
                  <Trash2 size={18} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="pp-hint">
          Deleting a draft returns its planned SKUs to the pending batch. Sent plans stay in history.
        </p>
      </div>
    </div>
  )
}

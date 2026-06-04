import { Badge } from './PurchasePlanningBadges'
import {
  formatUploadDate,
  getLatestDraftPlan,
  getLatestSentPlan,
  getLatestVigilUpload,
  getPendingLowStock,
} from './purchasePlanningUtils'

export function PurchasePlanningStatusCards({
  uploads,
  lowStock,
  enrichmentRunning,
  enrichmentError,
  plans,
  activePlan,
  onOpenLatestSent,
  onStartNewPlan,
}) {
  const latestVigil = getLatestVigilUpload(uploads)
  const pending = getPendingLowStock(lowStock)
  const pendingMatched = pending.filter((item) => String(item.zohoItemId || '').trim()).length
  const latestDraft = getLatestDraftPlan(plans) || (activePlan?.status === 'draft' ? activePlan : null)
  const latestSent = getLatestSentPlan(plans) || (activePlan?.status === 'sent_to_zoho' ? activePlan : null)

  let enrichLabel = 'Idle'
  let enrichTone = 'muted'
  if (enrichmentRunning) {
    enrichLabel = 'Running'
    enrichTone = 'warning'
  } else if (enrichmentError) {
    enrichLabel = 'Failed'
    enrichTone = 'danger'
  } else if (pending.length > 0 && pendingMatched === pending.length) {
    enrichLabel = 'Complete'
    enrichTone = 'success'
  } else if (pending.length > 0) {
    enrichLabel = 'Needs attention'
    enrichTone = 'warning'
  }

  let draftValue = '—'
  let draftMeta = 'No active draft'
  if (latestDraft) {
    draftValue = latestDraft.planNumber
    draftMeta = `${latestDraft.itemsCount ?? latestDraft.items?.length ?? '—'} lines · draft`
  } else if (latestSent) {
    draftMeta = `Latest sent: ${latestSent.planNumber}`
  } else if (!latestVigil) {
    draftMeta = 'Upload Vigil stock first'
  } else if (pending.length === 0) {
    draftMeta = 'Upload low-stock SKUs to start a batch'
  } else if (pendingMatched < pending.length) {
    draftMeta = 'Complete Zoho enrichment (Step 3)'
  } else {
    draftMeta = 'Ready to generate draft (Step 4)'
  }

  const sentValue = latestSent?.zohoPurchaseOrderId || latestSent?.purchaseOrderNumber || '—'
  const sentMeta = latestSent
    ? `${latestSent.planNumber}${latestSent.purchaseOrderNumber ? ` · PO ${latestSent.purchaseOrderNumber}` : ''}`
    : 'No PO sent yet'

  return (
    <div className="pp-status-cards">
      <div className="pp-status-card">
        <span className="pp-status-card__label">Latest Vigil Upload</span>
        <strong className="pp-status-card__value">
          {latestVigil ? `${latestVigil.rowsCount} rows` : 'None'}
        </strong>
        <span className="pp-status-card__meta">
          {latestVigil ? formatUploadDate(latestVigil.uploadedAt) : 'Upload wholesale stock first'}
        </span>
      </div>
      <div className="pp-status-card">
        <span className="pp-status-card__label">Pending Low Stock SKUs</span>
        <strong className="pp-status-card__value">{pending.length}</strong>
        <span className="pp-status-card__meta">
          {pending.length > 0 ? `${pendingMatched} matched in Zoho` : 'No pending batch'}
        </span>
      </div>
      <div className="pp-status-card">
        <span className="pp-status-card__label">Zoho Enrichment</span>
        <strong className="pp-status-card__value">
          <Badge tone={enrichTone}>{enrichLabel}</Badge>
        </strong>
        <span className="pp-status-card__meta">
          {enrichmentRunning ? 'Background job in progress' : enrichmentError || 'Life Smile stock & 3M usage'}
        </span>
      </div>
      <div className="pp-status-card">
        <span className="pp-status-card__label">Latest Draft Plan</span>
        <strong className="pp-status-card__value">{draftValue}</strong>
        <span className="pp-status-card__meta">{draftMeta}</span>
      </div>
      <button
        type="button"
        className={`pp-status-card pp-status-card--action${latestSent ? '' : ' pp-status-card--disabled'}`}
        disabled={!latestSent}
        onClick={() => latestSent && onOpenLatestSent?.(latestSent.id)}
      >
        <span className="pp-status-card__label">Last PO Sent to Zoho</span>
        <strong className="pp-status-card__value">{sentValue}</strong>
        <span className="pp-status-card__meta">
          {latestSent ? (
            <>
              {sentMeta}
              <span className="pp-status-card__open-hint">Open sent plan →</span>
            </>
          ) : (
            sentMeta
          )}
        </span>
      </button>
      {latestSent && !latestDraft && onStartNewPlan && (
        <div className="pp-status-card pp-status-card--cta">
          <span className="pp-status-card__label">Next action</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={onStartNewPlan}>
            Start New Purchase Plan
          </button>
        </div>
      )}
    </div>
  )
}

import { Badge } from './PurchasePlanningBadges'
import { formatUploadDate, getLatestDraftPlan, getLatestVigilUpload, getLastSentPlan, getPendingLowStock } from './purchasePlanningUtils'

export function PurchasePlanningStatusCards({
  uploads,
  lowStock,
  enrichmentRunning,
  enrichmentError,
  plans,
  activePlan,
}) {
  const latestVigil = getLatestVigilUpload(uploads)
  const pending = getPendingLowStock(lowStock)
  const pendingMatched = pending.filter((item) => String(item.zohoItemId || '').trim()).length
  const latestDraft = getLatestDraftPlan(plans) || (activePlan?.status === 'draft' ? activePlan : null)
  const lastSent = getLastSentPlan(plans) || (activePlan?.status === 'sent_to_zoho' ? activePlan : null)

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
        <strong className="pp-status-card__value">{latestDraft?.planNumber || '—'}</strong>
        <span className="pp-status-card__meta">
          {latestDraft ? `${latestDraft.itemsCount ?? '—'} lines` : 'Generate after enrichment'}
        </span>
      </div>
      <div className="pp-status-card">
        <span className="pp-status-card__label">Last PO Sent to Zoho</span>
        <strong className="pp-status-card__value">{lastSent?.zohoPurchaseOrderId || '—'}</strong>
        <span className="pp-status-card__meta">{lastSent?.planNumber || 'No PO sent yet'}</span>
      </div>
    </div>
  )
}

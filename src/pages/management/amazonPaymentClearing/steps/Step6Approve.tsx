import { dateText } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

export function Step6Approve({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  if (!preview) return null
  const approvedBy = preview.approvedBy ?? preview.batch?.approvedBy ?? null
  const approvedAt = preview.approvedAt ?? preview.batch?.approvedAt ?? null

  const reasons: string[] = []
  if (preview.reconciliationSummary?.reconciliationStatus === 'mismatch') {
    reasons.push('Settlement total does not match the expected deposit.')
  }
  if (preview.unmatchedOrders.length > 0) {
    reasons.push(`${preview.unmatchedOrders.length} sales order(s) have no matching Zoho invoice.`)
  }
  if ((preview.creditNoteBlockingRows || []).length > 0) {
    reasons.push(`${(preview.creditNoteBlockingRows || []).length} refund/return row(s) have missing or mismatched Zoho credit notes.`)
  }

  return (
    <div className="apc-step-stack">
      {ctx.isApproved || ctx.isPosted ? (
        <div className="apc-alert apc-approved-panel" role="status">
          <strong>{ctx.isPosted ? 'Posted to Zoho.' : 'Approved for Zoho posting.'}</strong>{' '}
          {ctx.isApproved ? `Approved by ${approvedBy ?? '-'} at ${dateText(approvedAt)}.` : null}
        </div>
      ) : ctx.isCleanForApproval ? (
        <div className="apc-alert" role="status">
          Sales, returns, credit notes, and settlement reconciliation are all clean. This settlement is ready to approve.
        </div>
      ) : (
        <div className="apc-alert apc-alert--error" role="alert">
          <strong>Approval is blocked:</strong>
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="apc-button-row">
        <button
          className="ainv-btn ainv-btn--primary-sky"
          type="button"
          onClick={ctx.onApprove}
          disabled={ctx.approving || ctx.isApproved || ctx.isPosted || !preview.batch?.batchId || !ctx.isCleanForApproval}
        >
          {ctx.isPosted
            ? 'Posted to Zoho'
            : ctx.isApproved
              ? 'Approved and Saved'
              : ctx.approving
                ? 'Approving...'
                : 'Approve Settlement'}
        </button>
      </div>
    </div>
  )
}

import { dateText, PostingResultTable, SummaryCard } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

export function Step8Post({ ctx }: { ctx: ClearingContext }) {
  const { preview, paymentPreview, postingResult } = ctx
  if (!preview) return null
  const postedBy = preview.postedBy ?? preview.batch?.postedBy ?? null
  const postedAt = preview.postedAt ?? preview.batch?.postedAt ?? null
  const postingSummary = preview.postingSummary || preview.batch?.postingSummary
  const priorIds = postingSummary?.zohoPaymentIds || []

  return (
    <div className="apc-step-stack">
      {ctx.isPosted ? (
        <div className="apc-alert apc-approved-panel" role="status">
          <strong>Already posted to Zoho.</strong> Posted by {postedBy ?? '-'} at {dateText(postedAt)}.
          {priorIds.length ? (
            <span> Zoho payment IDs: {priorIds.map((entry) => entry.zohoPaymentId).join(', ')}.</span>
          ) : null}
          <p className="apc-muted">
            This batch is view-only. Dry run is still available. To repost, an admin must use Force Repost and provide a
            reason.
          </p>
        </div>
      ) : (
        <div className="apc-alert">
          <strong>Posting writes to Zoho.</strong> Use Dry Run first, then POST TO ZOHO after confirming the preview.
        </div>
      )}

      <div className="apc-button-row">
        <button
          className="ainv-btn"
          type="button"
          onClick={() => ctx.onRunPosting(true)}
          disabled={(!ctx.canPostToZoho && !ctx.isPosted) || ctx.posting || !paymentPreview}
        >
          {ctx.posting ? 'Working...' : 'Dry Run'}
        </button>
        {ctx.isPosted ? (
          <button className="ainv-btn ainv-btn--danger" type="button" onClick={ctx.onOpenForceRepost} disabled={ctx.posting}>
            Force Repost
          </button>
        ) : (
          <button
            className="ainv-btn ainv-btn--danger"
            type="button"
            onClick={() => ctx.onRunPosting(false)}
            disabled={!ctx.canPostToZoho || ctx.posting}
          >
            POST TO ZOHO
          </button>
        )}
      </div>
      {!paymentPreview ? <p className="apc-muted">Generate the payment preview in Step 7 before posting.</p> : null}

      {postingResult ? (
        <>
          <section className="apc-summary-grid">
            <SummaryCard label="Invoices Posted" value={postingResult.summary.invoicesPosted} />
            <SummaryCard label="Payments Created" value={postingResult.summary.paymentsCreated} />
            <SummaryCard label="Payments Skipped" value={postingResult.summary.paymentsSkipped} />
            <SummaryCard label="Errors" value={postingResult.summary.errors} />
          </section>
          <PostingResultTable result={postingResult} />
        </>
      ) : null}

      {preview.auditLog && preview.auditLog.length ? (
        <details className="apc-details">
          <summary>Repost audit log ({preview.auditLog.length})</summary>
          <div className="apc-table-wrap">
            <table className="apc-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Reason</th>
                  <th>Previous Zoho IDs</th>
                </tr>
              </thead>
              <tbody>
                {preview.auditLog.map((entry) => (
                  <tr key={entry.id}>
                    <td>{dateText(entry.createdAt)}</td>
                    <td>{entry.action}</td>
                    <td>{entry.reason || '-'}</td>
                    <td>{entry.previousZohoPaymentIds.join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  )
}

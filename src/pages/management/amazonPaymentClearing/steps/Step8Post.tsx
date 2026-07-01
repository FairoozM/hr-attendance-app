import {
  AmazonFeeJournalPreviewTable,
  dateText,
  isFeeJournalPostingType,
  money,
  PostedStoredEntriesTable,
  PostingResultTable,
  SummaryCard,
} from '../clearingShared'
import type { ClearingContext } from './clearingContext'

export function Step8Post({ ctx }: { ctx: ClearingContext }) {
  const { preview, paymentPreview, postingResult } = ctx
  if (!preview) return null
  const postedBy = preview.postedBy ?? preview.batch?.postedBy ?? null
  const postedAt = preview.postedAt ?? preview.batch?.postedAt ?? null
  const postingSummary = preview.postingSummary || preview.batch?.postingSummary
  const priorPaymentIds = postingSummary?.zohoPaymentIds || []
  const priorJournalIds = postingSummary?.zohoJournalIds || []
  const postingReference =
    preview.postingReference || preview.batch?.postingReference || postingSummary?.reference || ''
  const storedPostings = Array.isArray(preview.postings) ? preview.postings : []
  const storedJournalCount = storedPostings.filter((row) => isFeeJournalPostingType(row.paymentType)).length
  const journalLines = paymentPreview?.amazonFeeJournalLines || []

  return (
    <div className="apc-step-stack">
      {ctx.isPosted ? (
        <div className="apc-alert apc-approved-panel" role="status">
          <strong>Posted to Zoho.</strong>
          {postingReference ? (
            <span> Payment reference: <code className="apc-ref">{postingReference}</code>.</span>
          ) : null}
          <div>Posted by {postedBy ?? '-'} at {dateText(postedAt)}.</div>
          {priorPaymentIds.length ? (
            <div>
              Zoho payment IDs:{' '}
              {priorPaymentIds
                .map((entry) => (entry.referenceNumber ? `${entry.zohoPaymentId} (${entry.referenceNumber})` : entry.zohoPaymentId))
                .join(', ')}
              .
            </div>
          ) : null}
          {priorJournalIds.length ? (
            <div>
              Zoho journal entries:{' '}
              {priorJournalIds
                .map((entry) => {
                  const label = entry.zohoJournalNumber || entry.zohoJournalId
                  return entry.referenceNumber ? `${label} (${entry.referenceNumber})` : label
                })
                .join(', ')}
              .
            </div>
          ) : storedJournalCount === 0 && journalLines.length === 0 ? (
            <div className="apc-muted">No manual journal entries were posted for this settlement.</div>
          ) : null}
          <p className="apc-muted">
            Record Payments use the AMZ-KSA reference. Manual journals for Amazon fees use the settlement date-range
            reference (for example, 29-Apr-2026 to 13-May-2026), so search Zoho Journals by that range if needed.
          </p>
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
        {!paymentPreview ? (
        <p className="apc-muted">Generate the payment preview in Step 10 before posting.</p>
      ) : null}

      {journalLines.length ? (
        <section>
          <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>
            Amazon Fee Manual Journal {ctx.isPosted ? 'Posted Lines' : 'Preview'}
          </h3>
          <p className="apc-muted apc-table-caption">
            These mapped non-order Amazon fees are posted as Zoho manual journals, not invoice payments.
          </p>
          <AmazonFeeJournalPreviewTable rows={journalLines} />
        </section>
      ) : null}

      {postingResult ? (
        <>
          <section className="apc-summary-grid">
            <SummaryCard label="Invoices Posted" value={postingResult.summary.invoicesPosted} />
            <SummaryCard label="Payments Created" value={postingResult.summary.paymentsCreated} />
            <SummaryCard label="Payments Skipped" value={postingResult.summary.paymentsSkipped} />
            <SummaryCard label="Journals Created" value={postingResult.summary.journalsCreated || 0} />
            <SummaryCard label="Journals Skipped" value={postingResult.summary.journalsSkipped || 0} />
            <SummaryCard label="Errors" value={postingResult.summary.errors} />
          </section>
          <PostingResultTable result={postingResult} />
        </>
      ) : null}

      {!postingResult && ctx.isPosted ? (
        <section>
          {postingSummary ? (
            <section className="apc-summary-grid">
              <SummaryCard label="Payments Created" value={postingSummary.paymentsCreated ?? '-'} />
              <SummaryCard label="Journals Created" value={postingSummary.journalsCreated ?? 0} />
            </section>
          ) : null}
          <PostedStoredEntriesTable postings={storedPostings} postingSummary={postingSummary} />
        </section>
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

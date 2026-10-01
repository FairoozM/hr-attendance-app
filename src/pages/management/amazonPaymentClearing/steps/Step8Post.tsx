import {
  AmazonFeeJournalPreviewTable,
  dateText,
  isFeeJournalPostingType,
  money,
  PostedStoredEntriesTable,
  PostingResultTable,
  SummaryCard,
} from '../clearingShared'
import { PostingProgressBar } from '../components/PostingProgressBar'
import { PostingStatusPanel } from '../components/PostingStatusPanel'
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
  const batchId = preview.batch?.batchId
  const salesGroups = (ctx.postingStatus?.groups || []).filter((g) => g.key === 'sales_payment' || g.key === 'fee_journal')
  const salesStarted = salesGroups.some((g) => g.entries.some((e) => e.status !== 'not_started'))
  const canForceRepost = ctx.isPosted || salesStarted

  return (
    <div className="apc-step-stack">
      {ctx.isPosted ? (
        <div className="apc-alert apc-approved-panel" role="status">
          <strong>
            Sales payments and fee journals posted to Zoho.
            {ctx.postingStatus && !ctx.postingStatus.settlementComplete
              ? ' The settlement is not complete until credit notes, refunds and returns not received and return fee journals (steps 10–12) are posted.'
              : ''}
          </strong>
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
            Record Payments use the {ctx.marketplace === 'UAE' ? 'AMZ-UAE' : 'AMZ-KSA'} reference. Manual journals for Amazon fees use the settlement date-range
            reference (for example, 29-Apr-2026 to 13-May-2026), so search Zoho Journals by that range if needed.
          </p>
          <p className="apc-muted">
            Delete the Zoho payment received entries and fee journals for this settlement, then use Force Repost and
            enter a reason. That posts the sales payments and fee journals again.
          </p>
        </div>
      ) : salesStarted ? (
        <div className="apc-alert" role="status">
          <strong>Sales payments or fee journals already exist for this settlement.</strong> Delete those payment
          received entries and fee journals in Zoho, then use Force Repost and enter a reason.
        </div>
      ) : (
        <div className="apc-alert">
          <strong>Posting sales payments to Zoho.</strong> Use Dry Run first, then POST TO ZOHO after confirming the
          preview. Return refunds, returns not received and return fee journals are handled in steps 10–12 after payments land.
        </div>
      )}

      {batchId != null ? (
        <PostingStatusPanel
          marketplace={ctx.marketplace}
          batchId={batchId}
          status={ctx.postingStatus}
          currency={ctx.currency}
          loading={ctx.postingStatusLoading}
          groups={['sales_payment', 'fee_journal']}
          readOnly
          onChanged={(message) => ctx.refreshPostingStatus(batchId, message)}
          onResume={ctx.goToStep}
        />
      ) : null}

      {ctx.posting && ctx.postingStartedAt ? (
        <PostingProgressBar progress={ctx.postingProgress} startedAt={ctx.postingStartedAt} />
      ) : null}

      <div className="apc-button-row">
        <button
          className="ainv-btn"
          type="button"
          onClick={() => ctx.onRunPosting(true)}
          disabled={(!ctx.canPostToZoho && !ctx.isPosted) || ctx.posting || !paymentPreview}
        >
          {ctx.posting ? 'Working...' : 'Dry Run'}
        </button>
        {canForceRepost ? (
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
      {ctx.salesPostingMessage ? (
        <div
          className={ctx.salesPostingMessage.kind === 'error' ? 'apc-alert apc-alert--error' : 'apc-alert'}
          role={ctx.salesPostingMessage.kind === 'error' ? 'alert' : 'status'}
        >
          {ctx.salesPostingMessage.text}
        </div>
      ) : null}
        {!paymentPreview ? (
        <p className="apc-muted">Generate the payment preview in step 8 before posting.</p>
      ) : null}

      {journalLines.length ? (
        <section>
          <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>
            Amazon Fee Manual Journal {ctx.isPosted ? 'Posted Lines' : 'Preview'}
          </h3>
          <p className="apc-muted apc-table-caption">
            These mapped non-order Amazon fees are posted as Zoho manual journals, not invoice payments.
          </p>
          <AmazonFeeJournalPreviewTable rows={journalLines} currency={ctx.currency} />
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
            <SummaryCard label="Verification Required" value={postingResult.summary.verificationRequired || 0} />
            <SummaryCard label="Errors" value={postingResult.summary.errors} />
          </section>
          {postingResult.warnings?.length ? (
            <div className="apc-alert">
              {postingResult.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}
          <PostingResultTable result={postingResult} currency={ctx.currency} />
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
          <PostedStoredEntriesTable
            postings={storedPostings}
            postingSummary={postingSummary}
            marketplace={ctx.marketplace}
            currency={ctx.currency}
          />
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

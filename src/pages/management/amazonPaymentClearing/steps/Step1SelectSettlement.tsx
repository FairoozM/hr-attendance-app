import { dateRangeText, dateText, LifecycleBadge, money } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

export function Step1SelectSettlement({ ctx }: { ctx: ClearingContext }) {
  const selectedReport = ctx.reports.find(
    (row) => row.reportId === ctx.reportId || row.reportDocumentId === ctx.reportDocumentId
  )
  return (
    <div className="apc-step-stack">
      <div className="apc-callout">
        Saved settlements load instantly from the database. "Preview Report" reuses a saved batch when one exists for
        the report; use "Refresh from Amazon" only when you need to re-fetch the raw report.
      </div>

      <div>
        <div className="apc-stage-panel__header">
          <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Saved settlement batches</h3>
          <button className="ainv-btn ainv-btn--sm" type="button" onClick={ctx.onFetchReports} disabled={ctx.loadingBatches}>
            {ctx.loadingBatches ? 'Refreshing...' : 'Refresh list'}
          </button>
        </div>
        {ctx.savedBatches.length ? (
          <div className="apc-table-wrap apc-table-wrap--wide">
            <table className="apc-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Settlement</th>
                  <th>Range</th>
                  <th className="apc-money">Settlement Total</th>
                  <th>Matched</th>
                  <th>Blockers</th>
                  <th>Lifecycle</th>
                  <th>Zoho Reference</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ctx.savedBatches.map((batch) => (
                  <tr key={batch.batchId}>
                    <td>#{batch.batchId}</td>
                    <td>{batch.settlementId || '-'}</td>
                    <td>{dateRangeText(batch.settlementStartDate, batch.settlementEndDate)}</td>
                    <td className="apc-money">{money(batch.amazonSettlementTotal)}</td>
                    <td>{batch.matchedOrderCount}</td>
                    <td>{batch.creditNoteBlockerCount + batch.unmatchedOrderCount}</td>
                    <td><LifecycleBadge status={batch.lifecycleStatus} /></td>
                    <td>
                      {batch.postedToZoho && batch.postingReference ? (
                        <code className="apc-ref">{batch.postingReference}</code>
                      ) : (
                        <span className="apc-muted">-</span>
                      )}
                    </td>
                    <td>{dateText(batch.createdAt)}</td>
                    <td>
                      <button
                        className="ainv-btn ainv-btn--sm"
                        type="button"
                        onClick={() => ctx.onOpenSavedBatch(batch.batchId)}
                        disabled={ctx.reopening}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="apc-empty">No saved settlement batches yet. Fetch and preview a report to create one.</div>
        )}
      </div>

      <div className="apc-actions">
        <label className="ainv-label">
          reportId
          <input
            className="ainv-input"
            value={ctx.reportId}
            onChange={(e) => ctx.setReportId(e.target.value)}
            placeholder="Leave blank to use latest KSA settlement"
          />
        </label>
        <label className="ainv-label">
          reportDocumentId
          <input
            className="ainv-input"
            value={ctx.reportDocumentId}
            onChange={(e) => ctx.setReportDocumentId(e.target.value)}
            placeholder="Optional direct report document ID"
          />
        </label>
        <label className="ainv-label">
          saved batchId
          <input
            className="ainv-input"
            value={ctx.batchIdToOpen}
            onChange={(e) => ctx.setBatchIdToOpen(e.target.value)}
            placeholder="Open a saved batch by ID"
          />
        </label>
        <div className="apc-button-row">
          <button className="ainv-btn" type="button" onClick={ctx.onFetchReports} disabled={ctx.loadingReports || ctx.previewing}>
            {ctx.loadingReports ? 'Fetching...' : 'Fetch Latest KSA Settlement'}
          </button>
          <button
            className="ainv-btn ainv-btn--primary-sky"
            type="button"
            onClick={ctx.onPreview}
            disabled={ctx.previewing || ctx.loadingReports}
          >
            {ctx.previewing ? 'Loading...' : 'Preview Report'}
          </button>
          <button
            className="ainv-btn ainv-btn--danger"
            type="button"
            onClick={ctx.onRefreshFromAmazon}
            disabled={ctx.previewing || ctx.loadingReports}
            title="Re-fetch the raw report from Amazon and replace saved parsed rows."
          >
            Refresh from Amazon
          </button>
          <button
            className="ainv-btn"
            type="button"
            onClick={ctx.onOpenBatchId}
            disabled={ctx.reopening || ctx.previewing || !ctx.batchIdToOpen.trim()}
          >
            {ctx.reopening ? 'Opening...' : 'Open Saved Batch'}
          </button>
        </div>
      </div>

      {selectedReport ? (
        <p className="apc-muted">
          Selected report: {selectedReport.reportId || '-'} · range{' '}
          {dateRangeText(selectedReport.dataStartTime, selectedReport.dataEndTime)} · created{' '}
          {dateText(selectedReport.createdTime)}
        </p>
      ) : null}

      {ctx.reports.length ? (
        <div className="apc-table-wrap">
          <table className="apc-table">
            <thead>
              <tr>
                <th>Amazon Report Range</th>
                <th>Report ID</th>
                <th>Created</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ctx.reports.map((row) => (
                <tr key={row.reportId || row.reportDocumentId}>
                  <td>
                    <button
                      className="apc-link-button"
                      type="button"
                      onClick={() => {
                        ctx.setReportId(row.reportId || '')
                        ctx.setReportDocumentId(row.reportDocumentId || '')
                      }}
                    >
                      {dateRangeText(row.dataStartTime, row.dataEndTime)}
                    </button>
                  </td>
                  <td>{row.reportId || '-'}</td>
                  <td>{dateText(row.createdTime)}</td>
                  <td>{row.processingStatus || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

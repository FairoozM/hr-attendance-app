import type { BlockingIssue } from '../../../../api/amazonPaymentClearing'

export function BlockingIssuesPanel({
  issues,
  onViewRows,
}: {
  issues: BlockingIssue[]
  onViewRows: (rowNumbers: number[]) => void
}) {
  if (!issues.length) {
    return (
      <div className="apc-alert" role="status">
        No blocking issues. Sales, returns, credit notes, and settlement totals are clean.
      </div>
    )
  }
  return (
    <div className="apc-blocking-list">
      {issues.map((issue) => (
        <div key={issue.code} className="apc-blocking-item">
          <div className="apc-blocking-item__head">
            <div>
              <span className="apc-pill apc-pill--danger">{issue.count}</span>
              <strong className="apc-blocking-item__label">{issue.label}</strong>
            </div>
            {issue.rowNumbers.length ? (
              <button type="button" className="ainv-btn ainv-btn--sm" onClick={() => onViewRows(issue.rowNumbers)}>
                View rows
              </button>
            ) : null}
          </div>
          {issue.orderIds.length ? (
            <p className="apc-muted apc-blocking-item__orders">
              Orders: {issue.orderIds.slice(0, 12).join(', ')}
              {issue.orderIds.length > 12 ? ` +${issue.orderIds.length - 12} more` : ''}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

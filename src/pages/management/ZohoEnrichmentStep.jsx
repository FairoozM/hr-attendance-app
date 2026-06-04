import { useMemo, useState } from 'react'
import { Badge } from './PurchasePlanningBadges'
import { UnmatchedLowStockTable } from './UnmatchedLowStockTable'
import { fmt, getPendingLowStock, getStockRemark } from './purchasePlanningUtils'

export function ZohoEnrichmentStep({
  lowStock,
  enrichmentRunning,
  enrichmentError,
  enrichmentSummary,
  onRefreshZoho,
  onRemoveUnmatched,
  removingLowStockId,
  refreshBusy,
  hasPending,
}) {
  const [showMatched, setShowMatched] = useState(true)
  const pending = getPendingLowStock(lowStock)
  const matched = useMemo(
    () => pending.filter((item) => String(item.zohoItemId || '').trim()),
    [pending]
  )
  const unmatched = useMemo(
    () => pending.filter((item) => !String(item.zohoItemId || '').trim()),
    [pending]
  )

  const processed = enrichmentSummary?.refreshed ?? matched.length + unmatched.length
  const total = pending.length
  const showAsRunning =
    enrichmentRunning && pending.length > 0 && matched.length === 0 && unmatched.length === pending.length

  let statusLabel = 'Idle'
  let statusTone = 'muted'
  if (showAsRunning) {
    statusLabel = 'Running'
    statusTone = 'warning'
  } else if (enrichmentError) {
    statusLabel = 'Failed'
    statusTone = 'danger'
  } else if (hasPending && unmatched.length === 0 && matched.length > 0) {
    statusLabel = 'Completed'
    statusTone = 'success'
  }

  if (!hasPending) {
    return (
      <p className="pp-hint pp-hint--warn">Upload low-stock SKUs in Step 2 before enriching from Zoho.</p>
    )
  }

  return (
    <div className="pp-step-content">
      <div className="pp-enrichment-status-card">
        <h3>Zoho enrichment status</h3>
        <dl className="pp-dl">
          <div>
            <dt>Status</dt>
            <dd>
              <Badge tone={statusTone}>{statusLabel}</Badge>
            </dd>
          </div>
          <div>
            <dt>Processed</dt>
            <dd>
              {showAsRunning ? '…' : processed} / {total}
            </dd>
          </div>
          <div>
            <dt>Matched in Zoho</dt>
            <dd>{matched.length}</dd>
          </div>
          <div>
            <dt>Unmatched</dt>
            <dd>{unmatched.length}</dd>
          </div>
        </dl>
        {enrichmentError && <div className="page-error">{enrichmentError}</div>}
        {enrichmentSummary && !showAsRunning && (
          <p className="pp-hint">
            Last run: {enrichmentSummary.matched ?? 0} matched, {enrichmentSummary.unmatched ?? 0} unmatched (
            {enrichmentSummary.refreshed ?? 0} refreshed).
          </p>
        )}
        <p className="pp-hint">
          Zoho provides <strong>Life Smile</strong> warehouse available stock, direct sales (92 days), and composite/bundle
          component usage for each uploaded SKU.
        </p>
        <div className="pp-step-primary-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={refreshBusy || showAsRunning || pending.length === 0}
            onClick={onRefreshZoho}
          >
            {showAsRunning ? 'Enrichment running…' : refreshBusy ? 'Starting refresh…' : 'Refresh Zoho Data'}
          </button>
        </div>
        {showAsRunning && (
          <p className="pp-hint pp-hint--warn">Plan generation and other heavy actions are disabled while enrichment runs.</p>
        )}
      </div>

      {unmatched.length > 0 && onRemoveUnmatched && (
        <UnmatchedLowStockTable items={unmatched} onRemove={onRemoveUnmatched} removingId={removingLowStockId} />
      )}

      {unmatched.length === 0 && hasPending && matched.length > 0 && !enrichmentRunning && (
        <p className="pp-step-done-hint">All pending SKUs are matched in Zoho. You can proceed to Step 4.</p>
      )}

      {matched.length > 0 && (
        <div className="pp-enrichment-list pp-enrichment-list--matched">
          <div className="pp-enrichment-list__head">
            <div>
              <strong>Matched in Zoho ({matched.length})</strong>
            </div>
            <button type="button" className="btn btn--sm" onClick={() => setShowMatched((v) => !v)}>
              {showMatched ? 'Hide table' : 'Show table'}
            </button>
          </div>
          {showMatched && (
            <div className="doc-table-wrap pp-enrichment-list__table-wrap">
              <table className="doc-table pp-enrichment-list__table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product name</th>
                    <th>Zoho stock</th>
                    <th>Sales 3M</th>
                    <th>Bundle 3M</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map((item) => (
                    <tr key={item.id || item.sku}>
                      <td className="pp-mono">{item.sku}</td>
                      <td>{item.itemName || '—'}</td>
                      <td>{fmt(item.currentZohoStock)}</td>
                      <td>{fmt(item.totalSalesLast3Months)}</td>
                      <td>{fmt(item.totalBundleUsageLast3Months)}</td>
                      <td className={getStockRemark(item) ? 'pp-remark pp-remark--danger' : 'pp-remark'}>
                        {getStockRemark(item) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

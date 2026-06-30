import { useState } from 'react'
import { exportUnmatchedOrders } from '../clearingExport'
import {
  AmountDifferencesTable,
  MatchedOrdersTable,
  NetNegativeReturnOrdersTable,
  SummaryCard,
  UnmatchedOrdersTable,
} from '../clearingShared'
import { RowTable } from '../components/RowTable'
import type { ClearingContext } from './clearingContext'

type Tab = 'matched' | 'returns' | 'unmatched' | 'missing' | 'differences'

export function Step3MatchSales({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  const [tab, setTab] = useState<Tab>('matched')
  if (!preview) return null
  const netNegativeReturnOrders = preview.netNegativeReturnOrders || []
  const missingOrderIdRows = (preview.allRows || []).filter((row) => row.status === 'missing_order_id')
  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'matched', label: 'Matched sales', count: preview.matchedOrders.length },
    { key: 'returns', label: 'Net-negative returns', count: netNegativeReturnOrders.length },
    { key: 'unmatched', label: 'Unmatched sales', count: preview.unmatchedOrders.length },
    { key: 'missing', label: 'Missing order ID', count: missingOrderIdRows.length },
    { key: 'differences', label: 'Amount differences', count: (preview.amountDifferences || []).length },
  ]
  return (
    <div className="apc-step-stack">
      <section className="apc-summary-grid">
        <SummaryCard label="Matched Sales" value={preview.matchedOrders.length} />
        <SummaryCard label="Net-negative Returns" value={netNegativeReturnOrders.length} />
        <SummaryCard label="Unmatched Sales" value={preview.unmatchedOrders.length} />
        <SummaryCard label="Missing Order ID" value={missingOrderIdRows.length} />
        <SummaryCard label="Amount Differences" value={(preview.amountDifferences || []).length} />
      </section>

      {netNegativeReturnOrders.length ? (
        <div className="apc-alert apc-alert--error" role="alert">
          <strong>{netNegativeReturnOrders.length} order(s) have negative principal/net in this settlement.</strong>{' '}
          They are excluded from invoice payment clearing and must be handled as Zoho sales returns / credit notes in
          Step 4. The system will try to match existing Zoho credit notes automatically; it never creates them.
        </div>
      ) : null}

      <div className="apc-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`apc-tab${tab === t.key ? ' apc-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="apc-chip__count">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === 'matched' ? <MatchedOrdersTable preview={preview} /> : null}
      {tab === 'returns' ? <NetNegativeReturnOrdersTable preview={preview} /> : null}
      {tab === 'unmatched' ? (
        <div className="apc-step-stack">
          {preview.unmatchedOrders.length ? (
            <div className="apc-button-row">
              <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => exportUnmatchedOrders(preview)}>
                Export Excel
              </button>
            </div>
          ) : null}
          <UnmatchedOrdersTable preview={preview} />
        </div>
      ) : null}
      {tab === 'missing' ? <RowTable rows={missingOrderIdRows} /> : null}
      {tab === 'differences' ? <AmountDifferencesTable preview={preview} /> : null}
    </div>
  )
}

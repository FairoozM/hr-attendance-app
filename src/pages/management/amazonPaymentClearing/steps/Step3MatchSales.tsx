import { useState } from 'react'
import { exportUnmatchedOrders } from '../clearingExport'
import { AmountDifferencesTable, MatchedOrdersTable, SummaryCard, UnmatchedOrdersTable } from '../clearingShared'
import { RowTable } from '../components/RowTable'
import type { ClearingContext } from './clearingContext'

type Tab = 'matched' | 'unmatched' | 'missing' | 'differences'

export function Step3MatchSales({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  const [tab, setTab] = useState<Tab>('matched')
  if (!preview) return null
  const missingOrderIdRows = (preview.allRows || []).filter((row) => row.status === 'missing_order_id')
  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'matched', label: 'Matched', count: preview.matchedOrders.length },
    { key: 'unmatched', label: 'Unmatched sales', count: preview.unmatchedOrders.length },
    { key: 'missing', label: 'Missing order ID', count: missingOrderIdRows.length },
    { key: 'differences', label: 'Amount differences', count: (preview.amountDifferences || []).length },
  ]
  return (
    <div className="apc-step-stack">
      <section className="apc-summary-grid">
        <SummaryCard label="Matched Orders" value={preview.matchedOrders.length} />
        <SummaryCard label="Unmatched Orders" value={preview.unmatchedOrders.length} />
        <SummaryCard label="Missing Order ID" value={missingOrderIdRows.length} />
        <SummaryCard label="Amount Differences" value={(preview.amountDifferences || []).length} />
      </section>

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

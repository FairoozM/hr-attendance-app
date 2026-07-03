import { exportParsedRows } from '../clearingExport'
import { money, PivotTable, SettlementLevelFeesTable, SummaryCard } from '../clearingShared'
import { FilterChips, RowTable } from '../components/RowTable'
import type { ClearingContext } from './clearingContext'

export function Step2ParsedRows({ ctx }: { ctx: ClearingContext }) {
  const { preview, search } = ctx
  if (!preview) return null
  const allRows = preview.allRows || []
  return (
    <div className="apc-step-stack">
      <section className="apc-summary-grid">
        <SummaryCard label="Parsed Rows" value={preview.rawRowCount} />
        <SummaryCard label="Amazon Settlement Total" value={money(preview.totals.amazonSettlementTotal)} />
        <SummaryCard label="Product Sales" value={money(preview.totals.productSalesTotal)} />
        <SummaryCard label="Amazon Fees" value={money(preview.totals.feesTotal)} />
        <SummaryCard label="Refund/Return Total" value={money(preview.totals.refundReturnTotal || 0)} />
        <SummaryCard label="Adjustments" value={money(preview.totals.adjustmentsTotal)} />
      </section>

      <div className="apc-stage-panel__header">
        <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>All parsed settlement rows</h3>
        <div className="apc-button-row">
          <input
            className="ainv-input apc-search-input"
            value={search.filter.search}
            onChange={(e) => search.setSearch(e.target.value)}
            placeholder="Search order ID, category, description..."
          />
          <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => exportParsedRows(allRows)}>
            Export Excel
          </button>
          {search.filter.rowNumbers ? (
            <button className="ainv-btn ainv-btn--sm" type="button" onClick={search.reset}>
              Clear row focus
            </button>
          ) : null}
        </div>
      </div>
      <FilterChips active={search.filter.status} counts={search.counts} onSelect={search.setStatus} />
      <RowTable
        rows={search.filtered}
        focusedRowNumbers={search.filter.rowNumbers}
        canMarkAccountLevelFee={!ctx.isPosted}
        onMarkAccountLevelFee={ctx.onMarkAccountLevelFee}
      />

      <details className="apc-details">
        <summary>Category breakdown &amp; settlement-level fees</summary>
        <div className="apc-step-stack">
          <PivotTable preview={preview} />
          <h4 className="ainv-page__title" style={{ fontSize: '0.95rem' }}>Settlement-Level Fees</h4>
          <p className="apc-muted">Charges without an Amazon order ID (advertising, premium service fees, storage). Not matched to Zoho.</p>
          <SettlementLevelFeesTable preview={preview} />
        </div>
      </details>
    </div>
  )
}

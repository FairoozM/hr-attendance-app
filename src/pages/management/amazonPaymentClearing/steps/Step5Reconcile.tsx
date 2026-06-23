import { exportBlockingIssues } from '../clearingExport'
import { money, SettlementReconciliation, SummaryCard } from '../clearingShared'
import { BlockingIssuesPanel } from '../components/BlockingIssuesPanel'
import type { ClearingContext } from './clearingContext'

export function Step5Reconcile({ ctx }: { ctx: ClearingContext }) {
  const { preview, search } = ctx
  if (!preview) return null
  const issues = preview.blockingIssues || []
  return (
    <div className="apc-step-stack">
      <section className="apc-summary-grid">
        <SummaryCard label="Order Net Balance" value={money(preview.reconciliationSummary.orderLevelNetBalance)} />
        <SummaryCard label="Refund/Return Impact" value={money(preview.reconciliationSummary.refundReturnImpact || 0)} />
        <SummaryCard label="Settlement Deductions" value={money(preview.reconciliationSummary.settlementLevelDeductions)} />
        <SummaryCard label="Expected Deposit" value={money(preview.reconciliationSummary.expectedAmazonDeposit)} />
        <SummaryCard label="Actual Settlement" value={money(preview.reconciliationSummary.actualAmazonSettlement)} />
        <SummaryCard label="Difference" value={money(preview.reconciliationSummary.reconciliationDifference)} />
      </section>

      <SettlementReconciliation preview={preview} />

      <div className="apc-stage-panel__header">
        <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Blocking issues</h3>
        {issues.length ? (
          <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => exportBlockingIssues(issues)}>
            Export Excel
          </button>
        ) : null}
      </div>
      <BlockingIssuesPanel
        issues={issues}
        onViewRows={(rowNumbers) => {
          search.focusRows(rowNumbers)
          const el = document.getElementById('apc-step-2')
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
      />

      {preview.warnings.length ? (
        <details className="apc-details">
          <summary>Warnings ({preview.warnings.length})</summary>
          <div className="apc-alert">
            <ul>
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </div>
  )
}

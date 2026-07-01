import { useState } from 'react'
import { exportCreditNoteRows } from '../clearingExport'
import { ReturnCreditNotesTable, SummaryCard } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

type Tab = 'matched' | 'ready_to_create' | 'missing' | 'differences'

export function Step4Returns({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  const [tab, setTab] = useState<Tab>('matched')
  if (!preview) return null
  const matchedReturns = (preview.matchedReturns || []).filter((row) => row.status === 'matched')
  const readyToCreate = (preview.matchedReturns || []).filter((row) => row.status === 'ready_to_create')
  const blockingRows = preview.creditNoteBlockingRows || []
  const diffRows = (preview.matchedReturns || []).filter((row) => Math.abs(Number(row.creditNoteDifference) || 0) > 0.01)
  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'matched', label: 'Matched returns', count: matchedReturns.length },
    { key: 'ready_to_create', label: 'Will create at clearance', count: readyToCreate.length },
    { key: 'missing', label: 'Missing / blocked', count: blockingRows.length },
    { key: 'differences', label: 'Amount differences', count: diffRows.length },
  ]
  return (
    <div className="apc-step-stack">
      <section className="apc-summary-grid">
        <SummaryCard label="Refund/Return Rows" value={(preview.refundReturnRows || []).length} />
        <SummaryCard label="Matched Credit Notes" value={matchedReturns.length} />
        <SummaryCard label="Will Create" value={readyToCreate.length} />
        <SummaryCard label="Missing / Blocked" value={blockingRows.length} />
      </section>

      {blockingRows.length ? (
        <div className="apc-alert apc-alert--error" role="alert">
          These refund/return rows block approval until the invoice relationship or credit note amount is fixed.
        </div>
      ) : readyToCreate.length ? (
        <div className="apc-alert" role="status">
          {readyToCreate.length} return(s) have no Zoho credit note yet. Step 8 will create and apply them after approval.
        </div>
      ) : (
        <div className="apc-alert" role="status">All refund/return rows are matched to clean Zoho credit notes.</div>
      )}

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
        {blockingRows.length ? (
          <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => exportCreditNoteRows(blockingRows)}>
            Export blocked
          </button>
        ) : null}
      </div>

      {tab === 'matched' ? (
        <ReturnCreditNotesTable rows={matchedReturns} emptyText="No matched refund/return credit notes." />
      ) : null}
      {tab === 'ready_to_create' ? (
        <ReturnCreditNotesTable rows={readyToCreate} emptyText="No returns marked for clearance-time credit note creation." />
      ) : null}
      {tab === 'missing' ? (
        <ReturnCreditNotesTable rows={blockingRows} emptyText="No missing or blocked credit-note rows." />
      ) : null}
      {tab === 'differences' ? (
        <ReturnCreditNotesTable rows={diffRows} emptyText="No credit-note amount differences above 0.01." />
      ) : null}
    </div>
  )
}

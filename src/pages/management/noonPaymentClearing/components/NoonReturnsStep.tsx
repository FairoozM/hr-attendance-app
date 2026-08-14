import { useEffect, useMemo, useState } from 'react'
import type { NoonPaymentClearingPreview, NoonReturnCreditNoteRow } from '../../../../api/noonPaymentClearing'

type Tab = 'matched' | 'blocked' | 'differences'

function money(n: number | null | undefined) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function mergeBlockingReturnRows(
  creditNoteBlockingRows: NoonReturnCreditNoteRow[] | undefined,
  matchedReturns: NoonReturnCreditNoteRow[] | undefined
) {
  const byItem = new Map<string, NoonReturnCreditNoteRow>()
  for (const row of creditNoteBlockingRows || []) {
    const key = String(row.itemOrderId || '').trim()
    if (key) byItem.set(key, row)
  }
  for (const row of matchedReturns || []) {
    if (row.status !== 'blocked' && !row.blockCode) continue
    const key = String(row.itemOrderId || '').trim()
    if (!key || byItem.has(key)) continue
    byItem.set(key, row)
  }
  return Array.from(byItem.values())
}

function ReturnsTable({
  rows,
  emptyText,
}: {
  rows: NoonReturnCreditNoteRow[]
  emptyText: string
}) {
  if (!rows.length) {
    return <p className="npc-muted">{emptyText}</p>
  }
  return (
    <div className="npc-table-wrap">
      <table className="npc-table">
        <thead>
          <tr>
            <th>Item Order</th>
            <th>Refund</th>
            <th>Commission rev.</th>
            <th>Invoice</th>
            <th>Credit Note</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`ret-${row.itemOrderId}-${row.status}-${row.blockCode || ''}`}>
              <td>
                <code className="npc-ref">{row.itemOrderId}</code>
              </td>
              <td className="npc-money">{money(row.productRefundAmount)}</td>
              <td className="npc-money">{money(row.commissionReversalGross)}</td>
              <td>{row.zohoInvoiceNumber || '—'}</td>
              <td>{row.zohoCreditNoteNumber || '—'}</td>
              <td>{row.blockCode || row.status || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function NoonReturnsStep({
  preview,
  loading,
  onRefresh,
}: {
  preview: NoonPaymentClearingPreview
  loading: boolean
  onRefresh: () => Promise<void>
}) {
  const returnRowCount = preview.refundReturnRows?.length ?? preview.totals?.returnRowCount ?? 0
  const matchedReturns = useMemo(
    () => (preview.matchedReturns || []).filter((row) => row.status === 'matched'),
    [preview.matchedReturns]
  )
  const blockingRows = useMemo(
    () => mergeBlockingReturnRows(preview.creditNoteBlockingRows, preview.matchedReturns),
    [preview.creditNoteBlockingRows, preview.matchedReturns]
  )
  const diffRows = useMemo(
    () =>
      (preview.matchedReturns || []).filter((row) => Math.abs(Number(row.creditNoteDifference) || 0) > 0.01),
    [preview.matchedReturns]
  )
  const [tab, setTab] = useState<Tab>('matched')

  useEffect(() => {
    if (returnRowCount === 0) return
    if (blockingRows.length > 0) setTab('blocked')
    else setTab('matched')
  }, [preview.batchId, blockingRows.length, returnRowCount])

  if (returnRowCount === 0) {
    return (
      <div className="npc-step-stack">
        <div className="npc-alert npc-approved-panel" role="status">
          No sales returns in this statement.
        </div>
      </div>
    )
  }

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'matched', label: 'Matched', count: matchedReturns.length },
    { key: 'blocked', label: 'Missing / blocked', count: blockingRows.length },
    { key: 'differences', label: 'Amount differences', count: diffRows.length },
  ]

  return (
    <div className="npc-step-stack">
      <div className="npc-summary-grid">
        <div className="ainv-summary-card">
          <span>Return rows</span>
          <strong>{returnRowCount}</strong>
        </div>
        <div className="ainv-summary-card">
          <span>Matched credit notes</span>
          <strong>{matchedReturns.length}</strong>
        </div>
        <div className="ainv-summary-card">
          <span>Blocked</span>
          <strong>{blockingRows.length}</strong>
        </div>
      </div>

      {blockingRows.length > 0 ? (
        <div className="npc-alert npc-alert--error" role="alert">
          These return rows block approval until each item order is matched to a Zoho Credit Note with the correct
          amount.
        </div>
      ) : (
        <div className="npc-alert npc-approved-panel" role="status">
          All return rows are matched to Zoho credit notes.
        </div>
      )}

      <div className="npc-button-row">
        <button type="button" className="ainv-btn" disabled={loading} onClick={() => void onRefresh()}>
          {loading ? 'Refreshing…' : 'Refresh from Zoho'}
        </button>
      </div>

      <div className="npc-button-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`ainv-btn ainv-btn--sm${tab === t.key ? ' ainv-btn--primary-sky' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {tab === 'matched' ? (
        <ReturnsTable rows={matchedReturns} emptyText="No matched return credit notes yet." />
      ) : null}
      {tab === 'blocked' ? (
        <ReturnsTable rows={blockingRows} emptyText="No missing or blocked return rows." />
      ) : null}
      {tab === 'differences' ? (
        <ReturnsTable rows={diffRows} emptyText="No credit note amount differences above 0.01." />
      ) : null}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { resolveApiUrl } from '../../api/client'
import {
  getPublicAmazonReturnReport,
  publicAmazonReturnLabelUrl,
  updatePublicCombinedStockRow,
  type AgentCombinedStockRow,
  type AgentReportDetail,
  type ProcessingStatusPatch,
} from '../../api/amazonReturnReconciliation'
import '../management/amazonReturnReconciliation/AmazonReturnReconciliationPage.css'

function safeError(err: unknown) {
  return err instanceof Error ? err.message : 'Request failed'
}

function AgentRow({
  row,
  publicToken,
  onUpdate,
}: {
  row: AgentCombinedStockRow
  publicToken: string
  onUpdate: (row: AgentCombinedStockRow, patch: ProcessingStatusPatch) => Promise<void>
}) {
  const [agentNotes, setAgentNotes] = useState(row.agentNotes)
  const [saving, setSaving] = useState(false)
  const [local, setLocal] = useState({
    labelDownloaded: row.labelDownloaded,
    labelPrinted: row.labelPrinted,
    relabeled: row.relabeled,
    packed: row.packed,
    readyForShipment: row.readyForShipment,
  })

  useEffect(() => {
    setAgentNotes(row.agentNotes)
    setLocal({
      labelDownloaded: row.labelDownloaded,
      labelPrinted: row.labelPrinted,
      relabeled: row.relabeled,
      packed: row.packed,
      readyForShipment: row.readyForShipment,
    })
  }, [row])

  const save = async () => {
    setSaving(true)
    try {
      await onUpdate(row, { ...local, agentNotes })
    } finally {
      setSaving(false)
    }
  }

  const toggle = (key: keyof typeof local) => {
    setLocal((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <tr>
      <td><strong>{row.workingSku}</strong></td>
      <td>{row.totalAvailableQty}</td>
      <td>
        {row.label ? (
          <a
            className="btn btn--ghost btn--sm"
            href={resolveApiUrl(publicAmazonReturnLabelUrl(publicToken, row.label.id))}
            onClick={() => setLocal((prev) => ({ ...prev, labelDownloaded: true }))}
          >
            Download Label
          </a>
        ) : (
          <span className="arr-badge arr-badge--muted">Not Uploaded</span>
        )}
      </td>
      {(['labelPrinted', 'relabeled', 'packed', 'readyForShipment'] as const).map((key) => (
        <td key={key}>
          <label className="arr-check arr-check--center">
            <input type="checkbox" checked={local[key]} onChange={() => toggle(key)} />
          </label>
        </td>
      ))}
      <td>
        <textarea
          className="arr-input arr-note"
          value={agentNotes}
          onChange={(e) => setAgentNotes(e.target.value)}
          placeholder="Notes"
        />
      </td>
      <td>
        <button className="btn btn--primary btn--sm" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </td>
    </tr>
  )
}

export function AmazonReturnReportPage() {
  const { publicToken = '' } = useParams()
  const [detail, setDetail] = useState<AgentReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!publicToken) return
    setLoading(true)
    setError('')
    try {
      setDetail(await getPublicAmazonReturnReport(publicToken))
    } catch (err) {
      setError(safeError(err))
    } finally {
      setLoading(false)
    }
  }, [publicToken])

  useEffect(() => {
    void load()
  }, [load])

  const updateRow = async (row: AgentCombinedStockRow, patch: ProcessingStatusPatch) => {
    if (!publicToken) return
    setError('')
    try {
      setDetail(await updatePublicCombinedStockRow(publicToken, row.id, patch))
    } catch (err) {
      setError(safeError(err))
    }
  }

  return (
    <main className="arr-public-shell">
      <div className="arr-page">
        <header className="doc-page-hero">
          <div>
            <h1 className="doc-page-title">Life Smile Stock Relabeling Sheet</h1>
            <p className="doc-page-subtitle">
              Please download labels, relabel available stock, pack, and mark ready for shipment.
            </p>
          </div>
        </header>

        {loading ? <div className="page-loading">Loading relabeling sheet...</div> : null}
        {error ? <div className="page-error">{error}</div> : null}

        {detail ? (
          <>
            <section className="arr-card">
              <div className="arr-section-title">
                <h2>{detail.batch.title}</h2>
                <span>{detail.batch.marketplace} · {detail.batch.agentName || 'Agent'}</span>
              </div>
              <div className="arr-summary-grid">
                <div className="arr-summary-card"><strong>{detail.summary.totalAvailableSkus}</strong><span>Available SKUs</span></div>
                <div className="arr-summary-card"><strong>{detail.summary.totalAvailableQty}</strong><span>Total Available Qty</span></div>
              </div>
            </section>

            <section className="arr-card">
              <div className="arr-section-title">
                <h2>Available Stock</h2>
                <span>{detail.combinedStock.length} SKUs to relabel</span>
              </div>
              <div className="arr-table-wrap">
                <table className="arr-table arr-table--agent">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Total Available Qty</th>
                      <th>Label Download</th>
                      <th>Label Printed</th>
                      <th>Relabeled</th>
                      <th>Packed</th>
                      <th>Ready for Shipment</th>
                      <th>Notes</th>
                      <th>Save</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.combinedStock.map((row) => (
                      <AgentRow key={row.id} row={row} publicToken={publicToken} onUpdate={updateRow} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  )
}

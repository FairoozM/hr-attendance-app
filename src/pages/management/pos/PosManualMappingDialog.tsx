import { useEffect, useState } from 'react'
import {
  getPosManualMappings,
  posErrorBody,
  revokePosManualMapping,
  savePosManualMapping,
  searchPosInvoices,
  type PosInvoiceRef,
  type PosManualMapping,
  type PosTransaction,
} from '../../../api/posSettlements'
import { Modal } from '../../../components/Modal'
import { formatAed, formatDateTime, humanize } from './posFormat'

type Row = { invoice: PosInvoiceRef; amount: string }

/** Whole fils from typed text; null when it is not an amount with at most two decimals. */
function toFils(text: string): number | null {
  const s = text.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2))
}

const fils = (major: number | null) => Math.round((major || 0) * 100)

export function PosManualMappingDialog({ txn, onClose, onSaved }: { txn: PosTransaction; onClose: () => void; onSaved: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PosInvoiceRef[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [reason, setReason] = useState('')
  const [history, setHistory] = useState<PosManualMapping[]>([])
  const [revokeReason, setRevokeReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getPosManualMappings(txn.id)
      .then((res) => alive && setHistory(res.mappings))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [txn.id])

  const grossFils = fils(txn.gross)
  const allocatedFils = rows.reduce((s, r) => s + (toFils(r.amount) ?? 0), 0)
  const customers = new Set(rows.map((r) => r.invoice.customerId))
  const invalidAmount = rows.some((r) => {
    const f = toFils(r.amount)
    return f == null || f <= 0 || f > r.invoice.balanceMinor
  })
  const problems = [
    customers.size > 1 ? 'All invoices must belong to the same Zoho customer.' : null,
    rows.length && allocatedFils !== grossFils ? `Allocated ${formatAed(allocatedFils / 100)} of ${formatAed(txn.gross)}.` : null,
    invalidAmount ? 'Each amount must be positive, at most two decimals, and within the invoice balance.' : null,
    reason.trim().length < 5 ? 'Give the reason (at least 5 characters).' : null,
  ].filter(Boolean) as string[]
  const active = history.find((m) => m.state === 'ACTIVE') || null

  function add(invoice: PosInvoiceRef) {
    if (rows.some((r) => r.invoice.invoiceId === invoice.invoiceId)) return
    const left = Math.max(0, grossFils - allocatedFils)
    const amount = Math.min(left, invoice.balanceMinor)
    setRows([...rows, { invoice, amount: (amount / 100).toFixed(2) }])
  }

  async function search() {
    if (query.trim().length < 3) return
    setBusy(true)
    setError(null)
    try {
      setResults((await searchPosInvoices(query.trim())).invoices)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (problems.length) return
    setBusy(true)
    setError(null)
    try {
      await savePosManualMapping(txn.id, rows.map((r) => ({ invoiceId: r.invoice.invoiceId, amount: r.amount.trim() })), reason.trim())
      onSaved()
    } catch (err) {
      const body = posErrorBody(err)
      setError(body?.error || (err instanceof Error ? err.message : 'Could not save the mapping.'))
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!active || revokeReason.trim().length < 5) return
    setBusy(true)
    setError(null)
    try {
      await revokePosManualMapping(active.id, revokeReason.trim())
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke the mapping.')
    } finally {
      setBusy(false)
    }
  }

  const invoiceLine = (i: PosInvoiceRef) => `${i.invoiceNumber} · order ${i.referenceNumber || '—'} · ${i.customerName} · ${i.date} · balance ${formatAed(i.balanceMinor / 100)}`

  return (
    <Modal title={`Map RRN ${txn.rrn || '—'} to Zoho invoices`} open onClose={onClose} panelClassName="pos-mapping-dialog">
      <div className="tabby-page__stack">
        <p className="tabby-page__note">
          Gross {formatAed(txn.gross)} · {txn.transactionDate} · TID {txn.terminalId || '—'} · automatic result: {humanize(txn.match.status)}. One transaction never pays two customers; the amounts must add up to the gross. Zoho is re-checked before posting.
        </p>
        {error ? <div className="tabby-page__banner tabby-page__banner--error">{error}</div> : null}

        {active ? (
          <section className="tabby-page__card">
            <h3>Active mapping</h3>
            <p className="tabby-page__sub">
              {active.allocations.map((a) => `${a.invoiceNumber} ${formatAed((a.grossMinor || 0) / 100)}`).join(' + ')} · by {active.createdBy} {formatDateTime(active.createdAt)} · {active.reason}
            </p>
            <div className="tabby-page__upload">
              <input aria-label="Revoke reason" placeholder="Reason for revoking" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} disabled={busy} />
              <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy || revokeReason.trim().length < 5} onClick={revoke}>
                Revoke mapping
              </button>
            </div>
          </section>
        ) : null}

        {txn.match.possible.length ? (
          <section>
            <h4>Possible matches (same amount, close date — not automatic)</h4>
            {txn.match.possible.map((i) => (
              <button key={i.invoiceId} type="button" className="tabby-page__link" onClick={() => add(i)} disabled={busy}>
                {invoiceLine(i)}
              </button>
            ))}
          </section>
        ) : null}

        <div className="tabby-page__upload">
          <input
            aria-label="Search invoices"
            placeholder="Invoice number, order number or customer"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            disabled={busy}
          />
          <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy || query.trim().length < 3} onClick={search}>
            Search Zoho
          </button>
        </div>
        {results.length ? (
          <ul className="pos-mapping-dialog__results">
            {results.map((i) => (
              <li key={i.invoiceId}>
                <button type="button" className="tabby-page__link" disabled={busy || i.balanceMinor <= 0} onClick={() => add(i)}>
                  {invoiceLine(i)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {rows.length ? (
          <table className="tabby-page__table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th className="num">Balance</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.invoice.invoiceId}>
                  <td>{r.invoice.invoiceNumber}</td>
                  <td>{r.invoice.customerName}</td>
                  <td className="num">{formatAed(r.invoice.balanceMinor / 100)}</td>
                  <td className="num">
                    <input
                      aria-label={`Amount for ${r.invoice.invoiceNumber}`}
                      inputMode="decimal"
                      value={r.amount}
                      onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
                      disabled={busy}
                    />
                  </td>
                  <td>
                    <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy} onClick={() => setRows(rows.filter((_, i) => i !== idx))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <textarea aria-label="Reason" placeholder="Why does this transaction pay these invoices? (kept in the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} disabled={busy} />
        {rows.length && problems.length ? (
          <ul className="tabby-page__issue">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <div className="tabby-page__actions">
          <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={busy || !rows.length || problems.length > 0} onClick={save}>
            {busy ? 'Saving…' : 'Save mapping'}
          </button>
          <button type="button" className="ainv-btn ainv-btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>

        {history.length ? (
          <section>
            <h4>History</h4>
            <ul className="tabby-page__sub">
              {history.map((m) => (
                <li key={m.id}>
                  {m.state === 'ACTIVE' ? 'Active' : `Revoked by ${m.revokedBy} (${m.revokeReason})`} · {m.allocations.map((a) => a.invoiceNumber).join(', ')} · by {m.createdBy} {formatDateTime(m.createdAt)} · automatic was {humanize(m.autoResult?.status)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  )
}

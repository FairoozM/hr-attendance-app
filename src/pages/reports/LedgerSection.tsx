import { useMemo, useState } from 'react'

export type LedgerRow = {
  reference?: string
  description?: string
  debit?: number | null
  credit?: number | null
  sale?: number | null
  balance?: number | null
  runningBalance?: number | null
  isSalesReturn?: boolean
  isSummary?: boolean
}

export type LedgerSectionData = {
  key?: string
  title: string
  opening: number
  closing: number
  netMovement?: number
  rows?: LedgerRow[]
  columns?: string[]
  configMissing?: boolean
  warnings?: string[]
  accountName?: string
  accountCode?: string
}

function fmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Props = {
  section: LedgerSectionData
  defaultExpanded?: boolean
  showSaleColumn?: boolean
}

export function LedgerSection({ section, defaultExpanded = false, showSaleColumn }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [query, setQuery] = useState('')
  const cols = section.columns || ['reference', 'description', 'debit', 'credit', 'balance']
  const useSale = showSaleColumn ?? cols.includes('sale')

  const filtered = useMemo(() => {
    const rows = section.rows || []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const hay = `${r.reference || ''} ${r.description || ''} ${r.debit ?? ''} ${r.credit ?? ''} ${r.sale ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [section.rows, query])

  return (
    <section className={`del-section ${section.configMissing ? 'del-section--warn' : ''}`}>
      <header className="del-section__head">
        <button type="button" className="del-section__toggle" onClick={() => setExpanded((v) => !v)}>
          <span className="del-section__chevron">{expanded ? '▾' : '▸'}</span>
          <h2>{section.title}</h2>
        </button>
        <div className="del-section__summary">
          <span>
            Opening <strong>{fmt(section.opening)}</strong>
          </span>
          <span>
            Movement <strong>{fmt(section.netMovement ?? section.closing - section.opening)}</strong>
          </span>
          <span>
            Closing <strong>{fmt(section.closing)}</strong>
          </span>
        </div>
      </header>

      {section.configMissing && (
        <p className="del-section__note">Not configured — set the Zoho account ID in ledger config.</p>
      )}
      {(section.warnings || []).map((w) => (
        <p key={w} className="del-section__note">
          {w}
        </p>
      ))}

      {expanded && !section.configMissing && (
        <div className="del-section__body">
          <div className="del-section__toolbar">
            <input
              className="del-section__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reference, description, amount…"
            />
            {(section.accountCode || section.accountName) && (
              <span className="del-section__acct">
                {section.accountCode ? `${section.accountCode} · ` : ''}
                {section.accountName}
              </span>
            )}
          </div>
          <div className="del-table-wrap">
            <table className="del-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Description</th>
                  {useSale ? <th className="num">Sale</th> : null}
                  {cols.includes('debit') ? <th className="num">DR</th> : null}
                  {cols.includes('credit') ? <th className="num">CR</th> : null}
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="del-row--open">
                  <td colSpan={useSale ? 3 : 2}>Opening</td>
                  {cols.includes('debit') ? <td /> : null}
                  {cols.includes('credit') ? <td /> : null}
                  <td className="num">{fmt(section.opening)}</td>
                </tr>
                {filtered.map((row, idx) => (
                  <tr
                    key={`${row.reference}-${idx}`}
                    className={row.isSalesReturn ? 'del-row--return' : row.isSummary ? 'del-row--sum' : undefined}
                  >
                    <td>{row.reference || '—'}</td>
                    <td>{row.description || '—'}</td>
                    {useSale ? (
                      <td className={`num ${Number(row.sale) < 0 ? 'neg' : ''}`}>{fmt(row.sale)}</td>
                    ) : null}
                    {cols.includes('debit') ? <td className="num">{row.debit ? fmt(row.debit) : ''}</td> : null}
                    {cols.includes('credit') ? <td className="num">{row.credit ? fmt(row.credit) : ''}</td> : null}
                    <td className="num">{fmt(row.balance ?? row.runningBalance)}</td>
                  </tr>
                ))}
                <tr className="del-row--close">
                  <td colSpan={useSale ? 3 : 2}>Closing</td>
                  {cols.includes('debit') ? <td /> : null}
                  {cols.includes('credit') ? <td /> : null}
                  <td className="num">{fmt(section.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

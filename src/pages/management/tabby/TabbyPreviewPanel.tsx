import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  getTabbyActivity,
  type TabbyBank,
  type TabbyComponent,
  type TabbyEvent,
  type TabbyIssue,
  type TabbyPreview,
  type TabbyRow,
} from '../../../api/tabbyClearing'
import {
  bankStatusTone,
  batchStatusTone,
  formatAed,
  formatDateTime,
  humanize,
  matchTone,
  recoveryTone,
  type Tone,
} from './tabbyFormat'

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`tabby-pill tabby-pill--${tone}`}>{children}</span>
}

function Figures({ title, rows }: { title: string; rows: Array<[string, number | string, boolean?]> }) {
  return (
    <section className="tabby-page__card tabby-page__figures">
      <h3>{title}</h3>
      <dl>
        {rows.map(([label, value, strong]) => (
          <div key={label} className={strong ? 'tabby-page__figure--strong' : undefined}>
            <dt>{label}</dt>
            <dd>{typeof value === 'number' ? formatAed(value) : value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function IssueList({ title, issues, tone }: { title: string; issues: TabbyIssue[]; tone: 'error' | 'warning' }) {
  if (!issues.length) return null
  return (
    <div className={`tabby-page__banner tabby-page__banner--${tone}`}>
      <strong>
        {title} ({issues.length})
      </strong>
      <ul>
        {issues.map((i, idx) => (
          <li key={`${i.code}-${idx}`}>
            <span className="tabby-page__mono">{i.code}</span> {i.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function BankCard({
  bank,
  busy,
  onChoose,
}: {
  bank: TabbyBank
  busy: boolean
  onChoose: (transactionId: string) => void
}) {
  const showPicker = bank.status === 'BANK_MATCH_AMBIGUOUS' || (bank.status === 'BANK_MATCHED' && bank.candidates.length > 1)
  return (
    <section className="tabby-page__card">
      <header className="tabby-page__card-head">
        <h3>Bank payout {formatAed(bank.amount)} AED</h3>
        <Pill tone={bankStatusTone(bank.status)}>{humanize(bank.status)}</Pill>
      </header>
      <p className="tabby-page__note">{bank.reason}</p>
      {bank.matched ? (
        <p className="tabby-page__note">
          Zoho transfer <span className="tabby-page__mono">{bank.matched.transactionId}</span> on {bank.matched.date}
          {bank.matched.referenceNumber ? ` · ${bank.matched.referenceNumber}` : ''}
          {bank.linkedTransactionId === bank.matched.transactionId ? ' · linked' : ' · links when posted'}
        </p>
      ) : null}
      {bank.window ? (
        <p className="tabby-page__sub">
          Searched {bank.window.start} to {bank.window.end}
        </p>
      ) : null}
      {showPicker ? (
        <table className="tabby-page__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Reference</th>
              <th>Transaction</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bank.candidates.map((t) => (
              <tr key={t.transactionId}>
                <td>{t.date}</td>
                <td>{t.referenceNumber || '—'}</td>
                <td className="tabby-page__mono">{t.transactionId}</td>
                <td>
                  <button
                    type="button"
                    className="ainv-btn ainv-btn--ghost"
                    disabled={busy || bank.linkedTransactionId === t.transactionId}
                    onClick={() => onChoose(t.transactionId)}
                  >
                    {bank.linkedTransactionId === t.transactionId ? 'Linked' : 'Use this transfer'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {bank.skipped?.length ? (
        <p className="tabby-page__sub">
          Already settling other statements:{' '}
          {bank.skipped.map((t) => `${t.date} ${t.referenceNumber || t.transactionId} (${t.claimedBy})`).join('; ')}
        </p>
      ) : null}
    </section>
  )
}

function RowsTable({ rows }: { rows: TabbyRow[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const visible = rows.filter((r) => r.kind === 'SALE' || r.kind === 'REFUND' || r.kind === 'PAYOUT_FEE' || r.kind === 'UNKNOWN')
  return (
    <div className="tabby-page__scroll">
      <table className="tabby-page__table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Kind</th>
            <th>Order #</th>
            <th>Website order</th>
            <th className="num">Gross</th>
            <th className="num">Total fee</th>
            <th className="num">VAT</th>
            <th className="num">Transferred</th>
            <th>Match</th>
            <th>Invoice</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const problems = [...r.problems, ...(r.warnings || [])]
            const matchStatus = r.kind === 'PAYOUT_FEE' ? null : r.match?.status || 'NOT_CHECKED'
            return (
              <Fragment key={r.excelRow}>
                <tr className="tabby-page__clickable" onClick={() => setOpen(open === r.excelRow ? null : r.excelRow)}>
                  <td>{r.excelRow}</td>
                  <td>
                    {humanize(r.kind)}
                    {r.signNormalized ? <div className="tabby-page__sub">sign normalized</div> : null}
                  </td>
                  <td className="tabby-page__mono">{r.orderNumber || '—'}</td>
                  <td className="tabby-page__mono">{r.websiteOrderId || '—'}</td>
                  <td className="num">{formatAed(r.amounts.orderAmount)}</td>
                  <td className="num">{formatAed(r.amounts.totalFee)}</td>
                  <td className="num">{formatAed(r.amounts.vatAmount)}</td>
                  <td className="num">{formatAed(r.amounts.transferredAmount)}</td>
                  <td>
                    {matchStatus ? <Pill tone={matchTone(matchStatus)}>{humanize(matchStatus)}</Pill> : '—'}
                    {r.refund?.code ? (
                      <div>
                        <Pill tone="bad">{humanize(r.refund.code)}</Pill>
                      </div>
                    ) : null}
                    {problems.length ? <div className="tabby-page__issue">{problems.length} issue(s)</div> : null}
                  </td>
                  <td>
                    {r.match?.invoice ? (
                      <>
                        {r.match.invoice.invoiceNumber}
                        <div className="tabby-page__sub">
                          {formatAed(r.match.invoice.balance)} of {formatAed(r.match.invoice.total)} due
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
                {open === r.excelRow ? (
                  <tr className="tabby-page__detail">
                    <td colSpan={10}>
                      <div className="tabby-page__detail-grid">
                        <div>
                          <h4>Statement amounts</h4>
                          <dl>
                            {Object.entries(r.amounts).map(([k, v]) => (
                              <div key={k}>
                                <dt>{humanize(k)}</dt>
                                <dd>{formatAed(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                        {r.effects ? (
                          <div>
                            <h4>Accounting effect</h4>
                            <dl>
                              {Object.entries(r.effects).map(([k, v]) => (
                                <div key={k}>
                                  <dt>{humanize(k)}</dt>
                                  <dd>{formatAed(v)}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        ) : null}
                        <div>
                          <h4>Match</h4>
                          {r.match?.reason ? <p>{r.match.reason}</p> : null}
                          {r.match?.order ? (
                            <p>
                              Website order {r.match.order.orderId} · {r.match.order.status || '—'} ·{' '}
                              {r.match.order.paymentMethod || '—'} · {formatAed(r.match.order.total)}
                              {r.match.order.shopOrder ? ' · shop order' : ''}
                            </p>
                          ) : null}
                          {r.match?.customerId ? <p className="tabby-page__mono">Customer {r.match.customerId}</p> : null}
                          {r.match?.invoiceState ? <p>Invoice {humanize(r.match.invoiceState)}</p> : null}
                          {r.refund ? (
                            <>
                              <h4>Refund</h4>
                              <p>
                                {humanize(r.refund.kind)} · sequence {r.refund.sequence ?? '—'} · prior{' '}
                                {formatAed(r.refund.priorRefunded)} · cumulative {formatAed(r.refund.cumulativeRefunded)}
                              </p>
                              {r.refund.problem ? <p className="tabby-page__issue">{r.refund.problem}</p> : null}
                              {r.refund.creditNote ? (
                                <p>
                                  Credit note {r.refund.creditNote.creditNoteNumber} ({humanize(r.refund.creditNote.how)}) ·
                                  balance {formatAed(r.refund.creditNote.balance)}
                                </p>
                              ) : null}
                              {r.refund.creditNoteProblem ? (
                                <p className="tabby-page__issue">{r.refund.creditNoteProblem.message}</p>
                              ) : null}
                            </>
                          ) : null}
                          {problems.map((p, i) => (
                            <p key={`${p.code}-${i}`} className="tabby-page__issue">
                              <span className="tabby-page__mono">{p.code}</span> {p.message}
                            </p>
                          ))}
                          {r.fingerprint ? <p className="tabby-page__sub tabby-page__mono">{r.fingerprint.slice(0, 16)}…</p> : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function componentAccounts(c: TabbyComponent): string {
  if (c.lines.length) return c.lines.map((l) => `${l.side === 'debit' ? 'Dr' : 'Cr'} ${l.account} ${formatAed(l.amount)}`).join(' · ')
  if (c.fromAccount || c.toAccount) return `${c.fromAccount || '—'} → ${c.toAccount || '—'}`
  if (c.depositAccount) return `Deposit to ${c.depositAccount}`
  return '—'
}

function ComponentsTable({ components }: { components: TabbyComponent[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="tabby-page__scroll">
      <table className="tabby-page__table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Reference</th>
            <th className="num">Amount</th>
            <th>Accounts</th>
            <th>Local</th>
            <th>Zoho</th>
            <th>Next step</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <Fragment key={c.key}>
              <tr className="tabby-page__clickable" onClick={() => setOpen(open === c.key ? null : c.key)}>
                <td>
                  {humanize(c.component)}
                  <div className="tabby-page__sub">
                    {humanize(c.zohoRecordType)}
                    {c.allocations.length > 1 ? ` · ${c.allocations.length} invoices` : ''}
                  </div>
                </td>
                <td className="tabby-page__mono">{c.reference}</td>
                <td className="num">{formatAed(c.amount)}</td>
                <td className="tabby-page__accounts">{componentAccounts(c)}</td>
                <td>
                  {c.local ? humanize(c.local.status) : 'Not started'}
                  {c.local?.attemptCount ? <div className="tabby-page__sub">{c.local.attemptCount} attempt(s)</div> : null}
                </td>
                <td>
                  {c.zoho ? humanize(c.zoho.state) : '—'}
                  {c.zoho?.recordId ? <div className="tabby-page__sub tabby-page__mono">{c.zoho.recordId}</div> : null}
                </td>
                <td>
                  <Pill tone={recoveryTone(c.recovery.action)}>{humanize(c.recovery.action)}</Pill>
                </td>
              </tr>
              {open === c.key ? (
                <tr className="tabby-page__detail">
                  <td colSpan={7}>
                    {c.recovery.reason ? <p>{c.recovery.reason}</p> : null}
                    {c.zoho?.reason ? <p>Zoho: {c.zoho.reason}</p> : null}
                    {c.local?.lastError ? <p className="tabby-page__issue">Last error: {c.local.lastError}</p> : null}
                    {c.invoiceNumber ? <p>Invoice {c.invoiceNumber}</p> : null}
                    {!c.invoiceNumber && c.allocations.length ? (
                      <p>
                        Applied to {c.allocations.length} invoice(s):{' '}
                        {c.allocations.map((a) => `${a.invoiceNumber} ${formatAed(a.amount)}`).join(' · ')}
                      </p>
                    ) : null}
                    {c.creditNoteNumber ? <p>Credit note {c.creditNoteNumber}</p> : null}
                    {c.sourceRows.length ? <p>Statement rows {c.sourceRows.join(', ')}</p> : null}
                    {c.payload ? <pre className="tabby-page__pre">{JSON.stringify(c.payload, null, 2)}</pre> : null}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActivityLog({ batchId, refreshKey }: { batchId: string; refreshKey: string }) {
  const [events, setEvents] = useState<TabbyEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    getTabbyActivity(batchId)
      .then((res) => {
        if (alive) setEvents(res.events)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load activity.')
      })
    return () => {
      alive = false
    }
  }, [batchId, refreshKey])
  if (error) return <div className="tabby-page__banner tabby-page__banner--error">{error}</div>
  if (!events.length) return <p className="tabby-page__note">No activity yet.</p>
  return (
    <div className="tabby-page__scroll">
      <table className="tabby-page__table">
        <thead>
          <tr>
            <th>When</th>
            <th>Event</th>
            <th>Status</th>
            <th>Detail</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{formatDateTime(e.at)}</td>
              <td>{humanize(e.eventType)}</td>
              <td>{e.fromStatus || e.toStatus ? `${e.fromStatus || '—'} → ${e.toStatus || '—'}` : '—'}</td>
              <td className="tabby-page__accounts">{e.detail || '—'}</td>
              <td>{e.actor || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Tab = 'rows' | 'components' | 'ledger' | 'activity'

export function TabbyPreviewPanel({
  preview,
  busy,
  onChooseBank,
}: {
  preview: TabbyPreview
  busy: boolean
  onChooseBank: (transactionId: string) => void
}) {
  const [tab, setTab] = useState<Tab>('rows')
  const s = preview.sections
  const ledgerRoles = useMemo(() => {
    const set = new Set<string>()
    for (const snap of Object.values(s.ledger)) for (const role of Object.keys(snap)) set.add(role)
    return [...set]
  }, [s.ledger])

  return (
    <div className="tabby-page__stack">
      <section className="tabby-page__card">
        <header className="tabby-page__card-head">
          <div>
            <h2>{preview.statementNumber}</h2>
            <p className="tabby-page__note">
              Statement {s.settlement.statementDate || '—'} · transfer {s.settlement.transferDate || '—'} ·{' '}
              {s.settlement.currency} · {s.settlement.fileName || '—'} · posting date {preview.date}
            </p>
            <p className="tabby-page__sub tabby-page__mono">SHA-256 {s.settlement.fileHash}</p>
          </div>
          <Pill tone={batchStatusTone(preview.status)}>{humanize(preview.status)}</Pill>
        </header>
        <div className="tabby-page__counts">
          <span>{preview.counts.components} Zoho records</span>
          <span>{preview.counts.verified} verified</span>
          <span>{preview.counts.toPost} to post</span>
          {preview.counts.uncertain ? <span>{preview.counts.uncertain} uncertain</span> : null}
          {preview.counts.review ? <span>{preview.counts.review} need review</span> : null}
          <span>
            {s.matching.matched}/{s.matching.total} rows matched
          </span>
        </div>
      </section>

      <IssueList title="Blocking posting" issues={preview.blockers} tone="error" />
      <IssueList title="Warnings" issues={preview.warnings} tone="warning" />

      <div className="tabby-page__grid">
        <Figures
          title="Sales"
          rows={[
            ['Rows', String(s.sales.count)],
            ['Gross', s.sales.gross, true],
            ['Transferred (to Undeposited)', s.sales.net],
            ['Charges (to Processing)', s.sales.charges],
          ]}
        />
        <Figures
          title="Commission"
          rows={[
            ['Refundable', s.commission.refundable],
            ['Non-refundable', s.commission.nonRefundable],
            ['Expense', s.commission.expense],
            ['Refund reversal', s.commission.refundReversal],
            ['Net expense', s.commission.net, true],
          ]}
        />
        <Figures
          title="Fees"
          rows={[
            ['Fixed transaction fees', s.fees.transactionFixed],
            ['Rounding', s.fees.rounding],
            ['Total Fee (report)', s.fees.transactionTotalFee],
            ['Payout fee', s.fees.payoutFee],
            ['Refund reversal', s.fees.refundReversal],
            ['Fees expense', s.fees.feesExpense, true],
          ]}
        />
        <Figures
          title="VAT"
          rows={[
            ['Transaction VAT', s.vat.transaction],
            ['Payout VAT', s.vat.payout],
            ['Refund reversal', s.vat.refundReversal],
            ['Input VAT', s.vat.inputVat, true],
          ]}
        />
        <Figures
          title="Processing clearing"
          rows={[
            ['Account', s.clearing.account],
            ['Total deduction', s.clearing.totalDeduction],
            ['After sales', s.clearing.afterSales],
            ['After clearing', s.clearing.final, true],
          ]}
        />
        <Figures
          title="Undeposited funds"
          rows={[
            ['Account', s.undeposited.account],
            ['Sale transfers', s.undeposited.saleNet],
            ['Refunds', s.undeposited.refunds],
            ['Pre-payout', s.undeposited.prePayout],
            ['Payout fee + VAT', s.undeposited.payoutFeeAndVat],
            ['Bank payout', s.undeposited.bankPayout],
            ['Final balance', s.undeposited.final, true],
          ]}
        />
        {s.refunds.count ? (
          <Figures
            title="Refunds"
            rows={[
              ['Rows', String(s.refunds.count)],
              ['Refunded', s.refunds.gross],
              ['Commission returned', s.refunds.commissionReturned],
              ['Fees returned', s.refunds.feesReturned],
              ['VAT returned', s.refunds.vatReturned],
              ['Net transfer', s.refunds.transfer, true],
            ]}
          />
        ) : null}
        <Figures
          title="Matching"
          rows={[
            ...Object.entries(s.matching.byStatus).map(([k, v]): [string, string] => [humanize(k), String(v)]),
            ...Object.entries(s.matching.customers).map(([k, v]): [string, string] => [`Customer ${k}`, `${v} row(s)`]),
          ]}
        />
      </div>

      <BankCard bank={preview.bank} busy={busy} onChoose={onChooseBank} />

      <section className="tabby-page__card">
        <div className="tabby-page__tabs" role="tablist">
          {(
            [
              ['rows', `Statement rows (${preview.rows.filter((r) => r.kind !== 'TOTAL' && r.kind !== 'NOTE').length})`],
              ['components', `Zoho records (${preview.components.length})`],
              ['ledger', 'Ledger check'],
              ['activity', 'Activity log'],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`tabby-page__tab${tab === key ? ' tabby-page__tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'rows' ? <RowsTable rows={preview.rows} /> : null}
        {tab === 'components' ? <ComponentsTable components={preview.components} /> : null}
        {tab === 'ledger' ? (
          <div className="tabby-page__scroll">
            <table className="tabby-page__table">
              <thead>
                <tr>
                  <th>Account</th>
                  {Object.keys(s.ledger).map((k) => (
                    <th key={k} className="num">
                      {humanize(k.replace(/([A-Z])/g, '_$1'))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledgerRoles.map((role) => (
                  <tr key={role}>
                    <td>{humanize(role)}</td>
                    {Object.entries(s.ledger).map(([k, snap]) => (
                      <td key={k} className="num">
                        {formatAed(snap[role] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {tab === 'activity' ? <ActivityLog batchId={preview.batchId} refreshKey={`${preview.status}:${preview.counts.verified}`} /> : null}
      </section>
    </div>
  )
}

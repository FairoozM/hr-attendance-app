import { Fragment, useState } from 'react'
import { getPosActivity, type PosEvent, type PosIssue, type PosPreview, type PosTransaction } from '../../../api/posSettlements'
import { Pill } from '../tabby/TabbyPreviewPanel'
import {
  BASIS_LABEL,
  COMPONENT_LABEL,
  bankTone,
  channelLabel,
  formatAed,
  formatDateTime,
  humanize,
  matchTone,
  recoveryTone,
  settlementStatusTone,
} from './posFormat'

function IssueList({ title, issues, tone }: { title: string; issues: PosIssue[]; tone: 'error' | 'warning' }) {
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

function MatchCell({ t }: { t: PosTransaction }) {
  return (
    <>
      <Pill tone={matchTone(t.match.status)}>{humanize(t.match.status)}</Pill>
      {t.match.allocations.length ? (
        <div className="tabby-page__sub">{t.match.allocations.map((a) => `${a.invoiceNumber}${t.match.allocations.length > 1 ? ` ${formatAed(a.gross)}` : ''}`).join(' + ')}</div>
      ) : null}
      {!t.match.matched && t.match.reason ? <div className="tabby-page__sub">{t.match.reason}</div> : null}
      {t.match.possible.length ? <div className="tabby-page__sub">Possible: {t.match.possible.map((i) => i.invoiceNumber).join(', ')}</div> : null}
    </>
  )
}

function Activity({ settlementId }: { settlementId: string }) {
  const [events, setEvents] = useState<PosEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function load() {
    try {
      setEvents((await getPosActivity(settlementId)).events)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the activity.')
    }
  }
  return (
    <section className="tabby-page__card">
      <header className="tabby-page__card-head">
        <h2>Audit trail</h2>
        <button type="button" className="ainv-btn ainv-btn--ghost" onClick={() => void load()}>
          {events ? 'Reload' : 'Show'}
        </button>
      </header>
      {error ? <p className="tabby-page__issue">{error}</p> : null}
      {events ? (
        events.length ? (
          <div className="tabby-page__scroll">
            <table className="tabby-page__table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Detail</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.at)}</td>
                    <td>
                      {humanize(e.eventType)}
                      {e.toStatus ? <div className="tabby-page__sub">{[e.fromStatus, e.toStatus].filter(Boolean).map(humanize).join(' → ')}</div> : null}
                    </td>
                    <td>{e.detail || '—'}</td>
                    <td className="tabby-page__sub">{e.actor || 'system'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="tabby-page__note">No activity yet.</p>
        )
      ) : null}
    </section>
  )
}

export function PosPreviewPanel({
  preview,
  busy,
  onMap,
  onDismissConflict,
  onLinkBank,
  onUnlinkBank,
}: {
  preview: PosPreview
  busy: boolean
  onMap: (t: PosTransaction) => void
  onDismissConflict: (transactionId: string) => void
  onLinkBank: (transactionId: string) => void
  onUnlinkBank: () => void
}) {
  const [tab, setTab] = useState<'transactions' | 'plan' | 'invoices'>('transactions')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [bankId, setBankId] = useState('')
  const t = preview.totals
  const bank = preview.bank
  const conflicts = preview.inactiveTransactions.filter((x) => x.status === 'CONFLICT')
  const duplicates = preview.inactiveTransactions.filter((x) => x.status === 'DUPLICATE')
  const channels = Object.entries(preview.byChannel)

  return (
    <>
      <IssueList title="Blockers" issues={preview.blockers} tone="error" />
      <IssueList title="Warnings" issues={preview.warnings} tone="warning" />

      <div className="tabby-page__grid">
        <Figures
          title={`Payout ${preview.settlementCode}`}
          rows={[
            ['Status', humanize(preview.status)],
            ['Payout date', preview.payoutDate || '—'],
            ['Grouped by', BASIS_LABEL[preview.basis] || humanize(preview.basis)],
            ['Transactions', `${t.count} (${preview.firstDate || '—'} … ${preview.lastDate || '—'})`],
            ['Merchants / terminals', `${preview.merchants.join(', ') || '—'} / ${preview.terminals.join(', ') || '—'}`],
            ['Batches', preview.batches.join(', ') || '—'],
          ]}
        />
        <Figures
          title="Mashreq amounts"
          rows={[
            ['Gross card sales', t.gross],
            ['Commission', t.commission],
            ...(t.otherFees ? ([['Other fees', t.otherFees]] as Array<[string, number]>) : []),
            ['VAT on charges', t.vat],
            ['Total deducted', t.charges],
            ['Net paid to RAK', t.net, true],
          ]}
        />
        <Figures
          title="Bank and fees"
          rows={[
            ['Bank', humanize(bank.status)],
            ['Transfer', bank.matched ? `${bank.matched.referenceNumber || bank.matched.transactionId} · ${bank.matched.date}` : bank.recordedByWorkflow ? 'Recorded by this workflow' : '—'],
            ['Fee recognition', humanize(preview.feeRecognition.status)],
            ['Zoho reads this preview', preview.zohoCalls == null ? '—' : String(preview.zohoCalls)],
          ]}
        />
      </div>

      <section className="tabby-page__card">
        <h2>By channel</h2>
        <p className="tabby-page__sub">Analysis only: the payout is cleared as one Mashreq settlement, never split by channel.</p>
        <div className="tabby-page__scroll">
          <table className="tabby-page__table">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="num">Transactions</th>
                <th className="num">Gross</th>
                <th className="num">Commission</th>
                <th className="num">VAT</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(([ch, v]) => (
                <tr key={ch}>
                  <td>{channelLabel(ch)}</td>
                  <td className="num">{v.count}</td>
                  <td className="num">{formatAed(v.gross)}</td>
                  <td className="num">{formatAed(v.commission)}</td>
                  <td className="num">{formatAed(v.vat)}</td>
                  <td className="num">{formatAed(v.net)}</td>
                </tr>
              ))}
              <tr className="tabby-page__figure--strong">
                <td>Total</td>
                <td className="num">{t.count}</td>
                <td className="num">{formatAed(t.gross)}</td>
                <td className="num">{formatAed(t.commission + t.otherFees)}</td>
                <td className="num">{formatAed(t.vat)}</td>
                <td className="num">{formatAed(t.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="tabby-page__card">
        <header className="tabby-page__card-head">
          <h2>Bank: POS Undeposited → RAK</h2>
          <Pill tone={bankTone(bank.status)}>{humanize(bank.status)}</Pill>
        </header>
        <p className="tabby-page__note">{bank.reason}</p>
        {bank.window ? <p className="tabby-page__sub">Searched {bank.window.start} … {bank.window.end} for exactly {formatAed(bank.amount)}.</p> : null}
        {bank.candidates && bank.candidates.length > 1 ? (
          <ul>
            {bank.candidates.map((c) => (
              <li key={c.transactionId}>
                {c.date} · {c.referenceNumber || c.transactionId} · {formatAed(c.amount)}{' '}
                <button type="button" className="tabby-page__link" disabled={busy} onClick={() => onLinkBank(c.transactionId)}>
                  Link this transfer
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {bank.skipped?.length ? <p className="tabby-page__sub">Already linked to other payouts: {bank.skipped.map((s) => `${s.referenceNumber || s.transactionId} (${s.claimedBy})`).join(', ')}</p> : null}
        <div className="tabby-page__upload">
          <input aria-label="Zoho bank transaction ID" placeholder="Zoho bank transaction ID of an existing transfer" value={bankId} onChange={(e) => setBankId(e.target.value)} disabled={busy} />
          <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy || !bankId.trim()} onClick={() => onLinkBank(bankId.trim())}>
            Link transfer
          </button>
          {bank.linkedTransactionId ? (
            <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy} onClick={onUnlinkBank}>
              Unlink {bank.linkedTransactionId}
            </button>
          ) : null}
        </div>
        <p className="tabby-page__sub">Fees: {preview.feeRecognition.reason}</p>
      </section>

      <div className="tabby-page__tabs" role="tablist">
        {(
          [
            ['transactions', `Transactions (${preview.counts.matched}/${preview.counts.transactions} matched)`],
            ['plan', `Zoho plan (${preview.counts.toPost} to post, ${preview.counts.verified} verified)`],
            ['invoices', `Invoices (${preview.invoices.length})`],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tabby-page__tab${tab === key ? ' tabby-page__tab--active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'transactions' ? (
        <section className="tabby-page__card">
          <div className="tabby-page__scroll">
            <table className="tabby-page__table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>RRN</th>
                  <th>Date</th>
                  <th>TID</th>
                  <th>Type</th>
                  <th className="num">Gross</th>
                  <th className="num">Commission</th>
                  <th className="num">VAT</th>
                  <th className="num">Net</th>
                  <th>Channel</th>
                  <th>Zoho invoice</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {preview.transactions.map((x) => (
                  <tr key={x.id}>
                    <td>{x.sourceRow}</td>
                    <td className="tabby-page__mono">{x.rrn || '—'}</td>
                    <td>
                      {x.transactionDate || '—'}
                      {x.transactionTime ? <div className="tabby-page__sub">{x.transactionTime}</div> : null}
                    </td>
                    <td className="tabby-page__mono">{x.terminalId || '—'}</td>
                    <td>{humanize(x.transactionType)}</td>
                    <td className="num">{formatAed(x.gross)}</td>
                    <td className="num">{formatAed(x.commission)}</td>
                    <td className="num">{formatAed(x.vat)}</td>
                    <td className="num">
                      {formatAed(x.net)}
                      {x.netDerived ? <div className="tabby-page__sub">derived</div> : null}
                    </td>
                    <td>
                      {channelLabel(x.channel)}
                      {x.channelSource ? <div className="tabby-page__sub">{humanize(x.channelSource)}</div> : null}
                    </td>
                    <td>
                      <MatchCell t={x} />
                      {x.problems.map((p) => (
                        <div key={p.code} className="tabby-page__issue">
                          {p.message}
                        </div>
                      ))}
                    </td>
                    <td>
                      <button type="button" className="ainv-btn ainv-btn--ghost" disabled={busy} onClick={() => onMap(x)}>
                        {x.manualMapping ? 'Edit mapping' : x.match.matched ? 'Override' : 'Map manually'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {conflicts.length ? (
            <>
              <h3>Conflicting rows from later files</h3>
              <ul>
                {conflicts.map((c) => (
                  <li key={c.id}>
                    RRN <span className="tabby-page__mono">{c.rrn}</span> (row {c.sourceRow}) differs in {(c.conflictFields || []).join(', ')}.{' '}
                    <button type="button" className="tabby-page__link" disabled={busy} onClick={() => onDismissConflict(c.id)}>
                      Keep the earlier values
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {duplicates.length ? <p className="tabby-page__sub">{duplicates.length} row(s) from re-imported files were recognised as duplicates and ignored.</p> : null}
        </section>
      ) : null}

      {tab === 'plan' ? (
        <section className="tabby-page__card">
          <p className="tabby-page__sub">
            Every record carries a reference starting with {preview.settlementCode}; Zoho is searched by it before each write, so nothing is posted twice. Invoices, revenue and output VAT are never created.
          </p>
          <div className="tabby-page__scroll">
            <table className="tabby-page__table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th className="num">Amount</th>
                  <th>Zoho</th>
                  <th>Next</th>
                </tr>
              </thead>
              <tbody>
                {preview.components.map((c) => (
                  <Fragment key={c.key}>
                    <tr className="tabby-page__clickable" onClick={() => setOpenKey(openKey === c.key ? null : c.key)}>
                      <td>{COMPONENT_LABEL[c.component] || humanize(c.component)}</td>
                      <td className="tabby-page__mono">{c.reference}</td>
                      <td>{c.date}</td>
                      <td className="num">{formatAed(c.amount)}</td>
                      <td>
                        {humanize(c.zoho?.state)}
                        {c.local ? <div className="tabby-page__sub">{humanize(c.local.status)}</div> : null}
                      </td>
                      <td>
                        <Pill tone={recoveryTone(c.recovery.action)}>{humanize(c.recovery.action)}</Pill>
                      </td>
                    </tr>
                    {openKey === c.key ? (
                      <tr className="tabby-page__detail">
                        <td colSpan={6}>
                          {c.depositAccount ? <p>Deposit to {c.depositAccount}</p> : null}
                          {c.fromAccount ? <p>From {c.fromAccount} to {c.toAccount}</p> : null}
                          {c.allocations.length ? <p>Applied: {c.allocations.map((a) => `${a.invoiceNumber} ${formatAed(a.amount)}`).join(' · ')}</p> : null}
                          {c.lines.length ? (
                            <p>
                              {c.lines.map((l) => `${l.side === 'debit' ? 'Dr' : 'Cr'} ${l.account} ${formatAed(l.amount)}`).join(' · ')}
                            </p>
                          ) : null}
                          {c.zoho?.reason ? <p className="tabby-page__sub">{c.zoho.reason}</p> : null}
                          {c.recovery.reason ? <p className="tabby-page__sub">{c.recovery.reason}</p> : null}
                          {c.local?.lastError ? <p className="tabby-page__issue">{c.local.lastError}</p> : null}
                          <pre className="tabby-page__pre">{JSON.stringify(c.payload, null, 2)}</pre>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Ledger effect of this payout</h3>
          <table className="tabby-page__table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Balance after posting</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(preview.ledger).map(([role, v]) => (
                <tr key={role}>
                  <td>{v.account}</td>
                  <td className="num">{formatAed(v.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === 'invoices' ? (
        <section className="tabby-page__card">
          <div className="tabby-page__scroll">
            <table className="tabby-page__table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Mode</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th className="num">POS gross</th>
                  <th className="num">Net</th>
                  <th className="num">Fee</th>
                  <th className="num">Reclass</th>
                </tr>
              </thead>
              <tbody>
                {preview.invoices.map((i) => (
                  <tr key={i.invoiceId}>
                    <td>
                      {i.invoiceNumber}
                      {i.problem ? <div className="tabby-page__issue">{i.problem.message}</div> : null}
                    </td>
                    <td>
                      <Pill tone={i.mode === 'BLOCKED' ? 'bad' : i.mode === 'EXISTING_RECEIPTS' ? 'info' : 'ok'}>{humanize(i.mode)}</Pill>
                      {i.partial ? <div className="tabby-page__sub">stays partly open</div> : null}
                    </td>
                    <td className="num">{formatAed(i.total)}</td>
                    <td className="num">{formatAed(i.balance)}</td>
                    <td className="num">{formatAed(i.gross)}</td>
                    <td className="num">{formatAed(i.net)}</td>
                    <td className="num">{formatAed(i.fee)}</td>
                    <td className="num">{i.reclass ? formatAed(i.reclass) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="tabby-page__sub">
        Status <Pill tone={settlementStatusTone(preview.status)}>{humanize(preview.status)}</Pill> · RRN index window {preview.rrnIndex.window.dateFrom} … {preview.rrnIndex.window.dateTo}
        {preview.rrnIndex.stats ? ` · ${preview.rrnIndex.stats.detailRead || 0} invoice detail(s) read, ${preview.rrnIndex.stats.skippedUnchanged || 0} unchanged` : ''}
      </p>

      <Activity settlementId={preview.settlementId} />
    </>
  )
}

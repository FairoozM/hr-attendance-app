import { useCallback, useEffect, useState } from 'react'
import {
  fetchUnclearedClearingPlan,
  postUnclearedClearing,
  type PaymentPostingResult,
  type UnclearedClearingLine,
  type UnclearedClearingPlan,
} from '../../../../api/amazonPaymentClearing'
import { money, PostingResultTable, SummaryCard } from '../clearingShared'
import { PostingStatusPanel } from '../components/PostingStatusPanel'
import type { ClearingContext } from './clearingContext'

function outcomeMessage(result: PaymentPostingResult): { ok: boolean; message: string } {
  const created = result.summary?.journalsCreated || 0
  const verification = result.summary?.verificationRequired || 0
  const errors = result.summary?.errors || 0
  if (result.success && verification === 0 && errors === 0) {
    return {
      ok: true,
      message: created
        ? `Commission and shipping clearing posted to Zoho (${created} journal${created === 1 ? '' : 's'}).`
        : 'Clearing journals were already in Zoho; nothing was resent.',
    }
  }
  if (verification > 0) {
    return {
      ok: false,
      message: 'Zoho did not confirm a journal. It is marked "verification required" and will not be resent automatically — re-check it below.',
    }
  }
  const firstError = result.errors?.[0]?.error || result.journals?.find((row) => row.error)?.error || 'Posting failed.'
  return { ok: false, message: firstError }
}

function lineState(line: UnclearedClearingLine) {
  if (line.posting?.status === 'posted' && line.posting.zohoJournalId) {
    return `Posted ${line.posting.zohoJournalNumber ? `#${line.posting.zohoJournalNumber}` : ''}`.trim()
  }
  if (line.status === 'needs_mapping') return 'Account missing'
  return line.posting?.status ? line.posting.status.replace(/_/g, ' ') : 'Not posted'
}

export function StepUnclearedClearing({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  const [plan, setPlan] = useState<UnclearedClearingPlan | null>(null)
  const [result, setResult] = useState<PaymentPostingResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [localError, setLocalError] = useState('')

  const batchId = preview?.batch?.batchId
  const currency = plan?.currency || ctx.currency

  const loadPlan = useCallback(async () => {
    if (!batchId) return
    setLoading(true)
    setLocalError('')
    try {
      setPlan(await fetchUnclearedClearingPlan(ctx.marketplace, batchId))
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to load the clearing plan')
    } finally {
      setLoading(false)
    }
  }, [batchId, ctx.marketplace])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])

  if (!preview) return null

  const lines = plan?.lines || []
  const posted = Boolean(plan?.unclearedClearingComplete && lines.length > 0)
  const allReady = lines.length > 0 && lines.every((line) => line.status === 'ready')
  const canPost = Boolean(plan?.readiness?.ok && allReady && !posted)
  const vatPercent = plan ? Math.round(plan.vatRate * 10000) / 100 : null

  const run = async (dryRun: boolean) => {
    if (!batchId) return
    if (!dryRun) {
      const summary = lines.map((line) => `${line.feeType}: ${money(line.grossAmount, currency)}`).join('\n')
      if (!window.confirm(`Post ${lines.length} clearing journal(s) to Zoho?\n\n${summary}`)) return
    }
    setPosting(true)
    setLocalError('')
    try {
      const json = await postUnclearedClearing(ctx.marketplace, batchId, dryRun)
      setResult(json)
      if (dryRun) {
        ctx.setNotice('Dry run complete. Zoho was not changed — review the journals below.')
      } else {
        const outcome = outcomeMessage(json)
        if (outcome.ok) ctx.setNotice(outcome.message)
        else setLocalError(outcome.message)
        await ctx.refreshPostClearingStepStatus(batchId)
      }
      await loadPlan()
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Posting failed')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="apc-step-stack">
      <div className="apc-alert">
        Record payments in step 9 park Amazon&apos;s commission and shipping/FBA fees on the <strong>uncleared</strong>{' '}
        accounts, and the return journals in step 12 adjust them. This step moves what this settlement left there into
        expense with one journal per account, splitting out the {vatPercent != null ? `${vatPercent}% ` : ''}input VAT
        included in Amazon&apos;s fees.
      </div>

      {localError ? <div className="apc-alert apc-alert--error" role="alert">{localError}</div> : null}
      {lines.filter((line) => line.status === 'needs_mapping').map((line) => (
        <div key={line.key} className="apc-alert apc-alert--error" role="alert">{line.blockingReason}</div>
      ))}
      {plan && !plan.readiness.ok && !posted ? (
        <p className="apc-muted">
          {plan.readiness.message}{' '}
          <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => ctx.goToStep(12)}>
            Go to step 12
          </button>
        </p>
      ) : null}

      <section className="apc-summary-grid">
        <SummaryCard label="Uncleared Total" value={money(plan?.summary?.grossTotal ?? 0, currency)} />
        <SummaryCard label="To Expense (net)" value={money(plan?.summary?.netTotal ?? 0, currency)} />
        <SummaryCard label="Input VAT" value={money(plan?.summary?.vatTotal ?? 0, currency)} />
        <SummaryCard label="Status" value={posted ? 'Posted' : lines.length ? 'Not posted' : 'Nothing to clear'} />
      </section>

      <div className="apc-button-row">
        <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => void loadPlan()} disabled={loading || posting}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button className="ainv-btn" type="button" onClick={() => void run(true)} disabled={posting || !allReady}>
          {posting ? 'Working...' : 'Dry run journals'}
        </button>
        <button className="ainv-btn ainv-btn--danger" type="button" onClick={() => void run(false)} disabled={posting || !canPost}>
          Post clearing journals to Zoho
        </button>
      </div>

      {ctx.postingStatus?.settlementComplete ? (
        <div className="apc-alert apc-approved-panel" role="status">
          <strong>Settlement complete.</strong> Sales payments, fee journals, credit note refunds, returns not received,
          return fee journals and commission/shipping clearing are all posted and recorded.
        </div>
      ) : null}

      {batchId != null && ctx.salesComplete && lines.length > 0 ? (
        <PostingStatusPanel
          marketplace={ctx.marketplace}
          batchId={batchId}
          status={ctx.postingStatus}
          currency={currency}
          loading={ctx.postingStatusLoading}
          groups={['uncleared_clearing']}
          onChanged={async (message) => {
            await ctx.refreshPostingStatus(batchId, message)
            await loadPlan()
          }}
          onResume={(step) => (step === 13 && canPost ? void run(false) : ctx.goToStep(step))}
        />
      ) : null}

      {lines.length === 0 ? (
        <p className="apc-muted">{loading ? 'Loading...' : 'Nothing is left on the uncleared commission or shipping accounts for this settlement.'}</p>
      ) : (
        lines.map((line) => (
          <section key={line.key} className="apc-step-stack">
            <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>
              {line.feeType} · {money(line.grossAmount, currency)} · {lineState(line)}
            </h3>
            <div className="apc-table-wrap">
              <table className="apc-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="apc-money">Debit</th>
                    <th className="apc-money">Credit</th>
                    <th>Line description (sent to Zoho)</th>
                  </tr>
                </thead>
                <tbody>
                  {line.lineItems.map((item, idx) => (
                    <tr key={`${line.key}-${idx}`}>
                      <td>{item.accountName || item.accountCode}{item.accountId ? '' : ' (no Zoho id)'}</td>
                      <td className="apc-money">{item.debitOrCredit === 'debit' ? money(item.amount, currency) : ''}</td>
                      <td className="apc-money">{item.debitOrCredit === 'credit' ? money(item.amount, currency) : ''}</td>
                      <td>{item.description || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="apc-muted">
              Reference (sent to Zoho): <code className="apc-ref">{line.referenceNumber}</code>
            </p>
            <details>
              <summary className="apc-muted">How {money(line.grossAmount, currency)} was worked out ({line.movements.length} posted entries)</summary>
              <div className="apc-table-wrap">
                <table className="apc-table">
                  <thead>
                    <tr>
                      <th>Posted entry</th>
                      <th>Reference</th>
                      <th>Zoho</th>
                      <th className="apc-money">On uncleared account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {line.movements.map((row) => (
                      <tr key={`${row.paymentType}-${row.zohoId}`}>
                        <td>{row.paymentType}</td>
                        <td>{row.referenceNumber || '-'}</td>
                        <td>{row.zohoNumber || row.zohoId || '-'}</td>
                        <td className="apc-money">{money(row.amount, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        ))
      )}

      {result ? <PostingResultTable result={result} currency={currency} /> : null}
    </div>
  )
}

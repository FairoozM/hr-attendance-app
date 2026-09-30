import { useCallback, useEffect, useState } from 'react'
import {
  fetchNotReceivedPlan,
  postNotReceivedReturns,
  type JournalAccountRef,
  type NotReceivedPlan,
  type PaymentPostingResult,
} from '../../../../api/amazonPaymentClearing'
import { money, PostingResultTable, SummaryCard } from '../clearingShared'
import { PostingStatusPanel } from '../components/PostingStatusPanel'
import type { ClearingContext } from './clearingContext'

function accountLabel(account: JournalAccountRef | undefined) {
  if (!account) return '-'
  const name = account.accountName || account.accountCode || '-'
  return account.accountId ? `${name} (id ${account.accountId})` : name
}

function outcomeMessage(result: PaymentPostingResult): { ok: boolean; message: string } {
  const created = result.summary?.journalsCreated || 0
  const skipped = result.summary?.journalsSkipped || 0
  const verification = result.summary?.verificationRequired || 0
  const errors = result.summary?.errors || 0
  if (result.success && verification === 0 && errors === 0) {
    return {
      ok: true,
      message: created
        ? 'Returns-not-received journal posted to Zoho.'
        : skipped
          ? 'Returns-not-received journal was already in Zoho; nothing was resent.'
          : 'Returns-not-received journal is recorded.',
    }
  }
  if (verification > 0) {
    return {
      ok: false,
      message: 'Zoho did not confirm the journal. It is marked "verification required" and will not be resent automatically — re-check it below.',
    }
  }
  const firstError = result.errors?.[0]?.error || result.journals?.find((row) => row.error)?.error || 'Posting failed.'
  return { ok: false, message: firstError }
}

export function StepReturnsNotReceived({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  const [plan, setPlan] = useState<NotReceivedPlan | null>(null)
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
      setPlan(await fetchNotReceivedPlan(ctx.marketplace, batchId))
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to load returns not received')
    } finally {
      setLoading(false)
    }
  }, [batchId, ctx.marketplace])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])

  if (!preview) return null

  const orders = plan?.orders || []
  const line = plan?.line || null
  const posted = Boolean(plan?.notReceivedPostComplete && orders.length > 0)
  const canPost = Boolean(ctx.salesComplete && line && line.status === 'ready' && !posted)

  const run = async (dryRun: boolean) => {
    if (!batchId) return
    if (!dryRun) {
      const ok = window.confirm(
        `Post one journal to Zoho: Dr ${line?.debit.accountName || 'Amazon Return Exp'} / Cr ${
          line?.credit.accountName || 'Amazon Undeposited Funds'
        } for ${money(line?.amount ?? 0, currency)} (${orders.length} order(s))?`
      )
      if (!ok) return
    }
    setPosting(true)
    setLocalError('')
    try {
      const json = await postNotReceivedReturns(ctx.marketplace, batchId, dryRun)
      setResult(json)
      if (dryRun) {
        ctx.setNotice('Dry run complete. Zoho was not changed — review the journal below.')
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
        Returns Amazon refunded to the customer but the warehouse never received back. They have no credit note, so the
        refund is expensed with <strong>one combined journal</strong> for this settlement:{' '}
        <strong>Dr {line?.debit.accountName || 'Amazon Return Exp'}</strong> /{' '}
        <strong>Cr {line?.credit.accountName || 'Amazon Undeposited Funds'}</strong>. Mark orders in step 10 with{' '}
        <em>Not received</em>.
      </div>

      {localError ? <div className="apc-alert apc-alert--error" role="alert">{localError}</div> : null}
      {line?.status === 'needs_mapping' ? (
        <div className="apc-alert apc-alert--error" role="alert">{line.blockingReason}</div>
      ) : null}
      {!ctx.salesComplete && orders.length > 0 ? (
        <p className="apc-muted">Every sales payment and fee journal in step 9 must be posted and verified before this journal can post.</p>
      ) : null}

      <section className="apc-summary-grid">
        <SummaryCard label="Orders Not Received" value={plan?.summary?.orderCount ?? '-'} />
        <SummaryCard label="Journal Amount" value={money(plan?.summary?.total ?? 0, currency)} />
        <SummaryCard label="Zoho Journal" value={plan?.posting?.zohoJournalNumber || plan?.posting?.zohoJournalId || '-'} />
        <SummaryCard label="Status" value={posted ? 'Posted' : plan?.posting?.status || (orders.length ? 'Not posted' : 'Nothing to post')} />
      </section>

      <div className="apc-button-row">
        <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => void loadPlan()} disabled={loading || posting}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => ctx.goToStep(10)} disabled={posting}>
          Back to step 10
        </button>
        <button
          className="ainv-btn"
          type="button"
          onClick={() => void run(true)}
          disabled={posting || !line || line.status !== 'ready'}
        >
          {posting ? 'Working...' : 'Dry run journal'}
        </button>
        <button className="ainv-btn ainv-btn--danger" type="button" onClick={() => void run(false)} disabled={posting || !canPost}>
          Post journal to Zoho
        </button>
        {orders.length === 0 || posted ? (
          <button className="ainv-btn" type="button" onClick={() => ctx.goToStep(12)}>
            Continue to return fee clearing (step 12)
          </button>
        ) : null}
      </div>

      {batchId != null && ctx.salesComplete && orders.length > 0 ? (
        <PostingStatusPanel
          marketplace={ctx.marketplace}
          batchId={batchId}
          status={ctx.postingStatus}
          currency={currency}
          loading={ctx.postingStatusLoading}
          groups={['return_not_received']}
          onChanged={async (message) => {
            await ctx.refreshPostingStatus(batchId, message)
            await loadPlan()
          }}
          onResume={ctx.goToStep}
        />
      ) : null}

      <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Orders not received</h3>
      <div className="apc-table-wrap">
        <table className="apc-table">
          <thead>
            <tr>
              <th>Amazon order</th>
              <th>Zoho invoice</th>
              <th className="apc-money">Amazon refund</th>
              <th>Reason</th>
              <th>Marked</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="apc-muted">
                  {loading ? 'Loading...' : 'No returns are marked not received. Nothing to post — continue to step 12.'}
                </td>
              </tr>
            ) : (
              orders.map((row) => (
                <tr key={row.orderId}>
                  <td>{row.orderId}</td>
                  <td>{row.zohoInvoiceNumber || '-'}</td>
                  <td className="apc-money">{money(row.amount, currency)}</td>
                  <td>{row.reason || '-'}</td>
                  <td>{row.markedAt ? new Date(row.markedAt).toLocaleString() : '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {line ? (
        <>
          <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Journal to post</h3>
          <div className="apc-table-wrap">
            <table className="apc-table">
              <thead>
                <tr>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th className="apc-money">Amount</th>
                  <th>Reference (sent to Zoho)</th>
                  <th>Notes (sent to Zoho)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{accountLabel(line.debit)}</td>
                  <td>{accountLabel(line.credit)}</td>
                  <td className="apc-money">{money(line.amount, currency)}</td>
                  <td><code className="apc-ref">{line.referenceNumber}</code></td>
                  <td><pre className="apc-description">{line.notes}</pre></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {result ? <PostingResultTable result={result} currency={currency} /> : null}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { fetchKsaReturnFeePlan, type ReturnFeePlan } from '../../../../api/amazonPaymentClearing'
import { money, PostingResultTable, SummaryCard } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

export function Step9ReturnFeeClearing({ ctx }: { ctx: ClearingContext }) {
  const { preview, postingResult } = ctx
  const [plan, setPlan] = useState<ReturnFeePlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  const batchId = preview?.batch?.batchId
  const creditNotesDone = ctx.creditNoteApplyComplete || plan?.creditNoteApplyComplete === true
  const varianceBlockers = plan?.summary?.varianceBlockerCount ?? ctx.returnFeeBlockerCount
  const canPostJournals = Boolean(ctx.isPosted && creditNotesDone && varianceBlockers === 0)

  const loadPlan = useCallback(async () => {
    if (!batchId) return
    setLoading(true)
    setLocalError('')
    try {
      const json = await fetchKsaReturnFeePlan(batchId)
      setPlan(json)
      await ctx.refreshPostClearingStepStatus(batchId)
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to load return fee plan')
    } finally {
      setLoading(false)
    }
  }, [batchId, ctx.refreshPostClearingStepStatus])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])

  if (!preview) return null

  return (
    <div className="apc-step-stack">
      <div className="apc-alert">
        After credit notes are applied in step 10, review return fee asymmetry (commission reversed vs shipping/FBA
        retained) and post the clearing journals here.
      </div>

      {!ctx.isPosted ? (
        <p className="apc-muted">Complete step 9 (post sales payments) and step 10 (apply credit notes) before posting return fee journals.</p>
      ) : !creditNotesDone ? (
        <p className="apc-muted">Apply all return credit notes in step 10 before posting return fee journals.</p>
      ) : varianceBlockers > 0 ? (
        <p className="apc-muted">
          {varianceBlockers} return order(s) have fee residuals that need a variance account or manual review before
          journals can post. Set <code>AMAZON_KSA_ZOHO_RETURN_VARIANCE_ACCOUNT_ID</code> on the backend or review the
          planned journal table below.
        </p>
      ) : null}

      {localError ? <div className="apc-alert apc-alert--error" role="alert">{localError}</div> : null}
      {(plan?.warnings || []).map((warning) => (
        <div key={warning} className="apc-alert apc-alert--error" role="alert">{warning}</div>
      ))}

      <div className="apc-button-row">
        <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => void loadPlan()} disabled={loading || ctx.postingReturnFees}>
          {loading ? 'Loading...' : 'Refresh return fee plan'}
        </button>
        <button
          className="ainv-btn"
          type="button"
          onClick={() => ctx.onPostReturnFeeJournals(true)}
          disabled={!canPostJournals || ctx.postingReturnFees || (plan?.journalLines || []).length === 0}
        >
          {ctx.postingReturnFees ? 'Working...' : 'Dry run journals'}
        </button>
        <button
          className="ainv-btn ainv-btn--danger"
          type="button"
          onClick={() => ctx.onPostReturnFeeJournals(false)}
          disabled={!canPostJournals || ctx.postingReturnFees || ctx.returnFeePostComplete}
        >
          Post return fee journals
        </button>
      </div>

      <section className="apc-summary-grid">
        <SummaryCard label="Return Orders" value={plan?.summary?.orderCount ?? '-'} />
        <SummaryCard label="Commission Reversal" value={money(plan?.summary?.commissionReversalTotal ?? 0)} />
        <SummaryCard label="Shipping Retained" value={money(plan?.summary?.shippingRetainedTotal ?? 0)} />
        <SummaryCard label="Journal Lines" value={plan?.summary?.journalLineCount ?? '-'} />
        <SummaryCard label="Variance Blockers" value={plan?.summary?.varianceBlockerCount ?? 0} />
      </section>

      <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Per-order breakdown</h3>
      <div className="apc-table-wrap">
        <table className="apc-table">
          <thead>
            <tr>
              <th>Order</th>
              <th className="apc-money">Customer refund</th>
              <th className="apc-money">Commission reversal</th>
              <th className="apc-money">Shipping retained</th>
              <th className="apc-money">Net return</th>
            </tr>
          </thead>
          <tbody>
            {(plan?.breakdowns || []).length === 0 ? (
              <tr>
                <td colSpan={5} className="apc-muted">No return fee breakdown rows for this settlement.</td>
              </tr>
            ) : (
              (plan?.breakdowns || []).map((row) => (
                <tr key={row.orderId}>
                  <td>{row.orderId}</td>
                  <td className="apc-money">{money(row.customerRefundAmount)}</td>
                  <td className="apc-money">{money(row.commissionReversal)}</td>
                  <td className="apc-money">{money(row.shippingFbaRetained)}</td>
                  <td className="apc-money">{money(row.netReturnSettlement)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Planned journals</h3>
      <div className="apc-table-wrap">
        <table className="apc-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Fee type</th>
              <th className="apc-money">Amount</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(plan?.journalLines || []).length === 0 ? (
              <tr>
                <td colSpan={6} className="apc-muted">No return fee journals planned.</td>
              </tr>
            ) : (
              (plan?.journalLines || []).map((row) => (
                <tr key={row.key}>
                  <td>{row.orderId}</td>
                  <td>{row.feeType}</td>
                  <td className="apc-money">{money(row.amount)}</td>
                  <td>{row.debit?.accountName || row.debit?.accountCode || '-'}</td>
                  <td>{row.credit?.accountName || row.credit?.accountCode || '-'}</td>
                  <td>{row.blockingReason || row.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {postingResult && (postingResult.journals?.length || postingResult.summary?.journalsCreated) ? (
        <>
          <section className="apc-summary-grid">
            <SummaryCard label="Journals Created" value={postingResult.summary.journalsCreated || 0} />
            <SummaryCard label="Journals Skipped" value={postingResult.summary.journalsSkipped || 0} />
            <SummaryCard label="Errors" value={postingResult.summary?.errors ?? 0} />
          </section>
          <PostingResultTable result={postingResult} />
        </>
      ) : null}
    </div>
  )
}

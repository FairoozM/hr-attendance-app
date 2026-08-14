import { useCallback, useEffect, useState } from 'react'
import {
  applyNoonCreditNotes,
  fetchNoonCreditNoteApplyPlan,
  fetchNoonReturnFeePlan,
  postNoonReturnFeeJournals,
  type NoonPaymentClearingPreview,
  type NoonPaymentPreview,
  type NoonReturnFeePlan,
} from '../../../../api/noonPaymentClearing'

function money(n: number | null | undefined) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function NoonReturnClearingStep({
  preview,
  paymentPreview,
  isPosted,
  loading: parentLoading,
  onPlanChange,
  onNotice,
  onError,
}: {
  preview: NoonPaymentClearingPreview
  paymentPreview: NoonPaymentPreview | null
  isPosted: boolean
  loading: boolean
  onPlanChange?: (plan: NoonReturnFeePlan | null) => void
  onNotice: (msg: string) => void
  onError: (msg: string) => void
}) {
  const batchId = preview.batchId
  const returnCount = paymentPreview?.returns?.length ?? preview.refundReturnRows?.length ?? 0
  const returnBlocked = Boolean(paymentPreview?.summary?.returnBlocked)

  const [returnFeePlan, setReturnFeePlan] = useState<NoonReturnFeePlan | null>(null)
  const [cnPlanRows, setCnPlanRows] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [cnApplyResult, setCnApplyResult] = useState<Record<string, unknown> | null>(null)
  const [returnFeeResult, setReturnFeeResult] = useState<Record<string, unknown> | null>(null)

  const loadPlans = useCallback(async () => {
    if (!batchId) return
    setLoading(true)
    try {
      const [cnPlan, feePlan] = await Promise.all([
        fetchNoonCreditNoteApplyPlan(batchId),
        fetchNoonReturnFeePlan(batchId),
      ])
      setCnPlanRows((cnPlan as { planRows?: Array<Record<string, unknown>> }).planRows || [])
      setReturnFeePlan(feePlan)
      onPlanChange?.(feePlan)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load return clearing plans')
    } finally {
      setLoading(false)
    }
  }, [batchId, onError, onPlanChange])

  useEffect(() => {
    if (returnCount === 0) {
      setReturnFeePlan(null)
      onPlanChange?.(null)
      return
    }
    void loadPlans()
  }, [batchId, returnCount, loadPlans, onPlanChange])

  if (returnCount === 0) {
    return (
      <div className="npc-step-stack">
        <div className="npc-alert npc-approved-panel" role="status">
          No sales returns in this statement — return clearing is not required.
        </div>
      </div>
    )
  }

  if (!isPosted) {
    return (
      <div className="npc-step-stack">
        <p className="npc-muted">
          Complete <strong>Step 12</strong> (post sales payments and fee journals) before refunding credit notes and
          posting return fee reversal journals.
        </p>
      </div>
    )
  }

  const creditNotesDone = returnFeePlan?.creditNoteApplyComplete === true
  const returnFeesDone = returnFeePlan?.returnFeePostComplete === true

  async function onApplyCreditNotes(dryRun: boolean) {
    if (!batchId) return
    if (!dryRun && !window.confirm('Refund matched return Credit Notes to Noon Undeposited (1066)?')) return
    setWorking(true)
    onError('')
    try {
      const result = await applyNoonCreditNotes(batchId, dryRun)
      setCnApplyResult(result)
      onNotice(dryRun ? 'Credit note refund dry run complete.' : 'Credit note refunds posted.')
      await loadPlans()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Credit note apply failed')
    } finally {
      setWorking(false)
    }
  }

  async function onPostReturnFees(dryRun: boolean) {
    if (!batchId) return
    if (!dryRun && !window.confirm('Post return fee clearing journals (settlement + expense/VAT reversal) to Zoho?')) return
    setWorking(true)
    onError('')
    try {
      const plan = await fetchNoonReturnFeePlan(batchId)
      if (!plan.creditNoteApplyComplete && !dryRun) {
        onError('Refund all matched return credit notes before posting return fee journals.')
        return
      }
      const result = await postNoonReturnFeeJournals(batchId, dryRun)
      setReturnFeeResult(result)
      onNotice(dryRun ? 'Return fee journal dry run complete.' : 'Return fee journals posted.')
      await loadPlans()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Return fee journal post failed')
    } finally {
      setWorking(false)
    }
  }

  const busy = parentLoading || loading || working

  return (
    <div className="npc-step-stack">
      <p className="npc-muted">
        Refund matched Credit Notes to Undeposited (1066), then post return fee clearing journals — for each reversed
        commission/shipping fee: settlement (Dr 1066 / Cr 1067 or 1068) plus expense + VAT reversal (Dr 1067 or 1068 /
        Cr expense / Cr 1085).
      </p>

      {returnBlocked ? (
        <div className="npc-alert npc-alert--error" role="alert">
          Return clearing blocked — fix return matching in Step 5 and regenerate payment preview on Step 11.
        </div>
      ) : null}

      <div className="npc-button-row">
        <button type="button" className="ainv-btn ainv-btn--sm" disabled={busy} onClick={() => void loadPlans()}>
          {loading ? 'Loading…' : 'Refresh plans'}
        </button>
      </div>

      <h3>Credit note refunds</h3>
      {creditNotesDone ? (
        <div className="npc-alert npc-approved-panel" role="status">
          All matched credit notes have been refunded to Undeposited (1066).
        </div>
      ) : (
        <p className="npc-muted">Refund each matched CN so product return flows into 1066.</p>
      )}
      {cnPlanRows.length > 0 ? (
        <div className="npc-table-wrap">
          <table className="npc-table">
            <thead>
              <tr>
                <th>Item order</th>
                <th>Credit note</th>
                <th>Amount</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {cnPlanRows.map((row, idx) => (
                <tr key={`cn-plan-${idx}`}>
                  <td>
                    <code className="npc-ref">{String(row.itemOrderId || '—')}</code>
                  </td>
                  <td>{String(row.zohoCreditNoteNumber || row.creditNoteNumber || '—')}</td>
                  <td className="npc-money">{money(Number(row.amount ?? row.creditNoteAmount))}</td>
                  <td>{String(row.action || row.creditNoteAction || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="npc-button-row">
        <button
          type="button"
          className="ainv-btn"
          disabled={busy || returnBlocked}
          onClick={() => void onApplyCreditNotes(true)}
        >
          Dry run CN refunds
        </button>
        <button
          type="button"
          className="ainv-btn ainv-btn--danger"
          disabled={busy || returnBlocked || creditNotesDone}
          onClick={() => void onApplyCreditNotes(false)}
        >
          Refund credit notes
        </button>
      </div>

      <h3>Return fee reversal journals</h3>
      {!creditNotesDone ? (
        <p className="npc-muted">Complete credit note refunds above before posting return fee journals.</p>
      ) : returnFeesDone ? (
        <div className="npc-alert npc-approved-panel" role="status">
          Return fee journals have been posted.
        </div>
      ) : null}

      {returnFeePlan?.unclearedAccountProof ? (
        <div
          className={`npc-alert ${
            returnFeePlan.unclearedAccountProof.allUnclearedAccountsNetToZero
              ? 'npc-approved-panel'
              : 'npc-alert--error'
          }`}
        >
          <strong>Uncleared GL balances after return fee journals</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: '1.2rem' }}>
            <li>
              1067 Commission:{' '}
              {returnFeePlan.unclearedAccountProof.commission1067.allNetToZero ? 'nets to zero' : 'does not net to zero'}
              {returnFeePlan.unclearedAccountProof.commission1067.affectedItemCount > 0
                ? ` (${returnFeePlan.unclearedAccountProof.commission1067.affectedItemCount} return(s))`
                : ''}
            </li>
            <li>
              1068 Shipping:{' '}
              {returnFeePlan.unclearedAccountProof.shipping1068.allNetToZero ? 'nets to zero' : 'does not net to zero'}
              {returnFeePlan.unclearedAccountProof.shipping1068.affectedItemCount > 0
                ? ` (${returnFeePlan.unclearedAccountProof.shipping1068.affectedItemCount} return(s))`
                : ''}
            </li>
          </ul>
          {returnFeePlan.summary ? (
            <p className="npc-muted" style={{ marginTop: 8 }}>
              {returnFeePlan.summary.settlementJournalCount ?? 0} settlement +{' '}
              {returnFeePlan.summary.expenseReversalJournalCount ?? 0} expense/VAT reversal journal(s) planned.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="npc-button-row">
        <button
          type="button"
          className="ainv-btn"
          disabled={busy || returnBlocked || !creditNotesDone}
          onClick={() => void onPostReturnFees(true)}
        >
          Dry run return fees
        </button>
        <button
          type="button"
          className="ainv-btn ainv-btn--danger"
          disabled={busy || returnBlocked || !creditNotesDone || returnFeesDone}
          onClick={() => void onPostReturnFees(false)}
        >
          Post return fee journals
        </button>
      </div>

      {cnApplyResult ? (
        <div className="npc-alert npc-approved-panel" style={{ marginTop: 8 }}>
          Credit note apply: {String((cnApplyResult as { status?: string }).status || 'done')}
        </div>
      ) : null}
      {returnFeeResult ? (
        <div className="npc-alert npc-approved-panel" style={{ marginTop: 8 }}>
          Return fees: {String((returnFeeResult as { status?: string }).status || 'done')}
          {(() => {
            const summary = (returnFeeResult as { summary?: Record<string, number> }).summary
            if (!summary) return null
            const parts = [
              summary.settlementJournalsCreated ? `${summary.settlementJournalsCreated} settlement` : '',
              summary.expenseReversalJournalsCreated
                ? `${summary.expenseReversalJournalsCreated} expense/VAT reversal`
                : '',
              summary.journalsSkipped ? `${summary.journalsSkipped} skipped` : '',
            ].filter(Boolean)
            return parts.length ? ` (${parts.join(', ')})` : null
          })()}
        </div>
      ) : null}
    </div>
  )
}

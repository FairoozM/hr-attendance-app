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

type LocalStatus = { kind: 'info' | 'ok' | 'error'; text: string }

function summarizeCnResult(result: Record<string, unknown>, dryRun: boolean): LocalStatus {
  const results = (result.results as Array<Record<string, unknown>> | undefined) || []
  const wouldPost = results.filter((r) => r.dryRun || r.action === 'refund_existing').length
  const posted = results.filter((r) => r.posted === true).length
  const skipped = results.filter((r) => r.skipped === true).length
  const failed = results.filter((r) => r.error)
  if (failed.length) {
    return {
      kind: 'error',
      text: `${failed.length} credit note refund(s) failed. First: ${String(failed[0].error || 'Unknown error')}`,
    }
  }
  if (dryRun) {
    return {
      kind: 'ok',
      text: `Dry run OK — ${wouldPost || results.length} credit note refund(s) ready for Undeposited (1066). Now click “Refund credit notes”.`,
    }
  }
  return {
    kind: 'ok',
    text: `Posted ${posted} credit note refund(s) to Undeposited (1066)${skipped ? `, skipped ${skipped}` : ''}.`,
  }
}

function summarizeReturnFeeResult(result: Record<string, unknown>, dryRun: boolean): LocalStatus {
  const summary = (result.summary as Record<string, number> | undefined) || {}
  const errors = (result.errors as Array<Record<string, unknown>> | undefined) || []
  const created = Number(summary.journalsCreated ?? 0)
  const skipped = Number(summary.journalsSkipped ?? 0)
  if (errors.length) {
    return {
      kind: 'error',
      text: `${errors.length} journal(s) failed. First: ${String(errors[0].error || 'Unknown error')}`,
    }
  }
  if (dryRun) {
    return {
      kind: 'ok',
      text: `Dry run OK — ${created} journal(s) ready. Now click “Post return fee journals”.`,
    }
  }
  return {
    kind: 'ok',
    text: `Posted ${created} return fee journal(s)${skipped ? `, skipped ${skipped} already posted` : ''}.`,
  }
}

export function NoonReturnClearingStep({
  preview,
  paymentPreview,
  isPosted,
  onPlanChange,
  onNotice,
  onError,
}: {
  preview: NoonPaymentClearingPreview
  paymentPreview: NoonPaymentPreview | null
  isPosted: boolean
  /** Parent page loading — do not block CN refund buttons with this. */
  loading?: boolean
  onPlanChange?: (plan: NoonReturnFeePlan | null) => void
  onNotice: (msg: string) => void
  onError: (msg: string) => void
}) {
  const batchId = preview.batchId
  const returnCount = paymentPreview?.returns?.length ?? preview.refundReturnRows?.length ?? 0
  const returnBlocked = Boolean(paymentPreview?.summary?.returnBlocked)

  const [returnFeePlan, setReturnFeePlan] = useState<NoonReturnFeePlan | null>(null)
  const [cnPlanRows, setCnPlanRows] = useState<Array<Record<string, unknown>>>([])
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [working, setWorking] = useState(false)
  const [cnApplyResult, setCnApplyResult] = useState<Record<string, unknown> | null>(null)
  const [returnFeeResult, setReturnFeeResult] = useState<Record<string, unknown> | null>(null)
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null)
  const [skipCnGate, setSkipCnGate] = useState(false)

  const loadPlans = useCallback(async () => {
    if (!batchId) return
    setLoadingPlans(true)
    try {
      const [cnPlan, feePlan] = await Promise.all([
        fetchNoonCreditNoteApplyPlan(batchId),
        fetchNoonReturnFeePlan(batchId),
      ])
      setCnPlanRows((cnPlan as { planRows?: Array<Record<string, unknown>> }).planRows || [])
      setReturnFeePlan(feePlan)
      onPlanChange?.(feePlan)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load return clearing plans'
      setLocalStatus({ kind: 'error', text: msg })
      onError(msg)
    } finally {
      setLoadingPlans(false)
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
  // Never gate refund buttons on parent page loading — that made clicks look dead.
  const busy = loadingPlans || working

  async function onApplyCreditNotes(dryRun: boolean) {
    if (!batchId) {
      const msg = 'Missing batch id — reload this statement batch.'
      setLocalStatus({ kind: 'error', text: msg })
      onError(msg)
      return
    }
    if (!dryRun && !window.confirm('Refund matched return Credit Notes to Noon Undeposited (1066)?')) return

    setWorking(true)
    setLocalStatus({
      kind: 'info',
      text: dryRun ? 'Running credit note refund dry run…' : 'Posting credit note refunds to Zoho…',
    })
    onError('')

    try {
      const result = await applyNoonCreditNotes(batchId, dryRun)
      setCnApplyResult(result as Record<string, unknown>)
      const summary = summarizeCnResult(result as Record<string, unknown>, dryRun)
      setLocalStatus(summary)
      if (summary.kind === 'error') onError(summary.text)
      else onNotice(summary.text)
      await loadPlans()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Credit note apply failed'
      setLocalStatus({ kind: 'error', text: msg })
      onError(msg)
    } finally {
      setWorking(false)
    }
  }

  async function onPostReturnFees(dryRun: boolean) {
    if (!batchId) {
      const msg = 'Missing batch id — reload this statement batch.'
      setLocalStatus({ kind: 'error', text: msg })
      onError(msg)
      return
    }
    if (!dryRun && !window.confirm('Post return fee clearing journals (settlement + expense/VAT reversal) to Zoho?')) {
      return
    }

    setWorking(true)
    setLocalStatus({
      kind: 'info',
      text: dryRun ? 'Running return fee journal dry run…' : 'Posting return fee journals to Zoho…',
    })
    onError('')

    try {
      const plan = await fetchNoonReturnFeePlan(batchId)
      if (!plan.creditNoteApplyComplete && !dryRun && !skipCnGate) {
        const msg = 'Refund all matched return credit notes before posting return fee journals.'
        setLocalStatus({ kind: 'error', text: msg })
        onError(msg)
        return
      }
      const result = await postNoonReturnFeeJournals(batchId, dryRun, skipCnGate)
      setReturnFeeResult(result as Record<string, unknown>)
      const summary = summarizeReturnFeeResult(result as Record<string, unknown>, dryRun)
      setLocalStatus(summary)
      if (summary.kind === 'error') onError(summary.text)
      else onNotice(summary.text)
      await loadPlans()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Return fee journal post failed'
      setLocalStatus({ kind: 'error', text: msg })
      onError(msg)
    } finally {
      setWorking(false)
    }
  }

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
          {loadingPlans ? 'Loading…' : 'Refresh plans'}
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
                  <td className="npc-money">{money(Number(row.refundAmount ?? row.amount ?? row.creditNoteAmount))}</td>
                  <td>
                    {String(row.action || row.creditNoteAction || '—')}
                    {row.action === 'blocked' && row.blockingReason ? (
                      <div className="npc-muted" style={{ fontSize: '0.85em', marginTop: 2 }}>
                        {String(row.blockingReason)}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="npc-muted">No credit note plan rows loaded — click Refresh plans.</p>
      )}

      <div className="npc-button-row">
        <button
          type="button"
          className="ainv-btn"
          disabled={busy || returnBlocked}
          onClick={() => void onApplyCreditNotes(true)}
        >
          {working ? 'Working…' : 'Dry run CN refunds'}
        </button>
        <button
          type="button"
          className="ainv-btn ainv-btn--danger"
          disabled={busy || returnBlocked || creditNotesDone}
          onClick={() => void onApplyCreditNotes(false)}
        >
          {working ? 'Working…' : 'Refund credit notes'}
        </button>
      </div>

      {localStatus ? (
        <div
          className={`npc-alert ${
            localStatus.kind === 'error'
              ? 'npc-alert--error'
              : localStatus.kind === 'ok'
                ? 'npc-approved-panel'
                : ''
          }`}
          role={localStatus.kind === 'error' ? 'alert' : 'status'}
          style={{ marginTop: 8, fontWeight: 600 }}
        >
          {localStatus.text}
        </div>
      ) : (
        <p className="npc-muted" style={{ marginTop: 8 }}>
          After you click Dry run / Refund, status appears here (not only at the top of the page).
        </p>
      )}

      {cnApplyResult ? (
        <div className="npc-alert npc-approved-panel" style={{ marginTop: 8 }}>
          Last CN API result: dryRun={String((cnApplyResult as { dryRun?: boolean }).dryRun)} · rows=
          {Array.isArray((cnApplyResult as { results?: unknown[] }).results)
            ? (cnApplyResult as { results: unknown[] }).results.length
            : 0}
          {Array.isArray((cnApplyResult as { results?: Array<Record<string, unknown>> }).results) ? (
            <ul style={{ margin: '8px 0 0', paddingLeft: '1.2rem', fontWeight: 400 }}>
              {((cnApplyResult as { results: Array<Record<string, unknown>> }).results || []).map((row, idx) => (
                <li key={`cn-res-${idx}`}>
                  {String(row.itemOrderId || '—')}:{' '}
                  {row.error
                    ? `ERROR ${String(row.error)}`
                    : row.posted
                      ? 'posted'
                      : row.dryRun
                        ? 'dry-run ok'
                        : row.skipped
                          ? 'skipped'
                          : String(row.action || 'done')}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <h3>Return fee reversal journals</h3>
      {!creditNotesDone ? (
        <div className="npc-alert" style={{ marginBottom: 8 }}>
          <p className="npc-muted" style={{ marginTop: 0 }}>
            Credit note refunds are not confirmed here. If the refunds already exist in Zoho, tick the box to post the
            expense-reversal journals anyway. Journals already posted for this batch are skipped automatically.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={skipCnGate}
              onChange={(e) => setSkipCnGate(e.target.checked)}
            />
            Credit note refunds are already done in Zoho — post journals only
          </label>
        </div>
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
              {returnFeePlan.unclearedAccountProof.commission1067.allNetToZero
                ? 'nets to zero'
                : 'does not net to zero'}
              {returnFeePlan.unclearedAccountProof.commission1067.affectedItemCount > 0
                ? ` (${returnFeePlan.unclearedAccountProof.commission1067.affectedItemCount} return(s))`
                : ''}
            </li>
            <li>
              1068 Shipping:{' '}
              {returnFeePlan.unclearedAccountProof.shipping1068.allNetToZero
                ? 'nets to zero'
                : 'does not net to zero'}
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
          disabled={busy || returnBlocked}
          onClick={() => void onPostReturnFees(true)}
        >
          {working ? 'Working…' : 'Dry run return fees'}
        </button>
        <button
          type="button"
          className="ainv-btn ainv-btn--danger"
          disabled={busy || returnBlocked || (!creditNotesDone && !skipCnGate) || returnFeesDone}
          onClick={() => void onPostReturnFees(false)}
        >
          {working ? 'Working…' : 'Post return fee journals'}
        </button>
      </div>

      {returnFeeResult ? (
        <div className="npc-alert npc-approved-panel" style={{ marginTop: 8 }}>
          Return fees: {String((returnFeeResult as { status?: string }).status || 'done')}
        </div>
      ) : null}
    </div>
  )
}

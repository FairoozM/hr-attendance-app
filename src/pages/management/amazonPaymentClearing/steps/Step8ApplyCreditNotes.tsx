import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyCreditNotes,
  fetchCreditNoteApplyPlan,
  markReturnNotReceived,
  refreshReturnCreditNotes,
  unmarkReturnNotReceived,
  type CreditNoteApplyPlan,
  type CreditNoteApplyPlanRow,
  type PostingJobProgress,
} from '../../../../api/amazonPaymentClearing'
import { money, SummaryCard } from '../clearingShared'
import { PostingProgressBar } from '../components/PostingProgressBar'
import { PostingStatusPanel } from '../components/PostingStatusPanel'
import { undepositedFundsLabel } from '../marketplaceConfig'
import type { ClearingContext } from './clearingContext'

const ACTION_LABEL: Record<string, string> = {
  skipped_already_refunded: 'Already refunded in Zoho',
  skipped_already_applied: 'Already refunded in Zoho',
  skipped_already_posted: 'Recorded in clearing',
  refund_existing: 'Refund credit note to undeposited funds',
  apply_existing: 'Refund credit note to undeposited funds',
  create_and_refund: 'Create credit note and refund',
  create_and_apply: 'Create credit note and refund',
  blocked: 'Blocked',
  moved_to_not_received: 'Moved to step 11 (not received)',
}

const NOT_RECEIVED_ELIGIBLE_ACTIONS = new Set(['create_and_refund', 'create_and_apply', 'blocked'])

function canMarkNotReceived(row: CreditNoteApplyPlanRow) {
  return !row.zohoCreditNoteId && NOT_RECEIVED_ELIGIBLE_ACTIONS.has(row.action)
}

const READY_ACTIONS = new Set([
  'refund_existing',
  'apply_existing',
  'create_and_refund',
  'create_and_apply',
])

export function Step8ApplyCreditNotes({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  const [plan, setPlan] = useState<CreditNoteApplyPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [localError, setLocalError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [markingOrderId, setMarkingOrderId] = useState('')
  const [markReason, setMarkReason] = useState('')
  const [savingMark, setSavingMark] = useState(false)
  const [jobProgress, setJobProgress] = useState<PostingJobProgress | null>(null)
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null)
  const [jobTitle, setJobTitle] = useState('')

  const batchId = preview?.batch?.batchId
  const marksLocked = ctx.notReceivedCount > 0 && ctx.notReceivedComplete
  const settlementReturnCount = useMemo(() => {
    const refundRows = preview?.refundReturnRows?.length || 0
    const matchedReturns = preview?.matchedReturns?.length || 0
    const netNegative = preview?.netNegativeReturnOrders?.length || 0
    return Math.max(refundRows, matchedReturns, netNegative)
  }, [preview?.matchedReturns, preview?.netNegativeReturnOrders, preview?.refundReturnRows])

  const loadPlan = useCallback(async () => {
    if (!batchId) return
    setLoading(true)
    setLocalError('')
    try {
      const json = await fetchCreditNoteApplyPlan(ctx.marketplace, batchId)
      setPlan(json)
      await ctx.refreshPostClearingStepStatus(batchId)
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to load credit note refund plan')
    } finally {
      setLoading(false)
    }
  }, [batchId, ctx.refreshPostClearingStepStatus])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])

  if (!preview) return null

  const startJob = (title: string) => {
    setJobTitle(title)
    setJobProgress(null)
    setJobStartedAt(Date.now())
  }
  const endJob = () => {
    setJobStartedAt(null)
    setJobProgress(null)
  }

  const onRefreshFromZoho = async () => {
    if (!batchId) return
    setRefreshing(true)
    setLocalError('')
    startJob('Checking Zoho for credit notes…')
    try {
      const json = await refreshReturnCreditNotes(ctx.marketplace, batchId, setJobProgress)
      setPlan(json)
      await ctx.onReloadCurrentBatch()
      await ctx.refreshPostClearingStepStatus(batchId)
      const found = json.newlyFoundCreditNotes || []
      const missing = json.stillMissing || []
      const foundText = found.length
        ? `Found in Zoho: ${found.map((row) => `${row.orderId} (${row.zohoCreditNoteNumber || row.zohoCreditNoteId})`).join(', ')}.`
        : 'No new credit notes found in Zoho.'
      const missingText = missing.length
        ? ` Still missing: ${missing.map((row) => row.orderId).join(', ')}. Create them here, or mark them "Not received".`
        : ''
      ctx.setNotice(`${foundText}${missingText}`)
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to refresh credit notes from Zoho')
    } finally {
      setRefreshing(false)
      endJob()
    }
  }

  const onConfirmMark = async () => {
    if (!batchId || !markingOrderId) return
    const reason = markReason.trim()
    if (reason.length < 4) {
      setLocalError('Enter a reason (at least 4 characters) before marking a return as not received.')
      return
    }
    setSavingMark(true)
    setLocalError('')
    try {
      await markReturnNotReceived(ctx.marketplace, batchId, markingOrderId, reason)
      ctx.setNotice(`Order ${markingOrderId} moved to step 11 (returns not received).`)
      setMarkingOrderId('')
      setMarkReason('')
      await loadPlan()
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not mark the return as not received')
    } finally {
      setSavingMark(false)
    }
  }

  const onUndoMark = async (orderId: string) => {
    if (!batchId) return
    if (!window.confirm(`Move order ${orderId} back to step 10 credit notes?`)) return
    setSavingMark(true)
    setLocalError('')
    try {
      await unmarkReturnNotReceived(ctx.marketplace, batchId, orderId)
      ctx.setNotice(`Order ${orderId} is back in step 10.`)
      await loadPlan()
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not undo the not-received mark')
    } finally {
      setSavingMark(false)
    }
  }

  const onPreviewApply = async () => {
    if (!batchId) return
    setApplying(true)
    setLocalError('')
    startJob('Preparing the refund preview…')
    try {
      const json = await applyCreditNotes(ctx.marketplace, batchId, true, setJobProgress)
      setPlan(json.plan || null)
      ctx.setNotice('Dry run complete. Zoho was not changed.')
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Dry run failed')
    } finally {
      setApplying(false)
      endJob()
    }
  }

  const onApply = async () => {
    if (!batchId) return
    const ok = window.confirm(
      `Refund all ready credit notes to ${undepositedFundsLabel(ctx.marketplace)} in Zoho? Invoices were already paid in step 9.`
    )
    if (!ok) return
    setApplying(true)
    setLocalError('')
    startJob('Refunding credit notes in Zoho…')
    try {
      const json = await applyCreditNotes(ctx.marketplace, batchId, false, setJobProgress)
      setPlan(json.plan || null)
      await ctx.onReloadCurrentBatch()
      await ctx.refreshPostClearingStepStatus(batchId)
      const errorRows = (json.errors || []).filter((row) => row.error || row.blockingReason)
      if (errorRows.length) {
        setLocalError(errorRows.map((row) => `${row.orderId}: ${row.error || row.blockingReason}`).join(' | '))
      }
      const created = json.summary?.created ?? 0
      const refunded = json.summary?.refunded ?? json.summary?.applied ?? 0
      const uncertain = json.summary?.verificationRequired ?? 0
      const failed = json.summary?.errors ?? 0
      ctx.setNotice(
        json.success && uncertain === 0 && failed === 0
          ? `Credit note refunds posted. Created: ${created}, refunded: ${refunded}.`
          : `Credit note refunds partially posted. Created: ${created}, refunded: ${refunded}, verification required: ${uncertain}, failed: ${failed}. Uncertain entries are not resent automatically — review the status below.`
      )
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Refund failed')
    } finally {
      setApplying(false)
      endJob()
    }
  }

  const rows = plan?.rows || []
  const readyCount = rows.filter((row) => READY_ACTIONS.has(row.action)).length
  const existingCnCount = rows.filter((row) => row.zohoCreditNoteId && !row.action.startsWith('create_')).length
  const planLooksEmpty = rows.length === 0 && settlementReturnCount > 0
  const stepComplete = Boolean(plan?.summary?.isComplete || ctx.creditNoteApplyComplete)
  const movedCount = rows.filter((row) => row.action === 'moved_to_not_received').length
  const busy = loading || applying || refreshing || savingMark

  return (
    <div className="apc-step-stack">
      <div className="apc-alert">
        After sales payments are posted in step 9, refund each warehouse credit note to{' '}
        <strong>{undepositedFundsLabel(ctx.marketplace)}</strong>. Invoices are already paid — do not apply credit notes to them
        again. Missing credit notes are created first, then refunded. If Amazon refunded an order but the warehouse
        never received the product, mark it <strong>Not received</strong> — it moves to step 11 and is expensed to
        Amazon Return Exp instead.
      </div>

      {localError ? <div className="apc-alert apc-alert--error" role="alert">{localError}</div> : null}
      {planLooksEmpty ? (
        <div className="apc-alert apc-alert--error" role="alert">
          This settlement has {settlementReturnCount} return row(s) but no refund plan was built. Click Refresh credit
          notes from Zoho, or reopen the batch from step 1.
        </div>
      ) : null}

      <section className="apc-summary-grid">
        <SummaryCard label="Return Orders" value={plan?.summary?.totalRows ?? settlementReturnCount} />
        <SummaryCard label="Zoho Credit Notes" value={existingCnCount} />
        <SummaryCard label="Ready to Refund" value={readyCount} />
        <SummaryCard
          label="Already Refunded"
          value={plan?.summary?.skippedAlreadyRefunded ?? plan?.summary?.skippedAlreadyApplied ?? '-'}
        />
        <SummaryCard label="Verification Required" value={plan?.summary?.verificationRequired ?? 0} />
        <SummaryCard label="Moved to Step 11" value={movedCount} />
      </section>

      <div className="apc-button-row">
        <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => void onRefreshFromZoho()} disabled={busy}>
          {refreshing ? 'Checking Zoho...' : loading ? 'Loading...' : 'Refresh credit notes from Zoho'}
        </button>
        <button
          className="ainv-btn"
          type="button"
          onClick={() => void onPreviewApply()}
          disabled={!ctx.salesComplete || busy || readyCount === 0}
        >
          Preview refund
        </button>
        <button
          className="ainv-btn ainv-btn--danger"
          type="button"
          onClick={() => void onApply()}
          disabled={!ctx.salesComplete || busy || readyCount === 0}
        >
          {applying ? 'Refunding...' : 'Refund credit notes to undeposited funds'}
        </button>
        {stepComplete ? (
          movedCount > 0 || ctx.notReceivedCount > 0 ? (
            <button className="ainv-btn" type="button" onClick={() => ctx.goToStep(11)}>
              Continue to returns not received (step 11)
            </button>
          ) : (
            <button className="ainv-btn" type="button" onClick={() => ctx.goToStep(12)}>
              Continue to return fee clearing (step 12)
            </button>
          )
        ) : null}
      </div>

      {jobStartedAt != null ? (
        <PostingProgressBar
          progress={jobProgress}
          startedAt={jobStartedAt}
          startingText={jobTitle}
          itemNoun="Return"
          note="Zoho allows a limited number of requests per minute, so this can take a few minutes. It runs on the server — keep this tab open to see the result."
        />
      ) : null}
      {plan && !plan.liveRefreshedAt && rows.some(canMarkNotReceived) ? (
        <p className="apc-muted">
          Click <strong>Refresh credit notes from Zoho</strong> first — returns can only be marked "Not received" after
          Zoho has been checked for their credit notes.
        </p>
      ) : null}

      {!ctx.salesComplete ? (
        <p className="apc-muted">
          Every sales payment and fee journal in step 9 must be posted and verified first. You can review the Zoho credit
          note refund plan below while waiting.
        </p>
      ) : null}

      {batchId != null && ctx.salesComplete ? (
        <PostingStatusPanel
          marketplace={ctx.marketplace}
          batchId={batchId}
          status={ctx.postingStatus}
          currency={ctx.currency}
          loading={ctx.postingStatusLoading}
          groups={['credit_note']}
          onChanged={async (message) => {
            await ctx.refreshPostingStatus(batchId, message)
            await loadPlan()
          }}
          onResume={ctx.goToStep}
        />
      ) : null}

      <div className="apc-table-wrap apc-table-wrap--wide">
        <table className="apc-table">
          <thead>
            <tr>
              <th>Amazon order</th>
              <th>Zoho invoice</th>
              <th>Zoho credit note</th>
              <th className="apc-money">CN amount</th>
              <th className="apc-money">Amazon refund</th>
              <th className="apc-money">Refund amount</th>
              <th>Refund account</th>
              <th className="apc-money">Already refunded</th>
              <th>Action</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="apc-muted">
                  {loading ? 'Loading credit notes from Zoho...' : 'No return orders in this settlement.'}
                </td>
              </tr>
            ) : (
              rows.flatMap((row) => [
                <tr key={row.orderId}>
                  <td>{row.orderId}</td>
                  <td>{row.zohoInvoiceNumber || row.zohoInvoiceId || '-'}</td>
                  <td>
                    {row.zohoCreditNoteNumber || row.zohoCreditNoteId || (row.action.startsWith('create_') ? 'Will create' : '-')}
                  </td>
                  <td className="apc-money">{row.creditNoteAmount ? money(row.creditNoteAmount, ctx.currency) : '-'}</td>
                  <td className="apc-money">{money(row.amazonRefundAmount ?? row.applyAmount, ctx.currency)}</td>
                  <td className="apc-money">
                    {READY_ACTIONS.has(row.action) ? money(row.refundAmount ?? row.applyAmount, ctx.currency) : '-'}
                  </td>
                  <td>{row.refundAccountName || (READY_ACTIONS.has(row.action) ? undepositedFundsLabel(ctx.marketplace) : '-')}</td>
                  <td className="apc-money">
                    {(row.amountAlreadyRefunded ?? row.amountAlreadyApplied) != null &&
                    (row.amountAlreadyRefunded ?? row.amountAlreadyApplied)! > 0
                      ? money(row.amountAlreadyRefunded ?? row.amountAlreadyApplied, ctx.currency)
                      : '-'}
                  </td>
                  <td>{ACTION_LABEL[row.action] || row.action}</td>
                  <td>{row.error || row.blockingReason || row.status || '-'}</td>
                  <td>
                    {row.action === 'moved_to_not_received' ? (
                      <button
                        className="ainv-btn ainv-btn--sm"
                        type="button"
                        onClick={() => void onUndoMark(row.orderId)}
                        disabled={busy || marksLocked}
                        title={marksLocked ? 'The step 11 journal is already posted.' : undefined}
                      >
                        Undo
                      </button>
                    ) : canMarkNotReceived(row) ? (
                      <button
                        className="ainv-btn ainv-btn--sm"
                        type="button"
                        onClick={() => {
                          setMarkingOrderId(row.orderId)
                          setMarkReason('')
                        }}
                        disabled={busy || marksLocked}
                      >
                        Not received
                      </button>
                    ) : null}
                  </td>
                </tr>,
                markingOrderId === row.orderId ? (
                  <tr key={`${row.orderId}-mark`}>
                    <td colSpan={11}>
                      <div className="apc-button-row">
                        <span>
                          Not received — post {money(row.amazonRefundAmount ?? 0, ctx.currency)} to Amazon Return Exp (step 11).
                        </span>
                        <input
                          className="ainv-input"
                          type="text"
                          value={markReason}
                          onChange={(e) => setMarkReason(e.target.value)}
                          placeholder="Reason, e.g. warehouse checked SellerFlex returns, product not received"
                          style={{ minWidth: '24rem' }}
                          autoFocus
                        />
                        <button
                          className="ainv-btn ainv-btn--danger ainv-btn--sm"
                          type="button"
                          onClick={() => void onConfirmMark()}
                          disabled={savingMark || markReason.trim().length < 4}
                        >
                          {savingMark ? 'Saving...' : 'Move to step 11'}
                        </button>
                        <button
                          className="ainv-btn ainv-btn--sm"
                          type="button"
                          onClick={() => setMarkingOrderId('')}
                          disabled={savingMark}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ])
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

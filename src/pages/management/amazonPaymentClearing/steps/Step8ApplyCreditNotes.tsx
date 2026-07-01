import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyKsaCreditNotes,
  fetchKsaCreditNoteApplyPlan,
  type CreditNoteApplyPlan,
} from '../../../../api/amazonPaymentClearing'
import { money, SummaryCard } from '../clearingShared'
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

  const batchId = preview?.batch?.batchId
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
      const json = await fetchKsaCreditNoteApplyPlan(batchId)
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

  const onPreviewApply = async () => {
    if (!batchId) return
    setApplying(true)
    setLocalError('')
    try {
      const json = await applyKsaCreditNotes(batchId, true)
      setPlan(json.plan || null)
      ctx.setNotice('Dry run complete. Zoho was not changed.')
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Dry run failed')
    } finally {
      setApplying(false)
    }
  }

  const onApply = async () => {
    if (!batchId) return
    const ok = window.confirm(
      'Refund all ready credit notes to KSA-Amazon Undeposited Funds in Zoho? Invoices were already paid in step 9.'
    )
    if (!ok) return
    setApplying(true)
    setLocalError('')
    try {
      const json = await applyKsaCreditNotes(batchId, false)
      setPlan(json.plan || null)
      await ctx.onReloadCurrentBatch()
      await ctx.refreshPostClearingStepStatus(batchId)
      const errorRows = (json.errors || []).filter((row) => row.error || row.blockingReason)
      if (errorRows.length) {
        setLocalError(errorRows.map((row) => `${row.orderId}: ${row.error || row.blockingReason}`).join(' | '))
      }
      ctx.setNotice(
        json.success
          ? `Credit note refunds posted. Created: ${json.summary?.created ?? 0}, refunded: ${json.summary?.refunded ?? json.summary?.applied ?? 0}.`
          : 'Credit note refund finished with errors.'
      )
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Refund failed')
    } finally {
      setApplying(false)
    }
  }

  const rows = plan?.rows || []
  const readyCount = rows.filter((row) => READY_ACTIONS.has(row.action)).length
  const existingCnCount = rows.filter((row) => row.zohoCreditNoteId && !row.action.startsWith('create_')).length
  const planLooksEmpty = rows.length === 0 && settlementReturnCount > 0
  const stepComplete = Boolean(plan?.summary?.isComplete || ctx.creditNoteApplyComplete)

  return (
    <div className="apc-step-stack">
      <div className="apc-alert">
        After sales payments are posted in step 9, refund each warehouse credit note to{' '}
        <strong>KSA-Amazon Undeposited Funds</strong>. Invoices are already paid — do not apply credit notes to them
        again. Missing credit notes are created first, then refunded.
      </div>

      {localError ? <div className="apc-alert apc-alert--error" role="alert">{localError}</div> : null}
      {planLooksEmpty ? (
        <div className="apc-alert apc-alert--error" role="alert">
          This settlement has {settlementReturnCount} return row(s) but no refund plan was built. Click Refresh plan
          or reopen the batch from step 1.
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
      </section>

      <div className="apc-button-row">
        <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => void loadPlan()} disabled={loading || applying}>
          {loading ? 'Loading from Zoho...' : 'Refresh plan'}
        </button>
        <button
          className="ainv-btn"
          type="button"
          onClick={() => void onPreviewApply()}
          disabled={!ctx.isPosted || applying || readyCount === 0}
        >
          Preview refund
        </button>
        <button
          className="ainv-btn ainv-btn--danger"
          type="button"
          onClick={() => void onApply()}
          disabled={!ctx.isPosted || applying || readyCount === 0}
        >
          {applying ? 'Refunding...' : 'Refund credit notes to undeposited funds'}
        </button>
        {stepComplete ? (
          <button className="ainv-btn" type="button" onClick={() => ctx.goToStep(11)}>
            Continue to return fee clearing (step 11)
          </button>
        ) : null}
      </div>

      {!ctx.isPosted ? (
        <p className="apc-muted">
          Post sales payments in step 9 first. You can review the Zoho credit note refund plan below while waiting.
        </p>
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
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="apc-muted">
                  {loading ? 'Loading credit notes from Zoho...' : 'No return orders in this settlement.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.orderId}>
                  <td>{row.orderId}</td>
                  <td>{row.zohoInvoiceNumber || row.zohoInvoiceId || '-'}</td>
                  <td>
                    {row.zohoCreditNoteNumber || row.zohoCreditNoteId || (row.action.startsWith('create_') ? 'Will create' : '-')}
                  </td>
                  <td className="apc-money">{row.creditNoteAmount ? money(row.creditNoteAmount) : '-'}</td>
                  <td className="apc-money">{money(row.amazonRefundAmount ?? row.applyAmount)}</td>
                  <td className="apc-money">
                    {READY_ACTIONS.has(row.action) ? money(row.refundAmount ?? row.applyAmount) : '-'}
                  </td>
                  <td>{row.refundAccountName || (READY_ACTIONS.has(row.action) ? 'KSA-Amazon Undeposited Funds' : '-')}</td>
                  <td className="apc-money">
                    {(row.amountAlreadyRefunded ?? row.amountAlreadyApplied) != null &&
                    (row.amountAlreadyRefunded ?? row.amountAlreadyApplied)! > 0
                      ? money(row.amountAlreadyRefunded ?? row.amountAlreadyApplied)
                      : '-'}
                  </td>
                  <td>{ACTION_LABEL[row.action] || row.action}</td>
                  <td>{row.error || row.blockingReason || row.status || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

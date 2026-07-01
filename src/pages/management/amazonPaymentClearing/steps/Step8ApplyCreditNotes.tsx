import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyKsaCreditNotes,
  fetchKsaCreditNoteApplyPlan,
  type CreditNoteApplyPlan,
} from '../../../../api/amazonPaymentClearing'
import { money, SummaryCard } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

const ACTION_LABEL: Record<string, string> = {
  skipped_already_applied: 'Already applied in Zoho',
  skipped_already_posted: 'Recorded in clearing',
  apply_existing: 'Apply credit note to invoice',
  create_and_apply: 'Create credit note and apply',
  blocked: 'Blocked',
}

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
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to load credit note apply plan')
    } finally {
      setLoading(false)
    }
  }, [batchId])

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
    const ok = window.confirm('Apply credit notes to Zoho invoices for all ready return rows?')
    if (!ok) return
    setApplying(true)
    setLocalError('')
    try {
      const json = await applyKsaCreditNotes(batchId, false)
      setPlan(json.plan || null)
      await ctx.onReloadCurrentBatch()
      ctx.setNotice(
        json.success
          ? `Credit notes applied. Created: ${json.summary?.created ?? 0}, applied: ${json.summary?.applied ?? 0}.`
          : 'Credit note apply finished with errors.'
      )
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  const rows = plan?.rows || []
  const readyCount = rows.filter((row) => row.action === 'apply_existing' || row.action === 'create_and_apply').length
  const existingCnCount = rows.filter((row) => row.zohoCreditNoteId && row.action !== 'create_and_apply').length
  const planLooksEmpty = rows.length === 0 && settlementReturnCount > 0

  return (
    <div className="apc-step-stack">
      <div className="apc-alert">
        After sales payments are posted in step 9, apply existing warehouse credit notes to their invoices for the full
        credit note amount. Missing credit notes are created from the Amazon principal refund only.
      </div>

      {localError ? <div className="apc-alert apc-alert--error" role="alert">{localError}</div> : null}
      {planLooksEmpty ? (
        <div className="apc-alert apc-alert--error" role="alert">
          This settlement has {settlementReturnCount} return row(s) but no apply plan was built. Click Refresh plan
          or reopen the batch from step 1.
        </div>
      ) : null}

      <section className="apc-summary-grid">
        <SummaryCard label="Return Orders" value={plan?.summary?.totalRows ?? settlementReturnCount} />
        <SummaryCard label="Zoho Credit Notes" value={existingCnCount} />
        <SummaryCard label="Ready to Apply" value={readyCount} />
        <SummaryCard label="Already Applied" value={plan?.summary?.skippedAlreadyApplied ?? '-'} />
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
          Preview apply
        </button>
        <button
          className="ainv-btn ainv-btn--danger"
          type="button"
          onClick={() => void onApply()}
          disabled={!ctx.isPosted || applying || readyCount === 0}
        >
          {applying ? 'Applying...' : 'Apply credit notes to invoices'}
        </button>
      </div>

      {!ctx.isPosted ? (
        <p className="apc-muted">
          Post sales payments in step 9 first. You can review the Zoho credit note plan below while waiting.
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
              <th className="apc-money">Apply to invoice</th>
              <th className="apc-money">Already applied</th>
              <th>Action</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="apc-muted">
                  {loading ? 'Loading credit notes from Zoho...' : 'No return orders in this settlement.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.orderId}>
                  <td>{row.orderId}</td>
                  <td>{row.zohoInvoiceNumber || row.zohoInvoiceId || '-'}</td>
                  <td>
                    {row.zohoCreditNoteNumber || row.zohoCreditNoteId || (row.action === 'create_and_apply' ? 'Will create' : '-')}
                  </td>
                  <td className="apc-money">{row.creditNoteAmount ? money(row.creditNoteAmount) : '-'}</td>
                  <td className="apc-money">{money(row.amazonRefundAmount ?? row.applyAmount)}</td>
                  <td className="apc-money">
                    {row.action === 'apply_existing' || row.action === 'create_and_apply' ? money(row.applyAmount) : '-'}
                  </td>
                  <td className="apc-money">
                    {row.amountAlreadyApplied != null && row.amountAlreadyApplied > 0 ? money(row.amountAlreadyApplied) : '-'}
                  </td>
                  <td>{ACTION_LABEL[row.action] || row.action}</td>
                  <td>{row.blockingReason || row.status || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

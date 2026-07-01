import { useCallback, useEffect, useState } from 'react'
import {
  applyKsaCreditNotes,
  fetchKsaCreditNoteApplyPlan,
  type CreditNoteApplyPlan,
} from '../../../../api/amazonPaymentClearing'
import { money, SummaryCard } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

const ACTION_LABEL: Record<string, string> = {
  skipped_already_applied: 'Already applied in Zoho',
  skipped_already_posted: 'Already posted in clearing',
  apply_existing: 'Apply existing credit note',
  create_and_apply: 'Create and apply',
  blocked: 'Blocked',
}

export function Step8ApplyCreditNotes({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  const [plan, setPlan] = useState<CreditNoteApplyPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [localError, setLocalError] = useState('')

  const batchId = preview?.batch?.batchId

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
      ctx.setNotice('Credit note apply dry run completed. No Zoho changes were made.')
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Dry run failed')
    } finally {
      setApplying(false)
    }
  }

  const onApply = async () => {
    if (!batchId) return
    const ok = window.confirm('Apply credit notes to Zoho for all ready return rows?')
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

  return (
    <div className="apc-step-stack">
      <div className="apc-alert">
        Warehouse may have already created credit notes in Zoho. This step applies them to invoices, or creates and
        applies missing credit notes from the Amazon refund amount.
      </div>

      {localError ? <div className="apc-alert apc-alert--error" role="alert">{localError}</div> : null}

      <section className="apc-summary-grid">
        <SummaryCard label="Return Rows" value={plan?.summary?.totalRows ?? '-'} />
        <SummaryCard label="Ready to Apply" value={readyCount} />
        <SummaryCard label="Already Applied" value={plan?.summary?.skippedAlreadyApplied ?? '-'} />
        <SummaryCard label="Blocked" value={plan?.summary?.blocked ?? '-'} />
      </section>

      <div className="apc-button-row">
        <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => void loadPlan()} disabled={loading || applying}>
          {loading ? 'Loading...' : 'Refresh plan'}
        </button>
        <button className="ainv-btn" type="button" onClick={() => void onPreviewApply()} disabled={!ctx.isApproved || applying || readyCount === 0}>
          Preview apply
        </button>
        <button className="ainv-btn ainv-btn--danger" type="button" onClick={() => void onApply()} disabled={!ctx.isApproved || applying || readyCount === 0}>
          {applying ? 'Working...' : 'Apply credit notes'}
        </button>
      </div>

      {!ctx.isApproved ? <p className="apc-muted">Approve the settlement in step 6 before applying credit notes.</p> : null}

      <div className="apc-table-wrap">
        <table className="apc-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Invoice</th>
              <th>Credit note</th>
              <th>Action</th>
              <th className="apc-money">Apply amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="apc-muted">No return credit note rows for this settlement.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.orderId}>
                  <td>{row.orderId}</td>
                  <td>{row.zohoInvoiceNumber || row.zohoInvoiceId || '-'}</td>
                  <td>{row.zohoCreditNoteNumber || row.zohoCreditNoteId || (row.action === 'create_and_apply' ? 'Will create' : '-')}</td>
                  <td>{ACTION_LABEL[row.action] || row.action}</td>
                  <td className="apc-money">{money(row.applyAmount)}</td>
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

import { useCallback, useEffect, useState } from 'react'
import { fetchKsaReturnFeePlan, type ReturnFeePlan } from '../../../../api/amazonPaymentClearing'
import { money, SummaryCard } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

export function Step9ReturnFeeClearing({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  const [plan, setPlan] = useState<ReturnFeePlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  const batchId = preview?.batch?.batchId

  const loadPlan = useCallback(async () => {
    if (!batchId) return
    setLoading(true)
    setLocalError('')
    try {
      const json = await fetchKsaReturnFeePlan(batchId)
      setPlan(json)
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to load return fee plan')
    } finally {
      setLoading(false)
    }
  }, [batchId])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])

  if (!preview) return null

  return (
    <div className="apc-step-stack">
      <div className="apc-alert">
        Amazon may reverse commission on a return but still keep shipping/FBA fees. These journals post in step 11
        alongside sales payments — they are not a single opaque net difference.
      </div>

      {localError ? <div className="apc-alert apc-alert--error" role="alert">{localError}</div> : null}
      {(plan?.warnings || []).map((warning) => (
        <div key={warning} className="apc-alert apc-alert--error" role="alert">{warning}</div>
      ))}

      <div className="apc-button-row">
        <button className="ainv-btn ainv-btn--sm" type="button" onClick={() => void loadPlan()} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh return fee plan'}
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

      <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Planned journals (posted in step 11)</h3>
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
    </div>
  )
}

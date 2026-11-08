import { Download } from 'lucide-react'
import { Badge } from './PurchasePlanningBadges'
import type { PurchasePlan } from './purchasePlanningTypes'
import { computeVigilFollowUp, fmt, vigilFollowUpToCsv, type VigilFollowUpLine } from './purchasePlanningUtils'

function FollowUpTable({ lines, showReason }: { lines: VigilFollowUpLine[]; showReason: boolean }) {
  return (
    <div className="doc-table-wrap pp-enrichment-list__table-wrap">
      <table className="doc-table pp-enrichment-list__table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product name</th>
            {showReason && <th>Issue</th>}
            <th>Needed</th>
            <th>Ordered</th>
            <th>Vigil available</th>
            <th>Shortfall</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.sku}>
              <td className="pp-mono">{line.sku}</td>
              <td>{line.itemName || '—'}</td>
              {showReason && (
                <td>
                  <Badge tone="danger">{line.reason}</Badge>
                </td>
              )}
              <td>{fmt(line.neededQty)}</td>
              <td>{fmt(line.orderedQty)}</td>
              <td>{fmt(line.vigilQty)}</td>
              <td>
                <strong>{fmt(line.shortfallQty)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function VigilFollowUpSummary({ plan }: { plan: PurchasePlan }) {
  const followUp = computeVigilFollowUp(plan)
  const total = followUp.capped.length + followUp.unavailable.length
  const sumShortfall = (lines: VigilFollowUpLine[]) => lines.reduce((sum, line) => sum + line.shortfallQty, 0)
  const cappedShortfall = sumShortfall(followUp.capped)
  const unavailableShortfall = sumShortfall(followUp.unavailable)

  if (total === 0) {
    return (
      <div className="pp-follow-up" aria-labelledby="pp-follow-up-title">
        <h3 id="pp-follow-up-title">Vigil follow-up</h3>
        <p className="pp-hint">Vigil covered every line in full — nothing to follow up.</p>
      </div>
    )
  }

  const downloadCsv = () => {
    const blob = new Blob([vigilFollowUpToCsv(followUp)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${plan.purchaseOrderNumber || plan.planNumber}-vigil-follow-up.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="pp-follow-up" aria-labelledby="pp-follow-up-title">
      <div className="pp-follow-up__head">
        <div>
          <h3 id="pp-follow-up-title">Vigil follow-up ({total})</h3>
          <p className="pp-hint">
            Lines Vigil could not fully cover on this PO. Source the shortfall elsewhere or reorder when Vigil restocks.
          </p>
        </div>
        <button type="button" className="btn btn--sm" onClick={downloadCsv}>
          <Download size={14} aria-hidden /> Download CSV
        </button>
      </div>

      <ul className="pp-follow-up__totals">
        <li>
          <Badge tone="warning">Vigil capped</Badge> {followUp.capped.length} line(s), {fmt(cappedShortfall)} units short
        </li>
        <li>
          <Badge tone="danger">Not in Vigil</Badge> {followUp.unavailable.length} line(s),{' '}
          {fmt(unavailableShortfall)} units short
        </li>
        <li>
          <strong>Total shortfall: {fmt(cappedShortfall + unavailableShortfall)} units</strong>
        </li>
      </ul>

      {followUp.capped.length > 0 && (
        <div className="pp-follow-up__group">
          <h4>
            <Badge tone="warning">Vigil capped</Badge> Vigil had less stock than needed ({followUp.capped.length})
          </h4>
          <FollowUpTable lines={followUp.capped} showReason={false} />
        </div>
      )}

      {followUp.unavailable.length > 0 && (
        <div className="pp-follow-up__group">
          <h4>
            <Badge tone="danger">Not in Vigil</Badge> Not ordered — no Vigil match or zero wholesale stock (
            {followUp.unavailable.length})
          </h4>
          <FollowUpTable lines={followUp.unavailable} showReason />
        </div>
      )}
    </section>
  )
}

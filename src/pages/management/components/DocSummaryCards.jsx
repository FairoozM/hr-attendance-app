import { useMemo } from 'react'
import { getSmartStatus, STATUS } from '../utils/docExpiryUtils'

function SummaryCard({ label, count, variant }) {
  return (
    <div className={`doc-summary-card doc-summary-card--${variant}`}>
      <span className="doc-summary-card__count">{count}</span>
      <span className="doc-summary-card__label">{label}</span>
    </div>
  )
}

export function DocSummaryCards({ documents }) {
  const counts = useMemo(() => {
    const result = { total: documents.length, ok: 0, dueSoon: 0, urgent: 0, expired: 0 }
    for (const doc of documents) {
      const s = getSmartStatus(doc.expiryDate)
      if (s === STATUS.OK)       result.ok++
      else if (s === STATUS.DUE_SOON) result.dueSoon++
      else if (s === STATUS.URGENT)   result.urgent++
      else if (s === STATUS.EXPIRED)  result.expired++
    }
    return result
  }, [documents])

  return (
    <div className="doc-summary-cards">
      <SummaryCard label="Total Records" count={counts.total}   variant="total"    />
      <SummaryCard label="OK"            count={counts.ok}      variant="ok"       />
      <SummaryCard label="Due Soon"      count={counts.dueSoon} variant="due-soon" />
      <SummaryCard label="Urgent"        count={counts.urgent}  variant="urgent"   />
      <SummaryCard label="Expired"       count={counts.expired} variant="expired"  />
    </div>
  )
}

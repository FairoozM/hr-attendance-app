interface SummaryCardsProps {
  summary: {
    totalOutOfStock?: number
    readyToUpdate?: number
    noStockAvailable?: number
    zohoNotMatched?: number
    vigilNotMatched?: number
    needsManualReview?: number
    totalRecommendedUnits?: number
  } | null
}

function formatNumber(value: number | undefined) {
  if (value == null) return '—'
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
    </div>
  )
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  const s = summary || {}
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <SummaryCard label="Ready to Update" value={formatNumber(s.readyToUpdate)} />
      <SummaryCard label="No Stock Available" value={formatNumber(s.noStockAvailable)} />
      <SummaryCard label="Zoho Not Matched" value={formatNumber(s.zohoNotMatched)} />
      <SummaryCard label="Vigil Not Matched" value={formatNumber(s.vigilNotMatched)} />
      <SummaryCard label="Needs Manual Review" value={formatNumber(s.needsManualReview)} />
      <SummaryCard label="Total Recommended Units" value={formatNumber(s.totalRecommendedUnits)} />
    </div>
  )
}

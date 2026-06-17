function fmtUsd(n) {
  const v = Number(n) || 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(v)
}

function fmtInt(n) {
  return new Intl.NumberFormat('en-US').format(Number(n) || 0)
}

export function AiStatsCards({ summary }) {
  if (!summary) return null
  const items = [
    { label: 'Today AI cost', value: fmtUsd(summary.todayCost), tone: 'violet' },
    { label: 'Monthly cost', value: fmtUsd(summary.monthCost), tone: 'cyan' },
    { label: 'Total tokens', value: fmtInt(summary.totalTokensUsed), tone: 'emerald' },
    { label: 'Avg / request', value: fmtUsd(summary.avgCostPerRequest), tone: 'amber' },
    { label: 'Listings generated', value: fmtInt(summary.productsGenerated), tone: 'pink' },
    { label: 'Failed (month)', value: fmtInt(summary.failedRequestsMonth), tone: 'rose' },
    { label: 'Remaining (day)', value: fmtUsd(summary.remainingBudgetDaily), tone: 'lime' },
    { label: 'Remaining (month)', value: fmtUsd(summary.remainingBudgetMonthly), tone: 'teal' },
  ]

  const toneRing = {
    violet: 'ring-violet-500/30',
    cyan: 'ring-cyan-500/30',
    emerald: 'ring-emerald-500/30',
    amber: 'ring-amber-500/30',
    pink: 'ring-pink-500/30',
    rose: 'ring-rose-500/30',
    lime: 'ring-lime-500/30',
    teal: 'ring-teal-500/30',
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-lg shadow-black/20 ring-1 backdrop-blur-md ${toneRing[item.tone] || ''}`}
        >
          <p className="text-[0.65rem] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-white sm:text-2xl">{item.value}</p>
        </div>
      ))}
    </div>
  )
}

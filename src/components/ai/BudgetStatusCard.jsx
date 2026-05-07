export function BudgetStatusCard({ summary }) {
  if (!summary?.limits) return null
  const { daily_budget_usd, monthly_budget_usd, alert_threshold_percent } = summary.limits
  const alertDay = summary.alerts?.dailyNearOrOver
  const alertMo = summary.alerts?.monthlyNearOrOver

  return (
    <div
      className={`rounded-2xl border p-5 backdrop-blur-md ${
        alertDay || alertMo
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-white/10 bg-white/[0.04]'
      }`}
    >
      <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Budget guardrails</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">Daily cap (USD)</p>
          <p className="text-lg font-semibold text-white">{Number(daily_budget_usd).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Monthly cap (USD)</p>
          <p className="text-lg font-semibold text-white">{Number(monthly_budget_usd).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Alert threshold</p>
          <p className="text-lg font-semibold text-white">{alert_threshold_percent}%</p>
        </div>
      </div>
      {(alertDay || alertMo) && (
        <p className="mt-3 text-sm text-amber-100">
          Spend crossed the alert threshold for {alertDay && 'today'}
          {alertDay && alertMo ? ' and ' : ''}
          {alertMo && 'this month'}. Review usage by module or adjust caps in AI Budget (admin).
        </p>
      )}
      {!summary.openaiConfigured && (
        <p className="mt-3 text-sm text-rose-300">Server missing OPENAI_API_KEY — generation will fail until configured.</p>
      )}
      {summary.allow_ai_generation === false && (
        <p className="mt-3 text-sm text-amber-200">AI generation is disabled in admin settings.</p>
      )}
    </div>
  )
}

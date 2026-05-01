import { BadgeDollarSign, Crown, Eye, Heart, MessageCircle, Share2, TrendingUp, UsersRound } from 'lucide-react'
import { formatNumber, getDailyTotals, getHighestEngagementRecord, getTopInfluencer, toNumber } from '../../utils/influencerPerformanceUtils'

function KpiCard({ label, value, tone, icon: Icon, helper }) {
  return (
    <article className={`ip-kpi ip-kpi--${tone}`}>
      <div className="ip-kpi__icon">
        <Icon size={20} />
      </div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        {helper ? <em>{helper}</em> : null}
      </div>
    </article>
  )
}

export function InfluencerDashboardCards({ influencers, records, today }) {
  const totals = getDailyTotals(records, today)
  const topInfluencer = getTopInfluencer(records, influencers)
  const highestEngagement = getHighestEngagementRecord(records, influencers)
  const totalCost = records.reduce((sum, record) => sum + toNumber(record.cost), 0)

  return (
    <section className="ip-kpi-grid" aria-label="Influencer performance summary">
      <KpiCard label="Total influencers" value={formatNumber(influencers.length)} tone="violet" icon={UsersRound} />
      <KpiCard label="Total views today" value={formatNumber(totals.views)} tone="blue" icon={Eye} />
      <KpiCard label="Total likes today" value={formatNumber(totals.likes)} tone="rose" icon={Heart} />
      <KpiCard label="Total comments today" value={formatNumber(totals.comments)} tone="amber" icon={MessageCircle} />
      <KpiCard label="Total shares today" value={formatNumber(totals.shares)} tone="cyan" icon={Share2} />
      <KpiCard
        label="Best performing influencer"
        value={topInfluencer?.name || 'No records'}
        tone="emerald"
        icon={Crown}
        helper={topInfluencer ? `${formatNumber(topInfluencer.views)} views` : 'Add a daily record'}
      />
      <KpiCard
        label="Highest engagement rate"
        value={highestEngagement ? `${toNumber(highestEngagement.engagementRate).toFixed(2)}%` : '0.00%'}
        tone="indigo"
        icon={TrendingUp}
        helper={highestEngagement?.influencerName}
      />
      <KpiCard label="Total campaign cost" value={formatNumber(totalCost, { currency: 'AED' })} tone="slate" icon={BadgeDollarSign} />
    </section>
  )
}

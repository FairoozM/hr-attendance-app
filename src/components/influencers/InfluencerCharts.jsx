import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getPlatformStats, toNumber } from '../../utils/influencerPerformanceUtils'

const COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#6366f1']

function ChartCard({ title, subtitle, children }) {
  return (
    <article className="ip-chart-card">
      <div className="ip-chart-card__head">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="ip-chart-card__body">
        {children}
      </div>
    </article>
  )
}

function TooltipBox({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="ip-chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={item.dataKey || item.name} style={{ color: item.color }}>
          {item.name}: {Number(item.value || 0).toLocaleString()}
        </span>
      ))}
    </div>
  )
}

export function InfluencerCharts({ records, influencersById }) {
  const viewsOverTime = useMemo(() => {
    const byDate = new Map()
    records.forEach((record) => {
      const current = byDate.get(record.date) || { date: record.date, views: 0, likes: 0, shares: 0 }
      current.views += toNumber(record.views)
      current.likes += toNumber(record.likes)
      current.shares += toNumber(record.shares)
      byDate.set(record.date, current)
    })
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [records])

  const engagementByInfluencer = useMemo(() => {
    const byInfluencer = new Map()
    records.forEach((record) => {
      const influencer = influencersById.get(String(record.influencerId))
      const name = influencer?.name || 'Unknown'
      const current = byInfluencer.get(record.influencerId) || { name, engagement: 0, records: 0 }
      current.engagement += toNumber(record.engagementRate)
      current.records += 1
      byInfluencer.set(record.influencerId, current)
    })
    return Array.from(byInfluencer.values())
      .map((item) => ({ ...item, engagement: Number((item.engagement / Math.max(item.records, 1)).toFixed(2)) }))
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 8)
  }, [records, influencersById])

  const platformComparison = useMemo(() => getPlatformStats(records), [records])

  const campaignPerformance = useMemo(() => {
    const byCampaign = new Map()
    records.forEach((record) => {
      const name = record.campaignName || 'Unassigned'
      const current = byCampaign.get(name) || { name, views: 0, cost: 0, engagement: 0, records: 0 }
      current.views += toNumber(record.views)
      current.cost += toNumber(record.cost)
      current.engagement += toNumber(record.engagementRate)
      current.records += 1
      byCampaign.set(name, current)
    })
    return Array.from(byCampaign.values())
      .map((item) => ({ ...item, engagement: Number((item.engagement / Math.max(item.records, 1)).toFixed(2)) }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 8)
  }, [records])

  return (
    <section className="ip-charts-grid" aria-label="Influencer performance charts">
      <ChartCard title="Views over time" subtitle="Daily views with engagement signals">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={viewsOverTime} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<TooltipBox />} />
            <Area type="monotone" dataKey="views" name="Views" stroke="#8b5cf6" fill="url(#viewsGradient)" strokeWidth={3} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Engagement by influencer" subtitle="Average engagement rate">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={engagementByInfluencer} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={58} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<TooltipBox />} />
            <Bar dataKey="engagement" name="Engagement %" radius={[10, 10, 4, 4]}>
              {engagementByInfluencer.map((entry, index) => (
                <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Platform comparison" subtitle="Views and interactions by channel">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={platformComparison} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
            <XAxis dataKey="platform" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<TooltipBox />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="views" name="Views" fill="#06b6d4" radius={[8, 8, 0, 0]} />
            <Bar dataKey="likes" name="Likes" fill="#ec4899" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Campaign performance" subtitle="Top campaigns by views">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={campaignPerformance} layout="vertical" margin={{ top: 8, right: 12, left: 32, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
            <Tooltip content={<TooltipBox />} />
            <Bar dataKey="views" name="Views" fill="#10b981" radius={[0, 10, 10, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  )
}

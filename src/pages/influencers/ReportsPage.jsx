import { useMemo } from 'react'
import { useInfluencers, WORKFLOW_STAGES } from '../../contexts/InfluencersContext'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import './influencers.css'

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#06b6d4','#84cc16','#e11d48','#0891b2','#7c3aed','#059669']

const STAGE_COLORS = {
  'New Lead': '#94a3b8', 'Contacted': '#3b82f6', 'Waiting for Price': '#f59e0b',
  'Waiting for Insights': '#f97316', 'Under Review': '#8b5cf6', 'Shortlisted': '#06b6d4',
  'Approved': '#10b981', 'Rejected': '#ef4444', 'Shoot Scheduled': '#3b82f6',
  'Shot Completed': '#10b981', 'Waiting for Upload': '#f59e0b', 'Uploaded': '#06b6d4',
  'Payment Pending': '#ec4899', 'Paid': '#059669', 'Closed': '#475569',
}

function StatCard({ value, label, color }) {
  return (
    <div className={`inf-stat inf-stat--${color}`}>
      <div className="inf-stat__value">{value}</div>
      <div className="inf-stat__label">{label}</div>
    </div>
  )
}

export function ReportsPage() {
  const { influencers } = useInfluencers()

  const stats = useMemo(() => {
    const byStage = (stage) => influencers.filter(i => i.workflowStatus === stage).length
    const byApproval = (s) => influencers.filter(i => i.approvalStatus === s).length
    const byPayment = (s) => influencers.filter(i => i.paymentStatus === s).length

    return {
      total: influencers.length,
      contacted: influencers.filter(i => !['New Lead'].includes(i.workflowStatus)).length,
      awaitingInsights: influencers.filter(i => i.workflowStatus === 'Waiting for Insights').length,
      shortlisted: byApproval('Shortlisted'),
      approved: byApproval('Approved'),
      rejected: byApproval('Rejected'),
      shootScheduled: byStage('Shoot Scheduled'),
      waitingUpload: byStage('Waiting for Upload'),
      paymentPending: byPayment('Ready for Payment') + byPayment('Payment Processing'),
      paid: byPayment('Paid'),
    }
  }, [influencers])

  // Pipeline breakdown data
  const pipelineData = useMemo(() =>
    WORKFLOW_STAGES.map(stage => ({
      name: stage.length > 14 ? stage.substring(0, 14) + '…' : stage,
      fullName: stage,
      count: influencers.filter(i => i.workflowStatus === stage).length,
      fill: STAGE_COLORS[stage] || '#94a3b8',
    })).filter(d => d.count > 0)
  , [influencers])

  // Approval breakdown
  const approvalData = useMemo(() => [
    { name: 'Approved', value: stats.approved, fill: '#10b981' },
    { name: 'Pending', value: influencers.filter(i => i.approvalStatus === 'Pending').length, fill: '#94a3b8' },
    { name: 'Shortlisted', value: stats.shortlisted, fill: '#06b6d4' },
    { name: 'Rejected', value: stats.rejected, fill: '#ef4444' },
  ].filter(d => d.value > 0), [influencers, stats])

  // Payment breakdown
  const paymentData = useMemo(() => [
    { name: 'Not Requested', value: influencers.filter(i => i.paymentStatus === 'Not Requested').length, fill: '#94a3b8' },
    { name: 'Bank Pending', value: influencers.filter(i => i.paymentStatus === 'Bank Details Pending').length, fill: '#f97316' },
    { name: 'Ready', value: influencers.filter(i => i.paymentStatus === 'Ready for Payment').length, fill: '#f59e0b' },
    { name: 'Processing', value: influencers.filter(i => i.paymentStatus === 'Payment Processing').length, fill: '#3b82f6' },
    { name: 'Paid', value: influencers.filter(i => i.paymentStatus === 'Paid').length, fill: '#10b981' },
  ].filter(d => d.value > 0), [influencers])

  // By city
  const cityData = useMemo(() => {
    const counts = {}
    influencers.forEach(i => { if (i.basedIn) counts[i.basedIn] = (counts[i.basedIn] || 0) + 1 })
    return Object.entries(counts).map(([name, value], idx) => ({ name, value, fill: COLORS[idx % COLORS.length] }))
      .sort((a, b) => b.value - a.value)
  }, [influencers])

  // By niche
  const nicheData = useMemo(() => {
    const counts = {}
    influencers.forEach(i => { if (i.niche) counts[i.niche] = (counts[i.niche] || 0) + 1 })
    return Object.entries(counts).map(([name, value], idx) => ({ name, value, fill: COLORS[idx % COLORS.length] }))
      .sort((a, b) => b.value - a.value)
  }, [influencers])

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload?.length) {
      return (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '0.65rem 0.85rem', fontSize: '0.82rem', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          {label || payload[0]?.name}: <strong>{payload[0]?.value}</strong>
        </div>
      )
    }
    return null
  }

  return (
    <div className="inf-page">
      <div className="inf-page-header">
        <div>
          <h1 className="inf-page-title">Reports & Analytics</h1>
          <p className="inf-page-subtitle">Overview of your influencer programme</p>
        </div>
      </div>

      {/* Top Summary Stats */}
      <div className="inf-stats-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <StatCard value={stats.total} label="Total" color="blue" />
        <StatCard value={stats.contacted} label="Contacted" color="indigo" />
        <StatCard value={stats.awaitingInsights} label="Awaiting Insights" color="amber" />
        <StatCard value={stats.shortlisted} label="Shortlisted" color="teal" />
        <StatCard value={stats.approved} label="Approved" color="green" />
        <StatCard value={stats.rejected} label="Rejected" color="red" />
        <StatCard value={stats.shootScheduled} label="Shoot Scheduled" color="purple" />
        <StatCard value={stats.waitingUpload} label="Waiting Upload" color="orange" />
        <StatCard value={stats.paymentPending} label="Payment Pending" color="pink" />
        <StatCard value={stats.paid} label="Paid" color="green" />
      </div>

      {/* Charts row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
        {/* Pipeline stage bar */}
        <div className="clay-card">
          <h3 style={{ margin: '0 0 1rem', fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pipeline Breakdown</h3>
          {pipelineData.length === 0 ? <div className="inf-empty"><div className="inf-empty__icon">📊</div></div> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={pipelineData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {pipelineData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Approval pie */}
        <div className="clay-card">
          <h3 style={{ margin: '0 0 1rem', fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Approvals vs Rejections</h3>
          {approvalData.length === 0 ? <div className="inf-empty"><div className="inf-empty__icon">📊</div></div> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={approvalData} cx="50%" cy="50%" outerRadius={85} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false} fontSize={11}>
                  {approvalData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.78rem' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
        {/* Payment breakdown */}
        <div className="clay-card">
          <h3 style={{ margin: '0 0 1rem', fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Payment Status</h3>
          {paymentData.length === 0 ? <div className="inf-empty"><div className="inf-empty__icon">💳</div></div> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={paymentData} cx="50%" cy="50%" outerRadius={85} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false} fontSize={11}>
                  {paymentData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.78rem' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By city */}
        <div className="clay-card">
          <h3 style={{ margin: '0 0 1rem', fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Influencers by City</h3>
          {cityData.length === 0 ? <div className="inf-empty"><div className="inf-empty__icon">🗺️</div></div> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={cityData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {cityData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Niche breakdown */}
      <div className="clay-card">
        <h3 style={{ margin: '0 0 1rem', fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Influencers by Niche</h3>
        {nicheData.length === 0 ? (
          <div className="inf-empty"><div className="inf-empty__icon">🏷️</div><div className="inf-empty__title">No data</div></div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={nicheData} margin={{ top: 0, right: 20, left: 0, bottom: 40 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {nicheData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Summary table */}
      <div className="clay-card" style={{ marginTop: '1.25rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Influencer Summary</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="inf-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Instagram</th>
                <th>Niche</th>
                <th>Based In</th>
                <th>Followers</th>
                <th>Package</th>
                <th>Stage</th>
                <th>Approval</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {influencers.map(inf => (
                <tr key={inf.id}>
                  <td><span className="inf-table__name">{inf.name}</span></td>
                  <td><span className="inf-table__handle">{inf.instagram?.handle || '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.niche || '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.basedIn || '—'}</span></td>
                  <td><span className="inf-table__muted">{inf.followersCount || '—'}</span></td>
                  <td><span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{inf.packagePrice ? `${inf.currency} ${Number(inf.packagePrice).toLocaleString()}` : '—'}</span></td>
                  <td>
                    <span className="inf-badge inf-badge--dot" style={{ background: `${STAGE_COLORS[inf.workflowStatus]}22`, color: STAGE_COLORS[inf.workflowStatus] }}>
                      {inf.workflowStatus}
                    </span>
                  </td>
                  <td>
                    <span className={`inf-badge inf-badge--dot ${inf.approvalStatus === 'Approved' ? 'inf-badge--approved' : inf.approvalStatus === 'Rejected' ? 'inf-badge--rejected' : 'inf-badge--pending'}`}>
                      {inf.approvalStatus}
                    </span>
                  </td>
                  <td>
                    <span className={`inf-badge inf-badge--dot ${inf.paymentStatus === 'Paid' ? 'inf-badge--paid' : inf.paymentStatus === 'Ready for Payment' ? 'inf-badge--ready' : 'inf-badge--not-requested'}`}>
                      {inf.paymentStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

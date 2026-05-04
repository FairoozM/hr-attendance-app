import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Eye, Pencil, Trash2 } from 'lucide-react'
import { formatNumber, getDayNumber, toNumber } from '../../utils/influencerPerformanceUtils'

const columns = [
  ['date', 'Date'],
  ['influencer', 'Influencer'],
  ['videoTitle', 'Video contract'],
  ['dayNumber', 'Day'],
  ['views', 'Views'],
  ['likes', 'Likes'],
  ['comments', 'Comments'],
  ['shares', 'Shares'],
  ['engagementRate', 'Eng.'],
  ['cost', 'Cost'],
]

function sortIndicator(sort, key) {
  if (sort.key !== key) return ''
  return sort.direction === 'asc' ? ' ↑' : ' ↓'
}

export function InfluencerPerformanceTable({
  records,
  influencersById,
  sort,
  onSort,
  onView,
  onEdit,
  onDelete,
  activeMonitorInfluencerId,
  onToggleMonitor,
}) {
  const [expandedInfluencers, setExpandedInfluencers] = useState(() => new Set())

  const groupedRecords = useMemo(() => {
    const groups = new Map()
    records.forEach((record) => {
      const key = String(record.influencerId || 'unknown')
      const influencer = influencersById.get(key)
      const group = groups.get(key) || {
        id: key,
        influencer,
        records: [],
        contracts: new Set(),
        totals: { views: 0, likes: 0, comments: 0, shares: 0, cost: 0 },
        engagementSum: 0,
      }

      group.records.push(record)
      group.contracts.add(record.videoTitle || record.campaignName || record.contractId || 'Contract')
      group.totals.views += toNumber(record.views)
      group.totals.likes += toNumber(record.likes)
      group.totals.comments += toNumber(record.comments)
      group.totals.shares += toNumber(record.shares)
      group.totals.cost += toNumber(record.cost)
      group.engagementSum += toNumber(record.engagementRate)
      groups.set(key, group)
    })

    return Array.from(groups.values()).map((group) => ({
      ...group,
      latestRecord: group.records[0],
      averageEngagement: group.records.length ? group.engagementSum / group.records.length : 0,
    }))
  }, [influencersById, records])

  return (
    <section className="ip-table-card">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><Eye size={18} /></span>
        <div>
          <h2>Performance records</h2>
          <p>Collapsed by influencer. Expand a row to review or edit daily records.</p>
        </div>
      </div>

      <div className="inf-table-wrap ip-table-wrap">
        <table className="inf-table ip-table">
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th key={key} className={sort.key === key ? 'sorted' : ''} onClick={() => onSort(key)}>
                  {label}{sortIndicator(sort, key)}
                </th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1}>
                  <div className="ip-empty-row">No performance records match these filters.</div>
                </td>
              </tr>
            ) : groupedRecords.map((group) => {
              const isExpanded = expandedInfluencers.has(group.id)
              const isMonitorActive = String(activeMonitorInfluencerId) === String(group.id)
              const influencer = group.influencer
              const latestRecord = group.latestRecord
              return (
                <Fragment key={group.id}>
                  <tr key={group.id} className={`ip-table__group-row ${isMonitorActive ? 'ip-table__group-row--active' : ''}`}>
                    <td>
                      <span className="ip-table__expand-label">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {latestRecord?.date || '-'}
                      </span>
                    </td>
                    <td>
                      <span className="inf-table__name">{influencer?.name || 'Unknown'}</span>
                      <span className="ip-table__sub">{influencer?.username || ''} · {latestRecord?.platform || '-'}</span>
                    </td>
                    <td>
                      <span className="inf-table__name">{formatNumber(group.contracts.size)} contracts</span>
                      <span className="ip-table__sub">{latestRecord?.videoTitle || latestRecord?.campaignName || 'Latest contract'}</span>
                    </td>
                    <td><strong>{formatNumber(group.records.length)} records</strong></td>
                    <td>{formatNumber(group.totals.views)}</td>
                    <td>{formatNumber(group.totals.likes)}</td>
                    <td>{formatNumber(group.totals.comments)}</td>
                    <td>{formatNumber(group.totals.shares)}</td>
                    <td><strong>{group.averageEngagement.toFixed(2)}%</strong></td>
                    <td>{formatNumber(group.totals.cost, { currency: 'AED' })}</td>
                    <td>
                      <button
                        type="button"
                        className="inf-btn inf-btn--ghost inf-btn--xs ip-table__expand-btn"
                        onClick={(event) => {
                          event.stopPropagation()
                          setExpandedInfluencers((current) => {
                            const next = new Set(current)
                            if (isMonitorActive) next.delete(group.id)
                            else next.add(group.id)
                            return next
                          })
                          onToggleMonitor(group.id)
                        }}
                      >
                        {isMonitorActive ? 'Hide' : 'Show'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? group.records.map((record) => (
                    <tr key={record.id} className="ip-table__detail-row">
                      <td>{record.date}</td>
                      <td>
                        <span className="inf-table__name">{influencer?.name || 'Unknown'}</span>
                        <span className="ip-table__sub">{influencer?.username || ''} · {record.platform}</span>
                      </td>
                      <td>
                        <span className="inf-table__name">{record.videoTitle || record.campaignName}</span>
                        <span className="ip-table__sub">{record.campaignName}</span>
                      </td>
                      <td><strong>Day {getDayNumber(record.contractStartDate, record.date) || 1}</strong></td>
                      <td>{formatNumber(record.views)}</td>
                      <td>{formatNumber(record.likes)}</td>
                      <td>{formatNumber(record.comments)}</td>
                      <td>{formatNumber(record.shares)}</td>
                      <td><strong>{toNumber(record.engagementRate).toFixed(2)}%</strong></td>
                      <td>{formatNumber(record.cost, { currency: 'AED' })}</td>
                      <td>
                        <div className="inf-table__actions">
                          <button type="button" className="inf-btn-icon" onClick={() => onView(record)} aria-label="View performance record">
                            <Eye size={15} />
                          </button>
                          <button type="button" className="inf-btn-icon" onClick={() => onEdit(record)} aria-label="Edit performance record">
                            <Pencil size={15} />
                          </button>
                          <button type="button" className="inf-btn-icon ip-danger-icon" onClick={() => onDelete(record.id)} aria-label="Delete performance record">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

import { Eye, Pencil, Trash2 } from 'lucide-react'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'

const columns = [
  ['date', 'Date'],
  ['influencer', 'Influencer'],
  ['platform', 'Platform'],
  ['campaignName', 'Campaign'],
  ['views', 'Views'],
  ['likes', 'Likes'],
  ['comments', 'Comments'],
  ['shares', 'Shares'],
  ['saves', 'Saves'],
  ['followersGained', 'Followers gained'],
  ['engagementRate', 'Engagement rate'],
  ['cost', 'Cost'],
]

function sortIndicator(sort, key) {
  if (sort.key !== key) return ''
  return sort.direction === 'asc' ? ' ↑' : ' ↓'
}

export function InfluencerPerformanceTable({ records, influencersById, sort, onSort, onView, onEdit, onDelete }) {
  return (
    <section className="ip-table-card">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><Eye size={18} /></span>
        <div>
          <h2>Performance records</h2>
          <p>Sortable campaign performance with quick actions for review and edits.</p>
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
            ) : records.map((record) => {
              const influencer = influencersById.get(String(record.influencerId))
              return (
                <tr key={record.id}>
                  <td>{record.date}</td>
                  <td>
                    <span className="inf-table__name">{influencer?.name || 'Unknown'}</span>
                    <span className="ip-table__sub">{influencer?.username || ''}</span>
                  </td>
                  <td><span className="ip-platform-badge">{record.platform}</span></td>
                  <td>{record.campaignName}</td>
                  <td>{formatNumber(record.views)}</td>
                  <td>{formatNumber(record.likes)}</td>
                  <td>{formatNumber(record.comments)}</td>
                  <td>{formatNumber(record.shares)}</td>
                  <td>{formatNumber(record.saves)}</td>
                  <td>{formatNumber(record.followersGained)}</td>
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
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

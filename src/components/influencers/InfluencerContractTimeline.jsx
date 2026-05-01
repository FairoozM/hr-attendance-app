import { CalendarClock, ExternalLink, Eye, Heart, MessageCircle, Pencil, Send, Trash2 } from 'lucide-react'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'

function contractStatus(contract) {
  if (contract.recordedDays >= contract.monitoringDays) return 'Completed'
  if (contract.recordedDays > 0) return 'Monitoring'
  return 'Pending'
}

export function InfluencerContractTimeline({ contracts, onEditRecord, onDeleteRecord, onEditContract }) {
  return (
    <section className="ip-contract-panel" aria-label="Video contract monitoring">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><CalendarClock size={18} /></span>
        <div>
          <h2>Video contract monitoring</h2>
          <p>One contracted video per influencer, tracked across consecutive Day 1 to Day 5 performance checks.</p>
        </div>
      </div>

      <div className="ip-hud-list">
        {contracts.length === 0 ? (
          <div className="ip-empty-row">No video contracts match these filters.</div>
        ) : contracts.map((contract) => (
          <HudContractCard
            key={contract.id}
            contract={contract}
            onEditRecord={onEditRecord}
            onDeleteRecord={onDeleteRecord}
            onEditContract={onEditContract}
          />
        ))}
      </div>
    </section>
  )
}

function displayDate(date) {
  if (!date) return '--'
  const [year, month, day] = String(date).split('-')
  return year && month && day ? `${day}/${month}/${year}` : date
}

function metricTotal(contract, key) {
  return contract.days.reduce((sum, day) => sum + toNumber(day.record?.[key]), 0)
}

function HudContractCard({ contract, onEditRecord, onDeleteRecord, onEditContract }) {
  const metricConfig = [
    ['Views', 'views', Eye],
    ['Shares', 'shares', Send],
    ['Likes', 'likes', Heart],
    ['Cmts', 'comments', MessageCircle],
  ]

  const totals = {
    views: metricTotal(contract, 'views'),
    likes: metricTotal(contract, 'likes'),
    shares: metricTotal(contract, 'shares'),
    comments: metricTotal(contract, 'comments'),
  }

  function makeDraftRecord(day) {
    return {
      influencerId: contract.influencerId,
      date: day.date,
      platform: contract.platform,
      postUrl: contract.postUrl,
      campaignName: contract.campaignName,
      videoTitle: contract.videoTitle,
      contractId: contract.id,
      contractStartDate: contract.contractStartDate,
      monitoringDays: contract.monitoringDays,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      followersGained: 0,
      storyViews: 0,
      cost: 0,
      notes: '',
      screenshotUrl: '',
    }
  }

  return (
    <article className="ip-hud-root">
      <div className="ip-hud-corner ip-hud-corner--tl" />
      <div className="ip-hud-corner ip-hud-corner--tr" />
      <div className="ip-hud-corner ip-hud-corner--bl" />
      <div className="ip-hud-corner ip-hud-corner--br" />

      <header className="ip-hud-topbar">
        <div>
          <div className="ip-hud-label">// contract monitor · {contractStatus(contract).toLowerCase()}</div>
          <div className="ip-hud-name-row">
            <h3 className="ip-hud-name">{contract.influencer?.name || 'Influencer'}</h3>
            <button type="button" className="ip-hud-contract-edit" onClick={() => onEditContract(contract)} aria-label="Edit contract influencer">
              <Pencil size={15} />
            </button>
          </div>
          <div className="ip-hud-followers"><span /> {formatNumber(contract.influencer?.followers)} followers</div>
        </div>
        <div className="ip-hud-header-totals" aria-label="Total performance summary">
          {[
            ['views', 'Total Views', totals.views, Eye],
            ['likes', 'Total Likes', totals.likes, Heart],
            ['shares', 'Total Shares', totals.shares, Send],
            ['comments', 'Total Comments', totals.comments, MessageCircle],
          ].map(([key, label, value, Icon]) => (
            <div key={key} className={`ip-hud-header-total ip-hud-header-total--${key}`}>
              <span><Icon size={14} /> {label}</span>
              <strong>{formatNumber(value)}</strong>
            </div>
          ))}
        </div>
        <div className="ip-hud-meta">
          <div className="ip-hud-platform"><span className="ip-hud-platform-dot" />{contract.platform}</div>
          <div>
            <span className="ip-hud-eng">Eng. {toNumber(contract.averageEngagementRate).toFixed(2)}%</span>
            <span className="ip-hud-monitor">{contract.recordedDays}/{contract.monitoringDays} days</span>
          </div>
        </div>
      </header>

      <div className="ip-hud-days">
        {contract.days.map((day) => (
          <section key={day.dayNumber} className={`ip-hud-day ${day.isRecorded ? 'ip-hud-day--active' : ''}`}>
            <div className="ip-hud-day-head">
              <div>
                <button
                  type="button"
                  className="ip-hud-day-date-button"
                  onClick={() => onEditRecord(day.record || makeDraftRecord(day))}
                  aria-label={`Edit date for day ${day.dayNumber}`}
                >
                  {displayDate(day.date)}
                </button>
              </div>
              <div className="ip-hud-day-actions">
                <button
                  type="button"
                  onClick={() => onEditRecord(day.record || makeDraftRecord(day))}
                  aria-label={`${day.isRecorded ? 'Edit' : 'Add'} day ${day.dayNumber}`}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  disabled={!day.isRecorded}
                  onClick={() => { if (day.isRecorded) onDeleteRecord(day.record.id) }}
                  aria-label={`Delete day ${day.dayNumber}`}
                  title={day.isRecorded ? 'Delete this day' : 'No saved record to delete'}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            {metricConfig.map(([label, key, Icon]) => (
              <div key={key} className="ip-hud-metric-row">
                <span><Icon size={15} /> {label}</span>
                <strong className={`ip-hud-value ip-hud-value--${key}`}>
                  {day.isRecorded ? formatNumber(day.record[key]) : '-'}
                </strong>
              </div>
            ))}
          </section>
        ))}
        <section className="ip-hud-day ip-hud-day--total" aria-label="Total performance">
          <div className="ip-hud-day-head">
            <div className="ip-hud-day-total-title">Total</div>
          </div>
          {metricConfig.map(([label, key, Icon]) => (
            <div key={key} className="ip-hud-metric-row">
              <span><Icon size={13} /> {label}</span>
              <strong className={`ip-hud-value ip-hud-value--${key}`}>
                {formatNumber(totals[key])}
              </strong>
            </div>
          ))}
        </section>
      </div>

      <footer className="ip-hud-bottom">
        <div>
          <div className="ip-hud-posted-label">// posted on</div>
          <div className="ip-hud-posted-platform"><span className="ip-hud-ig-logo" /> {contract.platform}</div>
        </div>
        {contract.postUrl ? (
          <a className="ip-hud-open-link" href={contract.postUrl} target="_blank" rel="noopener noreferrer">
            Open Video <ExternalLink size={16} />
          </a>
        ) : null}
      </footer>
    </article>
  )
}

import { CalendarClock, ExternalLink, Eye, Heart, MessageCircle, Pencil, Send, Trash2 } from 'lucide-react'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'
import { fmtDMY } from '../../utils/dateFormat'

function contractStatus(contract) {
  if (contract.recordedDays >= contract.monitoringDays) return 'Completed'
  if (contract.recordedDays > 0) return 'Monitoring'
  return 'Pending'
}

export function InfluencerContractTimeline({ contracts, onEditRecord, onDeleteRecord, onEditContract, onSaveRecord }) {
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
            onSaveRecord={onSaveRecord}
          />
        ))}
      </div>
    </section>
  )
}

function displayDate(date) {
  return fmtDMY(date)
}

function metricTotal(contract, key) {
  const days = Array.isArray(contract?.days) ? contract.days : []
  const fromDays = days.reduce((sum, day) => sum + toNumber(day?.record?.[key]), 0)
  if (fromDays > 0) return fromDays
  return toNumber(contract?.totals?.[key])
}

function HudContractCard({ contract, onEditRecord, onDeleteRecord, onEditContract, onSaveRecord }) {
  const days = Array.isArray(contract?.days) ? contract.days : []
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
      contractId: contract.id,
      contractStartDate: contract.contractStartDate,
      monitoringDays: contract.monitoringDays,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      salesAed: 0,
      cost: 0,
      notes: '',
      screenshotUrl: '',
    }
  }

  function saveMetric(day, key, value) {
    if (!onSaveRecord || !day?.date) return
    const nextValue = value === '' ? 0 : toNumber(value)
    const base = day?.record || makeDraftRecord(day)
    if (day?.isRecorded && toNumber(base?.[key]) === nextValue) return
    const now = new Date().toISOString()
    onSaveRecord({
      ...base,
      [key]: nextValue,
      createdAt: base.createdAt || now,
      updatedAt: now,
    })
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
            {onEditContract ? (
              <button type="button" className="ip-hud-contract-edit" onClick={() => onEditContract(contract)} aria-label="Edit contract influencer">
                <Pencil size={15} />
              </button>
            ) : null}
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
        {days.length === 0 ? (
          <div className="ip-empty-row">No daily timeline records are available for this contract.</div>
        ) : days.map((day) => (
          <section key={day.dayNumber} className={`ip-hud-day ${day.isRecorded ? 'ip-hud-day--active' : ''}`}>
            <div className="ip-hud-day-head">
              <div>
                {onEditRecord ? (
                  <button
                    type="button"
                    className="ip-hud-day-date-button"
                    onClick={() => onEditRecord(day?.record || makeDraftRecord(day))}
                    aria-label={`Edit date for day ${day?.dayNumber || ''}`}
                  >
                    {displayDate(day?.date)}
                  </button>
                ) : (
                  <span className="ip-hud-day-date">{displayDate(day?.date)}</span>
                )}
              </div>
              <div className="ip-hud-day-actions">
                {onEditRecord ? (
                  <button
                    type="button"
                    onClick={() => onEditRecord(day?.record || makeDraftRecord(day))}
                    aria-label={`${day.isRecorded ? 'Edit' : 'Add'} day ${day.dayNumber}`}
                  >
                    <Pencil size={12} />
                  </button>
                ) : null}
                {onDeleteRecord ? (
                  <button
                    type="button"
                    disabled={!day?.isRecorded || !day?.record?.id}
                    onClick={() => { if (day?.isRecorded && day?.record?.id) onDeleteRecord(day.record.id) }}
                    aria-label={`Delete day ${day?.dayNumber || ''}`}
                    title={day?.isRecorded ? 'Delete this day' : 'No saved record to delete'}
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            </div>
            {metricConfig.map(([label, key, Icon]) => (
              <div key={key} className="ip-hud-metric-row">
                <span><Icon size={15} /> {label}</span>
                {onSaveRecord ? (
                  <input
                    className={`ip-hud-value ip-hud-value-input ip-hud-value--${key}`}
                    inputMode="numeric"
                    defaultValue={day?.isRecorded ? toNumber(day?.record?.[key]) : ''}
                    placeholder="-"
                    aria-label={`${label} for ${displayDate(day?.date)}`}
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={(event) => saveMetric(day, key, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                ) : (
                  <strong className={`ip-hud-value ip-hud-value--${key}`}>
                    {day?.isRecorded ? formatNumber(day?.record?.[key]) : '-'}
                  </strong>
                )}
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

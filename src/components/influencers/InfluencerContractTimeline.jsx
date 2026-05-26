import { useEffect, useState } from 'react'
import { CalendarClock, Check, ExternalLink, Eye, GalleryHorizontal, Heart, MessageCircle, Pencil, Send, Trash2 } from 'lucide-react'
import { formatNumber, parseMetricInput, toNumber } from '../../utils/influencerPerformanceUtils'
import { fmtDMY } from '../../utils/dateFormat'
import { influencerInitials } from './influencerPerformanceTableShared'
import { StepBadge } from './StepBadge'

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
  const anyDayRecorded = days.some((day) => day?.isRecorded)
  if (anyDayRecorded) return fromDays
  return toNumber(contract?.totals?.[key])
}

function HudContractCard({ contract, onEditRecord, onDeleteRecord, onEditContract, onSaveRecord }) {
  const influencer = contract.influencer
  const influencerName = influencer?.name || 'Influencer'
  const profileImage = influencer?.profileImage
  const days = Array.isArray(contract?.days) ? contract.days : []
  const [avatarPhotoLoaded, setAvatarPhotoLoaded] = useState(false)
  const [avatarPhotoFailed, setAvatarPhotoFailed] = useState(false)
  const [drafts, setDrafts] = useState({})

  useEffect(() => {
    setAvatarPhotoLoaded(false)
    setAvatarPhotoFailed(false)
  }, [profileImage])
  /** `${draftKey}:${metricKey}` — when set, that inline metric shows raw digits for editing (blur shows K-style like totals). */
  const [focusedMetricCell, setFocusedMetricCell] = useState(null)
  const metricConfig = [
    ['Views', 'views', Eye],
    ['Story', 'storyViews', GalleryHorizontal],
    ['Shares', 'shares', Send],
    ['Likes', 'likes', Heart],
    ['Cmts', 'comments', MessageCircle],
  ]

  const totals = {
    views: metricTotal(contract, 'views'),
    storyViews: metricTotal(contract, 'storyViews'),
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
      storyViews: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      salesAed: 0,
      cost: 0,
      notes: '',
      screenshotUrl: '',
    }
  }

  function draftKey(day) {
    return String(day?.record?.id || `${contract.id}:${day?.date || day?.dayNumber || ''}`)
  }

  function getDraft(day, key) {
    const id = draftKey(day)
    if (drafts[id]?.[key] != null) return drafts[id][key]
    return day?.isRecorded ? toNumber(day?.record?.[key]) : ''
  }

  function updateDraft(day, key, value) {
    setDrafts((current) => ({
      ...current,
      [draftKey(day)]: {
        ...current[draftKey(day)],
        [key]: value,
      },
    }))
  }

  function hasDraft(day) {
    const values = drafts[draftKey(day)]
    if (!values) return false
    return metricConfig.some(([, key]) => {
      if (values[key] == null) return false
      return parseMetricInput(values[key]) !== toNumber(day?.record?.[key])
    })
  }

  function metricCellFocusId(day, key) {
    return `${draftKey(day)}:${key}`
  }

  /** Match header/total: abbreviated K/M unless this cell is focused for editing. */
  function inlineMetricDisplayValue(day, key) {
    const raw = getDraft(day, key)
    if (raw === '' || raw == null) return ''
    if (focusedMetricCell === metricCellFocusId(day, key)) return String(raw)
    return formatNumber(parseMetricInput(raw))
  }

  function saveDay(day) {
    if (!onSaveRecord || !day?.date) return
    const values = drafts[draftKey(day)] || {}
    const base = day?.record || makeDraftRecord(day)
    const now = new Date().toISOString()
    const latestRec = contract.latest

    let cost = toNumber(base.cost)
    let salesAed = toNumber(base.salesAed)
    let netProfitAed = base.netProfitAed

    if (!base.id && latestRec) {
      cost = toNumber(latestRec.cost)
      salesAed = toNumber(latestRec.salesAed)
      netProfitAed = latestRec.netProfitAed
    } else if (base.id && latestRec && String(base.id) === String(latestRec.id)) {
      cost = toNumber(base.cost)
      salesAed = toNumber(base.salesAed)
      netProfitAed = base.netProfitAed
    } else if (base.id) {
      cost = 0
      salesAed = 0
      netProfitAed = undefined
    }

    onSaveRecord({
      ...base,
      views: values.views == null ? toNumber(base.views) : parseMetricInput(values.views),
      storyViews: values.storyViews == null ? toNumber(base.storyViews) : parseMetricInput(values.storyViews),
      shares: values.shares == null ? toNumber(base.shares) : parseMetricInput(values.shares),
      likes: values.likes == null ? toNumber(base.likes) : parseMetricInput(values.likes),
      comments: values.comments == null ? toNumber(base.comments) : parseMetricInput(values.comments),
      cost,
      salesAed,
      netProfitAed,
      createdAt: base.createdAt || now,
      updatedAt: now,
    })
    setDrafts((current) => {
      const next = { ...current }
      delete next[draftKey(day)]
      return next
    })
  }

  return (
    <article className="ip-hud-root">
      <div className="ip-hud-corner ip-hud-corner--tl" />
      <div className="ip-hud-corner ip-hud-corner--tr" />
      <div className="ip-hud-corner ip-hud-corner--bl" />
      <div className="ip-hud-corner ip-hud-corner--br" />

      <header className="ip-hud-topbar">
        <div className="ip-hud-identity">
          <div className="ip-hud-identity-layout">
            <div className="ip-hud-avatar-wrap">
              <div className="ip-hud-avatar-ring">
                <div
                  className={[
                    'ip-hud-avatar-ring-inner',
                    avatarPhotoLoaded && profileImage && !avatarPhotoFailed ? 'ip-hud-avatar-ring-inner--photo' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {profileImage && !avatarPhotoFailed ? (
                    <img
                      className="ip-hud-avatar-photo"
                      src={profileImage}
                      alt={influencerName ? `${influencerName} profile` : 'Influencer profile'}
                      onLoad={() => setAvatarPhotoLoaded(true)}
                      onError={() => setAvatarPhotoFailed(true)}
                    />
                  ) : null}
                  <span className="ip-hud-avatar-fallback" aria-hidden="true">
                    {influencerInitials(influencerName)}
                  </span>
                </div>
              </div>
            </div>
            <div className="ip-hud-identity-copy">
              <div className="ip-hud-label">// contract monitor · {contractStatus(contract).toLowerCase()}</div>
              <div className="ip-hud-name-row">
                <h3 className="ip-hud-name">{influencerName}</h3>
                {onEditContract ? (
                  <button type="button" className="ip-hud-contract-edit" onClick={() => onEditContract(contract)} aria-label="Edit contract influencer">
                    <Pencil size={15} />
                  </button>
                ) : null}
              </div>
              <div className="ip-hud-followers-anchor">
                <div className="ip-hud-followers">
                  <span /> {formatNumber(influencer?.followers)} followers
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="ip-hud-header-totals" aria-label="Total performance summary">
          {[
            ['views', 'Total Views', totals.views, Eye],
            ['storyViews', 'Total Story Views', totals.storyViews, GalleryHorizontal],
            ['likes', 'Total Likes', totals.likes, Heart],
            ['shares', 'Total Shares', totals.shares, Send],
            ['comments', 'Total Comments', totals.comments, MessageCircle],
          ].map(([key, label, value, Icon]) => (
            <div key={key} className={`ip-hud-header-total ip-hud-header-total--${key}`}>
              <span>
                <Icon size={16} />
                <span className="ip-hud-header-total__label">{label}</span>
              </span>
              <strong>{formatNumber(value)}</strong>
            </div>
          ))}
        </div>
        <div className="ip-hud-meta">
          <div className="ip-hud-platform"><span className="ip-hud-platform-dot" />{contract.platform}</div>
          <span className="ip-hud-eng">Eng. {toNumber(contract.averageEngagementRate).toFixed(2)}%</span>
          <span className="ip-hud-monitor">{contract.recordedDays}/{contract.monitoringDays} days</span>
        </div>
      </header>

      <div className="ip-hud-days">
        {days.length === 0 ? (
          <div className="ip-empty-row">No daily timeline records are available for this contract.</div>
        ) : days.map((day) => (
          <section key={day.dayNumber} className={`ip-hud-day ${day.isRecorded ? 'ip-hud-day--active' : ''}`}>
            <div className="ip-hud-day-head">
              <div className="ip-hud-day-head-main">
                <StepBadge number={day?.dayNumber} className={day?.isRecorded ? 'ip-step-badge--active' : ''} />
                <div className="ip-hud-day-head-copy">
                  <span className="ip-hud-day-date">{displayDate(day?.date)}</span>
                </div>
              </div>
              <div className="ip-hud-day-actions">
                {onEditRecord ? (
                  <button
                    type="button"
                    onClick={() => onEditRecord(day?.record || makeDraftRecord(day))}
                    aria-label={`${day?.isRecorded ? 'Edit' : 'Add'} day ${day?.dayNumber || ''}`}
                    title={`${day?.isRecorded ? 'Edit' : 'Add'} full check-in`}
                  >
                    <Pencil size={12} />
                  </button>
                ) : null}
                {onSaveRecord ? (
                  <button
                    type="button"
                    className="ip-hud-day-save"
                    disabled={!hasDraft(day)}
                    onClick={() => saveDay(day)}
                    aria-label={`Save day ${day?.dayNumber || ''}`}
                    title={hasDraft(day) ? 'Save inline changes' : 'No changes to save'}
                  >
                    <Check size={12} />
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
                    value={inlineMetricDisplayValue(day, key)}
                    placeholder="-"
                    aria-label={`${label} for ${displayDate(day?.date)}`}
                    onFocus={(event) => {
                      setFocusedMetricCell(metricCellFocusId(day, key))
                      event.currentTarget.select()
                    }}
                    onBlur={(event) => {
                      const v = event.currentTarget.value.trim()
                      if (v === '') {
                        updateDraft(day, key, '')
                      } else {
                        const n = parseMetricInput(v)
                        updateDraft(day, key, Number.isFinite(n) ? String(n) : v)
                      }
                      setFocusedMetricCell((current) => (
                        current === metricCellFocusId(day, key) ? null : current
                      ))
                    }}
                    onChange={(event) => updateDraft(day, key, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveDay(day)
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

import { useEffect, useState } from 'react'
import {
  Check,
  Download,
  ExternalLink,
  Eye,
  GalleryHorizontal,
  Heart,
  MessageCircle,
  Pencil,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import {
  formatNumber,
  isStoryPosting,
  parseMetricInput,
  storyPostingLabel,
  toNumber,
} from '../../utils/influencerPerformanceUtils'
import type {
  InfluencerContract,
  InfluencerContractDay,
  InfluencerPerformanceInput,
} from '../../types/influencer'
import { influencerInitials } from './influencerPerformanceTableShared'
import { StepBadge } from './StepBadge'

type TimelineMetricKey = 'views' | 'shares' | 'likes' | 'comments'
type StoryPostingChoice = '' | 'yes' | 'no'

interface InfluencerContractTimelineProps {
  contracts: InfluencerContract[]
  onEditRecord?: (record: InfluencerPerformanceInput) => void
  onDeleteRecord?: (recordId: string | number) => void
  onEditContract?: (contract: InfluencerContract) => void
  onSaveRecord?: (record: InfluencerPerformanceInput) => void
}

interface MetricConfigItem {
  label: string
  key: TimelineMetricKey
  Icon: LucideIcon
}

type DayDraft = Partial<Record<TimelineMetricKey, string | number>> & {
  storyPosting?: StoryPostingChoice
}
type DraftsState = Record<string, DayDraft>

const timelineDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
})

export function InfluencerContractTimeline({
  contracts,
  onEditRecord,
  onDeleteRecord,
  onEditContract,
  onSaveRecord,
}: InfluencerContractTimelineProps) {
  const visibleContract = contracts[0]

  return (
    <section className="ip-contract-panel" aria-label="Video contract monitoring">
      <div className="ip-section-heading ip-hud-section-heading">
        <div>
          <h2>Video Contract Monitoring</h2>
        </div>
        {contracts.length === 1 && visibleContract ? (
          <span className="ip-hud-heading-status">
            <span aria-hidden="true" />
            {visibleContract.platform || 'Platform'} · {visibleContract.recordedDays}/{visibleContract.monitoringDays} days
          </span>
        ) : null}
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

function displayDate(date?: string | null) {
  const iso = String(date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—'
  const [year, month, day] = iso.split('-').map(Number)
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(utcDate.getTime())) return '—'
  return timelineDateFormatter.format(utcDate)
}

function metricTotal(contract: InfluencerContract, key: TimelineMetricKey) {
  const days = Array.isArray(contract?.days) ? contract.days : []
  const fromDays = days.reduce((sum, day) => sum + toNumber(day?.record?.[key]), 0)
  const anyDayRecorded = days.some((day) => day?.isRecorded)
  if (anyDayRecorded) return fromDays
  return toNumber(contract?.totals?.[key])
}

function HudContractCard({
  contract,
  onEditRecord,
  onDeleteRecord,
  onEditContract,
  onSaveRecord,
}: Omit<InfluencerContractTimelineProps, 'contracts'> & { contract: InfluencerContract }) {
  const influencer = contract.influencer
  const influencerName = influencer?.name || 'Influencer'
  const profileImage = influencer?.profileImage || ''
  const days = Array.isArray(contract?.days) ? contract.days : []
  const [avatarPhotoLoaded, setAvatarPhotoLoaded] = useState(false)
  const [avatarPhotoFailed, setAvatarPhotoFailed] = useState(false)
  const [drafts, setDrafts] = useState<DraftsState>({})

  useEffect(() => {
    setAvatarPhotoLoaded(false)
    setAvatarPhotoFailed(false)
  }, [profileImage])

  const [focusedMetricCell, setFocusedMetricCell] = useState<string | null>(null)
  const metricConfig: MetricConfigItem[] = [
    { label: 'Views', key: 'views', Icon: Eye },
    { label: 'Shares', key: 'shares', Icon: Send },
    { label: 'Likes', key: 'likes', Icon: Heart },
    { label: 'Comments', key: 'comments', Icon: MessageCircle },
  ]

  const totals: Record<TimelineMetricKey, number> = {
    views: metricTotal(contract, 'views'),
    likes: metricTotal(contract, 'likes'),
    shares: metricTotal(contract, 'shares'),
    comments: metricTotal(contract, 'comments'),
  }

  function getStoryDraft(day: InfluencerContractDay): StoryPostingChoice {
    const id = draftKey(day)
    const draft = drafts[id]?.storyPosting
    if (draft === 'yes' || draft === 'no') return draft
    if (!day?.isRecorded) return ''
    return isStoryPosting(day?.record?.storyViews) ? 'yes' : 'no'
  }

  function updateStoryDraft(day: InfluencerContractDay, value: StoryPostingChoice) {
    setDrafts((current) => ({
      ...current,
      [draftKey(day)]: {
        ...current[draftKey(day)],
        storyPosting: value,
      },
    }))
  }

  function dayStoryPosted(day: InfluencerContractDay) {
    const draft = getStoryDraft(day)
    if (draft === 'yes') return true
    if (draft === 'no') return false
    return Boolean(day?.isRecorded && isStoryPosting(day?.record?.storyViews))
  }

  function contractStoryPostingSummary(): 'Yes' | 'No' {
    return days.some((day) => dayStoryPosted(day)) ? 'Yes' : 'No'
  }

  function makeDraftRecord(day: InfluencerContractDay): InfluencerPerformanceInput {
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

  function draftKey(day: InfluencerContractDay) {
    return String(day?.record?.id || `${contract.id}:${day?.date || day?.dayNumber || ''}`)
  }

  function getDraft(day: InfluencerContractDay, key: TimelineMetricKey) {
    const id = draftKey(day)
    if (drafts[id]?.[key] != null) return drafts[id][key]
    return day?.isRecorded ? toNumber(day?.record?.[key]) : ''
  }

  function updateDraft(day: InfluencerContractDay, key: TimelineMetricKey, value: string | number) {
    setDrafts((current) => ({
      ...current,
      [draftKey(day)]: {
        ...current[draftKey(day)],
        [key]: value,
      },
    }))
  }

  function hasDraft(day: InfluencerContractDay) {
    const values = drafts[draftKey(day)]
    if (!values) return false
    if (values.storyPosting === 'yes' || values.storyPosting === 'no') {
      const saved: StoryPostingChoice = day?.isRecorded
        ? (isStoryPosting(day?.record?.storyViews) ? 'yes' : 'no')
        : ''
      if (values.storyPosting !== saved) return true
    }
    return metricConfig.some(({ key }) => {
      if (values[key] == null) return false
      return parseMetricInput(values[key]) !== toNumber(day?.record?.[key])
    })
  }

  function metricCellFocusId(day: InfluencerContractDay, key: TimelineMetricKey) {
    return `${draftKey(day)}:${key}`
  }

  function metricProgress(day: InfluencerContractDay, key: TimelineMetricKey) {
    if (!day?.isRecorded || totals[key] <= 0) return 0
    return Math.min(100, Math.max(0, (toNumber(day?.record?.[key]) / totals[key]) * 100))
  }

  function inlineMetricDisplayValue(day: InfluencerContractDay, key: TimelineMetricKey) {
    const raw = getDraft(day, key)
    if (raw === '' || raw == null) return ''
    if (focusedMetricCell === metricCellFocusId(day, key)) return String(raw)
    return formatNumber(parseMetricInput(raw))
  }

  function saveDay(day: InfluencerContractDay) {
    if (!onSaveRecord || !day?.date || day.inContractWindow === false) return
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

    const storyDraft = values.storyPosting
    const storyViews = storyDraft === 'yes'
      ? 1
      : storyDraft === 'no'
        ? 0
        : toNumber(base.storyViews) > 0
          ? 1
          : 0

    onSaveRecord({
      ...base,
      views: values.views == null ? toNumber(base.views) : parseMetricInput(values.views),
      storyViews,
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
              <div className="ip-hud-label">Contract monitor</div>
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
            { key: 'views', label: 'Total Views', value: formatNumber(totals.views), Icon: Eye },
            { key: 'likes', label: 'Total Likes', value: formatNumber(totals.likes), Icon: Heart },
            { key: 'shares', label: 'Total Shares', value: formatNumber(totals.shares), Icon: Send },
            { key: 'comments', label: 'Total Comments', value: formatNumber(totals.comments), Icon: MessageCircle },
          ].map(({ key, label, value, Icon }) => (
            <div key={key} className={`ip-hud-header-total ip-hud-header-total--${key}`}>
              <span>
                <Icon size={16} />
                <span className="ip-hud-header-total__label">{label}</span>
              </span>
              <strong>{value}</strong>
            </div>
          ))}
          <div className="ip-hud-header-total ip-hud-header-total--storyViews">
            <span>
              <GalleryHorizontal size={16} />
              <span className="ip-hud-header-total__label">Story posting</span>
            </span>
            <strong>{contractStoryPostingSummary()}</strong>
          </div>
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
        ) : days.map((day) => {
          const inWindow = day.inContractWindow !== false
          return (
          <section
            key={day.dayNumber}
            className={[
              'ip-hud-day',
              day.isRecorded && inWindow ? 'ip-hud-day--active' : '',
              !inWindow ? 'ip-hud-day--outside-window' : '',
            ].filter(Boolean).join(' ')}
          >
            <div className="ip-hud-day-head">
              <div className="ip-hud-day-head-main">
                <StepBadge number={day?.dayNumber} className={day?.isRecorded ? 'ip-step-badge--active' : ''} />
                <div className="ip-hud-day-head-copy">
                  <span className="ip-hud-day-date">{displayDate(day?.date)}</span>
                </div>
              </div>
              <div className="ip-hud-day-actions">
                {onEditRecord && inWindow ? (
                  <button
                    type="button"
                    onClick={() => onEditRecord(day?.record || makeDraftRecord(day))}
                    aria-label={`${day?.isRecorded ? 'Edit' : 'Add'} day ${day?.dayNumber || ''}`}
                    title={`${day?.isRecorded ? 'Edit' : 'Add'} full check-in`}
                  >
                    <Pencil size={12} />
                  </button>
                ) : null}
                {onSaveRecord && inWindow ? (
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
                {onDeleteRecord && inWindow ? (
                  <button
                    type="button"
                    disabled={!day?.isRecorded || !day?.record?.id}
                    onClick={() => {
                      if (day?.isRecorded && day?.record?.id) onDeleteRecord(day.record.id)
                    }}
                    aria-label={`Delete day ${day?.dayNumber || ''}`}
                    title={day?.isRecorded ? 'Delete this day' : 'No saved record to delete'}
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            </div>
            {metricConfig.map(({ label, key, Icon }) => (
              <div key={key} className="ip-hud-metric-row">
                <span><Icon size={18} /> {label}</span>
                {!inWindow ? (
                  <strong className={`ip-hud-value ip-hud-value--muted ip-hud-value--${key}`}>—</strong>
                ) : onSaveRecord ? (
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
                <div className="ip-hud-metric-progress" aria-hidden="true">
                  <i style={{ width: `${metricProgress(day, key)}%` }} />
                </div>
              </div>
            ))}
            <div className="ip-hud-metric-row">
              <span><GalleryHorizontal size={18} /> Story</span>
              {!inWindow ? (
                <strong className="ip-hud-value ip-hud-value--muted ip-hud-value--storyViews">—</strong>
              ) : onSaveRecord ? (
                <select
                  className="ip-hud-value ip-hud-value-select ip-hud-value--storyViews"
                  value={getStoryDraft(day)}
                  aria-label={`Story posting for ${displayDate(day?.date)}`}
                  onChange={(event) => updateStoryDraft(day, event.currentTarget.value as StoryPostingChoice)}
                >
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <strong className="ip-hud-value ip-hud-value--storyViews">
                  {day?.isRecorded ? storyPostingLabel(day?.record?.storyViews) : '-'}
                </strong>
              )}
            </div>
          </section>
          )
        })}
        <section className="ip-hud-day ip-hud-day--total" aria-label="Total performance">
          <div className="ip-hud-day-head">
            <span className="ip-hud-total-badge" aria-hidden="true">Σ</span>
            <div className="ip-hud-day-total-title">Total</div>
          </div>
          {metricConfig.map(({ label, key, Icon }) => (
            <div key={key} className="ip-hud-metric-row">
              <span><Icon size={18} /> {label}</span>
              <strong className={`ip-hud-value ip-hud-value--${key}`}>
                {formatNumber(totals[key])}
              </strong>
              <div className="ip-hud-metric-progress" aria-hidden="true">
                <i style={{ width: '100%' }} />
              </div>
            </div>
          ))}
          <div className="ip-hud-metric-row">
            <span><GalleryHorizontal size={18} /> Story</span>
            <strong className="ip-hud-value ip-hud-value--storyViews">
              {contractStoryPostingSummary()}
            </strong>
          </div>
        </section>
      </div>

      <footer className="ip-hud-bottom">
        <div className="ip-hud-posted">
          <span className="ip-hud-ig-logo" aria-hidden="true" />
          <div className="ip-hud-posted-platform">Posted on {contract.platform || 'platform'}</div>
        </div>
        <div className="ip-hud-footer-actions">
          <button type="button" className="ip-hud-export-button" onClick={() => window.print()}>
            <Download size={15} /> Export Report
          </button>
          {contract.postUrl ? (
            <a className="ip-hud-open-link" href={contract.postUrl} target="_blank" rel="noopener noreferrer">
              Open Video <ExternalLink size={16} />
            </a>
          ) : null}
        </div>
      </footer>
    </article>
  )
}

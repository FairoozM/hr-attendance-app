import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownWideNarrow, Download, Gauge, Plus, Save, Search, X } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth, canMutateInfluencerPerformance } from '../../contexts/AuthContext'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { InfluencerCharts } from '../../components/influencers/InfluencerCharts'
import { InfluencerContractTimeline } from '../../components/influencers/InfluencerContractTimeline'
import { InfluencerPerformanceForm } from '../../components/influencers/InfluencerPerformanceForm'
import { InfluencerPerformanceTable } from '../../components/influencers/InfluencerPerformanceTable'
import {
  createInfluencerFromAppRecord,
  createMockPerformanceRecords,
  dedupePerformanceRecords,
  formatNumber,
  getDayNumber,
  getVideoContractTimelines,
  mockInfluencers,
  normalizePerformanceRecord,
  toNumber,
} from '../../utils/influencerPerformanceUtils'
import './influencers.css'
import './InfluencerPerformancePage.css'

const STORAGE_KEY = 'hr-influencer-performance-v1'

const PERFORMANCE_SORT_OPTIONS = [
  { value: 'date:desc', label: 'Newest records first' },
  { value: 'date:asc', label: 'Oldest records first' },
  { value: 'views:desc', label: 'Top views first' },
  { value: 'views:asc', label: 'Lowest views first' },
  { value: 'likes:desc', label: 'Top likes first' },
  { value: 'comments:desc', label: 'Top comments first' },
  { value: 'shares:desc', label: 'Top shares first' },
  { value: 'engagementRate:desc', label: 'Top engagement first' },
  { value: 'cost:desc', label: 'Highest cost first' },
  { value: 'cost:asc', label: 'Lowest cost first' },
  { value: 'influencer:asc', label: 'Influencer A-Z' },
]

function loadStoredRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return dedupePerformanceRecords(parsed.map(normalizePerformanceRecord))
  } catch {
    return null
  }
}

function saveRecords(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // Local mock storage is best effort; backend integration can replace this.
  }
}

function isSeededMockPerformanceRecord(record = {}) {
  return (
    /^perf-.+-[0-4]$/.test(String(record.id || '')) &&
    String(record.contractId || '').startsWith('contract-') &&
    String(record.postUrl || '').startsWith('https://example.com/') &&
    String(record.postUrl || '').includes('/weekly-video') &&
    String(record.videoTitle || '').toLowerCase().endsWith(' weekly video')
  )
}

function makeRecordId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function compareValues(a, b, direction) {
  if (typeof a === 'number' || typeof b === 'number') {
    return direction === 'asc' ? toNumber(a) - toNumber(b) : toNumber(b) - toNumber(a)
  }
  return direction === 'asc'
    ? String(a || '').localeCompare(String(b || ''))
    : String(b || '').localeCompare(String(a || ''))
}

function mergePerformanceRecordIntoList(list, record) {
  const normalized = normalizePerformanceRecord(record)
  const sameDayIndex = list.findIndex((item) => (
    item.id === normalized.id ||
    (
      item.contractId === normalized.contractId &&
      item.date === normalized.date
    )
  ))
  if (sameDayIndex >= 0) {
    return list.map((item, index) => (
      index === sameDayIndex ? { ...normalized, id: item.id || normalized.id || makeRecordId() } : item
    ))
  }
  if (normalized.id) {
    return list.map((item) => (item.id === normalized.id ? normalized : item))
  }
  return [{ ...normalized, id: makeRecordId() }, ...list]
}

export function InfluencerPerformancePage() {
  const { user, loading: authLoading } = useAuth()
  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  const { influencers: appInfluencers = [], loading: influencersLoading } = useInfluencers()
  const [records, setRecords] = useState(null)
  const [serverMergedOnce, setServerMergedOnce] = useState(false)
  const [syncHint, setSyncHint] = useState('')
  const [sort, setSort] = useState({ key: 'date', direction: 'desc' })
  const [editingRecord, setEditingRecord] = useState(null)
  const [editingContract, setEditingContract] = useState(null)
  const [viewRecord, setViewRecord] = useState(null)
  const [isAddRecordOpen, setIsAddRecordOpen] = useState(false)
  const [activeMonitorInfluencerId, setActiveMonitorInfluencerId] = useState(null)
  const canWritePerformance = canMutateInfluencerPerformance(user)

  const influencers = useMemo(() => {
    if (appInfluencers.length > 0) {
      return appInfluencers.map(createInfluencerFromAppRecord)
    }
    if (influencersLoading) return []
    return mockInfluencers
  }, [appInfluencers, influencersLoading])

  const influencersById = useMemo(
    () => new Map(influencers.map((influencer) => [String(influencer.id), influencer])),
    [influencers],
  )

  const persistRecordsIfCan = useCallback(async (nextList) => {
    const u = userRef.current
    const list = dedupePerformanceRecords(nextList || [])
    if (!canMutateInfluencerPerformance(u)) {
      setSyncHint('This account cannot save Influencer Performance to the server. Ask an admin to enable Influencer Performance access.')
      return
    }
    try {
      const result = await api.post('/api/influencers/performance-records/bulk-upsert', { records: list })
      saveRecords(list)
      setSyncHint(result?.skipped ? `${result.skipped} record(s) were not saved because the influencer no longer exists on the server.` : '')
    } catch (err) {
      console.warn('[InfluencerPerformance] server save failed', err)
      saveRecords(list)
      setSyncHint(err.message || 'Could not save to server (kept a copy in this browser).')
    }
  }, [])

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    ;(async () => {
      setSyncHint('')
      try {
        const data = await api.get('/api/influencers/performance-records')
        const server = Array.isArray(data?.records)
          ? data.records.map((r) => normalizePerformanceRecord(r))
          : []
        const localRaw = loadStoredRecords() || []
        const local = localRaw
          .map((r) => normalizePerformanceRecord(r))
          .filter((record) => !isSeededMockPerformanceRecord(record))
        const merged = dedupePerformanceRecords([...server, ...local])
        if (cancelled) return
        setServerMergedOnce(true)
        if (merged.length > 0) {
          setRecords(merged)
          if (canMutateInfluencerPerformance(user) && merged.length > server.length) {
            const result = await api.post('/api/influencers/performance-records/bulk-upsert', { records: merged })
            if (result?.skipped) {
              setSyncHint(`${result.skipped} record(s) were not saved because the influencer no longer exists on the server.`)
            }
            const again = await api.get('/api/influencers/performance-records')
            if (!cancelled && Array.isArray(again?.records)) {
              const next = dedupePerformanceRecords(again.records.map((r) => normalizePerformanceRecord(r)))
              setRecords(next)
              saveRecords(next)
            }
          } else {
            saveRecords(merged)
          }
        } else {
          setRecords([])
        }
      } catch (err) {
        console.warn('[InfluencerPerformance] server load failed', err)
        if (!cancelled) {
          const local = loadStoredRecords()
          setRecords(local?.length ? local.map((r) => normalizePerformanceRecord(r)) : [])
          setSyncHint('Could not load server data; showing offline copy if available.')
          setServerMergedOnce(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, user])

  useEffect(() => {
    if (!serverMergedOnce || records === null || influencers.length === 0 || influencersLoading) return
    if (records.length > 0) return
    if (!import.meta.env.DEV) return
    setRecords(createMockPerformanceRecords(influencers))
  }, [serverMergedOnce, records, influencers, influencersLoading])

  useEffect(() => {
    if (records) saveRecords(records)
  }, [records])

  const allRecords = useMemo(() => (
    dedupePerformanceRecords(records || []).filter((record) => influencersById.has(String(record.influencerId)))
  ), [influencersById, records])

  useEffect(() => {
    if (!records || influencers.length === 0 || influencersLoading) return
    const cleaned = dedupePerformanceRecords(records).filter((record) => influencersById.has(String(record.influencerId)))
    if (cleaned.length !== records.length) {
      setRecords(cleaned)
      void persistRecordsIfCan(cleaned)
      if (activeMonitorInfluencerId && !influencersById.has(String(activeMonitorInfluencerId))) {
        setActiveMonitorInfluencerId(null)
      }
    }
  }, [activeMonitorInfluencerId, influencers.length, influencersById, influencersLoading, records, persistRecordsIfCan])

  const filteredRecords = useMemo(() => {
    return [...allRecords].sort((a, b) => {
      const influencerA = influencersById.get(String(a.influencerId))
      const influencerB = influencersById.get(String(b.influencerId))
      const valueA =
        sort.key === 'influencer' ? influencerA?.name :
          sort.key === 'dayNumber' ? getDayNumber(a.contractStartDate, a.date) :
            a[sort.key]
      const valueB =
        sort.key === 'influencer' ? influencerB?.name :
          sort.key === 'dayNumber' ? getDayNumber(b.contractStartDate, b.date) :
            b[sort.key]
      return compareValues(valueA, valueB, sort.direction)
    })
  }, [allRecords, influencersById, sort])

  const videoContracts = useMemo(
    () => getVideoContractTimelines(filteredRecords, influencers),
    [filteredRecords, influencers],
  )

  const activeMonitorContracts = useMemo(() => {
    if (!activeMonitorInfluencerId) return []
    return videoContracts.filter((contract) => String(contract.influencerId) === String(activeMonitorInfluencerId))
  }, [activeMonitorInfluencerId, videoContracts])

  function handleSort(key) {
    setSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }))
  }

  function handleSortPreset(value) {
    const [key, direction] = String(value || 'date:desc').split(':')
    setSort({ key, direction: direction === 'asc' ? 'asc' : 'desc' })
  }

  function handleSubmit(record) {
    setRecords((prev) => {
      const list = prev || []
      const next = mergePerformanceRecordIntoList(list, record)
      void persistRecordsIfCan(next)
      return next
    })
    setEditingRecord(null)
    setIsAddRecordOpen(false)
  }

  function handleDelete(id) {
    const record = allRecords.find((item) => item.id === id)
    const name = influencersById.get(String(record?.influencerId))?.name || 'this record'
    if (!window.confirm(`Delete performance record for ${name}?`)) return
    const prev = records || []
    const next = prev.filter((item) => item.id !== id)
    setRecords(next)
    saveRecords(next)
    if (viewRecord?.id === id) setViewRecord(null)
    if (editingRecord?.id === id) setEditingRecord(null)
    if (canMutateInfluencerPerformance(userRef.current)) {
      void api.delete(`/api/influencers/performance-records/${encodeURIComponent(id)}`).catch((err) => {
        console.warn('[InfluencerPerformance] server delete failed', err)
        setSyncHint(err.message || 'Deleted locally; server delete failed — refresh to reconcile.')
      })
    }
  }

  function handleSaveContractEdit() {
    if (!editingContract?.selectedInfluencerId) return
    const selectedInfluencer = influencersById.get(String(editingContract.selectedInfluencerId))
    if (!selectedInfluencer) return
    const contractRecordIds = new Set((editingContract.contract.records || []).map((r) => r.id))
    const prev = records || []
    const next = prev.map((record) => (
      contractRecordIds.has(record.id)
        ? {
            ...record,
            influencerId: selectedInfluencer.id,
            platform: selectedInfluencer.platform,
            campaignName: record.campaignName || selectedInfluencer.assignedCampaign,
            updatedAt: new Date().toISOString(),
          }
        : record
    ))
    setRecords(next)
    void persistRecordsIfCan(next)
    setActiveMonitorInfluencerId(selectedInfluencer.id)
    setEditingContract(null)
  }

  return (
    <div className="inf-page ip-page">
      <header className="inf-page-header ip-hero">
        <div>
          <span className="ip-eyebrow"><Gauge size={15} /> Marketing / Social Media</span>
          <h1 className="inf-page-title">Influencer Performance</h1>
          <p className="inf-page-subtitle">Track one contracted video per influencer across 4-5 consecutive daily performance checks.</p>
          {syncHint ? (
            <p className="inf-page-subtitle ip-sync-hint" role="status">{syncHint}</p>
          ) : null}
          {!authLoading && user && !canMutateInfluencerPerformance(user) ? (
            <p className="inf-page-subtitle ip-sync-hint ip-sync-hint--muted" role="note">
              View-only: data loads from the server. Ask an admin to enable Influencer Performance access before adding stats.
            </p>
          ) : null}
        </div>
        <div className="inf-page-actions">
          <button
            type="button"
            className="inf-btn inf-btn--primary"
            onClick={() => {
              if (!canWritePerformance) {
                setSyncHint('This account cannot save Influencer Performance to the server. Ask an admin to enable Influencer Performance access.')
                return
              }
              setIsAddRecordOpen(true)
            }}
            disabled={!canWritePerformance}
            title={!canWritePerformance ? 'Requires Influencer Performance access' : undefined}
          >
            <Plus size={15} /> Add new record
          </button>
        </div>
      </header>

      <section className="ip-filter-panel ip-performance-sort-panel" aria-label="Influencer performance filters">
        <div className="ip-section-heading">
          <span className="ip-section-heading__icon"><ArrowDownWideNarrow size={18} /></span>
          <div>
            <h2>Sort influencers</h2>
            <p>Rank grouped influencer rows by top-to-low metrics like views, likes, engagement, cost, or newest records.</p>
          </div>
        </div>
        <div className="ip-performance-sort-panel__body">
          <label className="ip-field ip-performance-sort-panel__select">
            <span>Ranking</span>
            <select
              className="ip-control"
              value={`${sort.key}:${sort.direction}`}
              onChange={(event) => handleSortPreset(event.target.value)}
            >
              {PERFORMANCE_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="ip-performance-sort-panel__quick" aria-label="Quick ranking filters">
            {[
              ['views:desc', 'Top views'],
              ['likes:desc', 'Top likes'],
              ['engagementRate:desc', 'Top engagement'],
              ['date:desc', 'Newest'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`inf-btn inf-btn--ghost inf-btn--xs ${`${sort.key}:${sort.direction}` === value ? 'ip-performance-sort-panel__quick-active' : ''}`}
                onClick={() => handleSortPreset(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <InfluencerPerformanceTable
        records={filteredRecords}
        influencersById={influencersById}
        sort={sort}
        onSort={handleSort}
        onView={setViewRecord}
        onEdit={canWritePerformance ? setEditingRecord : undefined}
        onDelete={canWritePerformance ? handleDelete : undefined}
        activeMonitorInfluencerId={activeMonitorInfluencerId}
        onToggleMonitor={(influencerId) => setActiveMonitorInfluencerId((current) => (
          String(current) === String(influencerId) ? null : influencerId
        ))}
      />

      {activeMonitorContracts.length > 0 ? (
        <InfluencerContractTimeline
          contracts={activeMonitorContracts}
          onEditRecord={canWritePerformance ? setEditingRecord : undefined}
          onDeleteRecord={canWritePerformance ? handleDelete : undefined}
          onEditContract={canWritePerformance
            ? (contract) => setEditingContract({
                contract,
                selectedInfluencerId: contract.influencerId,
                query: contract.influencer?.name || '',
              })
            : undefined}
        />
      ) : null}

      <InfluencerCharts records={filteredRecords} influencersById={influencersById} />

      {isAddRecordOpen ? (
        <div className="ip-modal-backdrop" role="presentation" onClick={() => setIsAddRecordOpen(false)}>
          <section className="ip-modal ip-add-record-modal" role="dialog" aria-modal="true" aria-label="Add performance record" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="ip-modal__close" onClick={() => setIsAddRecordOpen(false)} aria-label="Close add record">
              <X size={18} />
            </button>
            <InfluencerPerformanceForm
              influencers={influencers}
              editingRecord={null}
              onSubmit={handleSubmit}
              onCancelEdit={() => setIsAddRecordOpen(false)}
            />
          </section>
        </div>
      ) : null}

      {viewRecord ? (
        <div className="ip-modal-backdrop" role="presentation" onClick={() => setViewRecord(null)}>
          <section className="ip-modal" role="dialog" aria-modal="true" aria-label="Performance details" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="ip-modal__close" onClick={() => setViewRecord(null)} aria-label="Close performance details">
              <X size={18} />
            </button>
            <div className="ip-section-heading">
              <span className="ip-section-heading__icon"><Download size={18} /></span>
              <div>
                <h2>{influencersById.get(String(viewRecord.influencerId))?.name || 'Influencer'} performance</h2>
                <p>{viewRecord.date} · {viewRecord.platform} · {viewRecord.campaignName}</p>
              </div>
            </div>
            <div className="ip-detail-grid">
              {[
                ['Views', formatNumber(viewRecord.views)],
                ['Likes', formatNumber(viewRecord.likes)],
                ['Comments', formatNumber(viewRecord.comments)],
                ['Shares', formatNumber(viewRecord.shares)],
                ['Saves', formatNumber(viewRecord.saves)],
                ['Sales AED', formatNumber(viewRecord.salesAed, { currency: 'AED' })],
                ['Story views', formatNumber(viewRecord.storyViews)],
                ['Engagement rate', `${toNumber(viewRecord.engagementRate).toFixed(2)}%`],
                ['Cost', formatNumber(viewRecord.cost, { currency: 'AED' })],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {viewRecord.postUrl ? <a className="ip-modal__link" href={viewRecord.postUrl} target="_blank" rel="noopener noreferrer">Open post link</a> : null}
            {viewRecord.notes ? <p className="ip-modal__notes">{viewRecord.notes}</p> : null}
            {viewRecord.screenshotUrl ? <p className="ip-modal__notes">Screenshot: {viewRecord.screenshotUrl}</p> : null}
          </section>
        </div>
      ) : null}

      {editingRecord ? (
        <div className="ip-modal-backdrop" role="presentation" onClick={() => setEditingRecord(null)}>
          <section className="ip-modal ip-edit-modal" role="dialog" aria-modal="true" aria-label="Edit performance record" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="ip-modal__close" onClick={() => setEditingRecord(null)} aria-label="Close edit record">
              <X size={18} />
            </button>
            <InfluencerPerformanceForm
              influencers={influencers}
              editingRecord={editingRecord}
              onSubmit={handleSubmit}
              onCancelEdit={() => setEditingRecord(null)}
            />
          </section>
        </div>
      ) : null}

      {editingContract ? (
        <div className="ip-modal-backdrop" role="presentation" onClick={() => setEditingContract(null)}>
          <section className="ip-modal ip-contract-edit-modal" role="dialog" aria-modal="true" aria-label="Edit contract influencer" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="ip-modal__close" onClick={() => setEditingContract(null)} aria-label="Close contract edit">
              <X size={18} />
            </button>
            <div className="ip-section-heading">
              <span className="ip-section-heading__icon"><Search size={18} /></span>
              <div>
                <h2>Edit contract influencer</h2>
                <p>Search the influencer list. Followers are fetched automatically from the selected profile.</p>
              </div>
            </div>

            <label className="ip-field">
              <span>Search influencer</span>
              <input
                className="ip-control"
                value={editingContract.query}
                onChange={(event) => setEditingContract((prev) => ({ ...prev, query: event.target.value }))}
                placeholder="Type influencer name, handle, or platform"
              />
            </label>

            <div className="ip-influencer-picker">
              {influencers
                .filter((influencer) => {
                  const q = editingContract.query.trim().toLowerCase()
                  if (!q) return true
                  return `${influencer.name} ${influencer.username} ${influencer.platform}`.toLowerCase().includes(q)
                })
                .slice(0, 12)
                .map((influencer) => (
                  <button
                    key={influencer.id}
                    type="button"
                    className={`ip-influencer-picker__item ${String(editingContract.selectedInfluencerId) === String(influencer.id) ? 'ip-influencer-picker__item--active' : ''}`}
                    onClick={() => setEditingContract((prev) => ({ ...prev, selectedInfluencerId: influencer.id, query: influencer.name }))}
                  >
                    <span>
                      <strong>{influencer.name}</strong>
                      <em>{influencer.username} · {influencer.platform}</em>
                    </span>
                    <b>{formatNumber(influencer.followers)} followers</b>
                  </button>
                ))}
            </div>

            {influencersById.get(String(editingContract.selectedInfluencerId)) ? (
              <div className="ip-selected-influencer">
                <span>Selected</span>
                <strong>{influencersById.get(String(editingContract.selectedInfluencerId)).name}</strong>
                <em>{formatNumber(influencersById.get(String(editingContract.selectedInfluencerId)).followers)} followers will show in the monitor.</em>
              </div>
            ) : null}

            <div className="ip-form__footer">
              <div className="ip-form__hint">This updates all saved days for this video contract.</div>
              <div className="ip-form__actions">
                <button type="button" className="inf-btn inf-btn--ghost" onClick={() => setEditingContract(null)}>
                  <X size={15} /> Cancel
                </button>
                <button type="button" className="inf-btn inf-btn--primary" onClick={handleSaveContractEdit}>
                  <Save size={15} /> Save influencer
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

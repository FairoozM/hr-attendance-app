import { useEffect, useMemo, useState } from 'react'
import { Download, Filter, Gauge, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { InfluencerCard } from '../../components/influencers/InfluencerCard'
import { InfluencerCharts } from '../../components/influencers/InfluencerCharts'
import { InfluencerDashboardCards } from '../../components/influencers/InfluencerDashboardCards'
import { InfluencerPerformanceForm } from '../../components/influencers/InfluencerPerformanceForm'
import { InfluencerPerformanceTable } from '../../components/influencers/InfluencerPerformanceTable'
import {
  createInfluencerFromAppRecord,
  createMockPerformanceRecords,
  formatNumber,
  INFLUENCER_PERFORMANCE_STATUSES,
  INFLUENCER_PLATFORMS,
  mockInfluencers,
  normalizePerformanceRecord,
  toNumber,
} from '../../utils/influencerPerformanceUtils'
import './influencers.css'
import './InfluencerPerformancePage.css'

const STORAGE_KEY = 'hr-influencer-performance-v1'

const defaultFilters = {
  query: '',
  startDate: '',
  endDate: '',
  influencerId: 'all',
  platform: 'all',
  campaign: 'all',
  status: 'all',
  performance: 'all',
}

function loadStoredRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.map(normalizePerformanceRecord)
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

export function InfluencerPerformancePage() {
  const { influencers: appInfluencers = [], loading: influencersLoading } = useInfluencers()
  const [records, setRecords] = useState(null)
  const [filters, setFilters] = useState(defaultFilters)
  const [sort, setSort] = useState({ key: 'date', direction: 'desc' })
  const [editingRecord, setEditingRecord] = useState(null)
  const [viewRecord, setViewRecord] = useState(null)

  const influencers = useMemo(() => {
    if (appInfluencers.length > 0) {
      return appInfluencers.map(createInfluencerFromAppRecord)
    }
    return mockInfluencers
  }, [appInfluencers])

  const influencersById = useMemo(
    () => new Map(influencers.map((influencer) => [String(influencer.id), influencer])),
    [influencers],
  )

  useEffect(() => {
    if (records !== null || influencers.length === 0 || influencersLoading) return
    const stored = loadStoredRecords()
    const hasMatchingStoredRecords = stored?.some((record) => influencersById.has(String(record.influencerId)))
    setRecords(hasMatchingStoredRecords ? stored : createMockPerformanceRecords(influencers))
  }, [influencers, influencersById, influencersLoading, records])

  useEffect(() => {
    if (records) saveRecords(records)
  }, [records])

  const allRecords = records || []
  const today = new Date().toISOString().slice(0, 10)

  const campaigns = useMemo(() => (
    Array.from(new Set([
      ...influencers.map((item) => item.assignedCampaign).filter(Boolean),
      ...allRecords.map((item) => item.campaignName).filter(Boolean),
    ])).sort()
  ), [influencers, allRecords])

  const latestRecordByInfluencer = useMemo(() => {
    const map = new Map()
    allRecords.forEach((record) => {
      const current = map.get(String(record.influencerId))
      if (!current || record.date > current.date) map.set(String(record.influencerId), record)
    })
    return map
  }, [allRecords])

  const filteredRecords = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    const visible = allRecords.filter((record) => {
      const influencer = influencersById.get(String(record.influencerId))
      const status = influencer?.status || 'Active'
      const haystack = `${influencer?.name || ''} ${influencer?.username || ''} ${record.platform} ${record.campaignName}`.toLowerCase()
      if (q && !haystack.includes(q)) return false
      if (filters.startDate && record.date < filters.startDate) return false
      if (filters.endDate && record.date > filters.endDate) return false
      if (filters.influencerId !== 'all' && String(record.influencerId) !== String(filters.influencerId)) return false
      if (filters.platform !== 'all' && record.platform !== filters.platform) return false
      if (filters.campaign !== 'all' && record.campaignName !== filters.campaign) return false
      if (filters.status !== 'all' && status !== filters.status) return false
      return true
    })

    const performanceSorted = [...visible].sort((a, b) => (
      filters.performance === 'lowest'
        ? toNumber(a.engagementRate) - toNumber(b.engagementRate)
        : toNumber(b.engagementRate) - toNumber(a.engagementRate)
    ))
    const performanceFiltered = filters.performance === 'all' ? visible : performanceSorted.slice(0, 8)

    return performanceFiltered.sort((a, b) => {
      const influencerA = influencersById.get(String(a.influencerId))
      const influencerB = influencersById.get(String(b.influencerId))
      const valueA = sort.key === 'influencer' ? influencerA?.name : a[sort.key]
      const valueB = sort.key === 'influencer' ? influencerB?.name : b[sort.key]
      return compareValues(valueA, valueB, sort.direction)
    })
  }, [allRecords, filters, influencersById, sort])

  const visibleInfluencers = useMemo(() => (
    influencers.filter((influencer) => {
      if (filters.influencerId !== 'all' && String(influencer.id) !== String(filters.influencerId)) return false
      if (filters.platform !== 'all' && influencer.platform !== filters.platform) return false
      if (filters.campaign !== 'all' && influencer.assignedCampaign !== filters.campaign) return false
      if (filters.status !== 'all' && influencer.status !== filters.status) return false
      if (!filters.query.trim()) return true
      const q = filters.query.trim().toLowerCase()
      return `${influencer.name} ${influencer.username} ${influencer.niche} ${influencer.assignedCampaign}`.toLowerCase().includes(q)
    })
  ), [filters, influencers])

  function setFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function handleSort(key) {
    setSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }))
  }

  function handleSubmit(record) {
    setRecords((prev) => {
      const list = prev || []
      if (record.id) {
        return list.map((item) => item.id === record.id ? record : item)
      }
      return [{ ...record, id: makeRecordId() }, ...list]
    })
    setEditingRecord(null)
  }

  function handleDelete(id) {
    const record = allRecords.find((item) => item.id === id)
    const name = influencersById.get(String(record?.influencerId))?.name || 'this record'
    if (!window.confirm(`Delete performance record for ${name}?`)) return
    setRecords((prev) => (prev || []).filter((item) => item.id !== id))
    if (viewRecord?.id === id) setViewRecord(null)
    if (editingRecord?.id === id) setEditingRecord(null)
  }

  function resetDemoData() {
    const seeded = createMockPerformanceRecords(influencers)
    setRecords(seeded)
    setEditingRecord(null)
    setViewRecord(null)
  }

  return (
    <div className="inf-page ip-page">
      <header className="inf-page-header ip-hero">
        <div>
          <span className="ip-eyebrow"><Gauge size={15} /> Marketing / Social Media</span>
          <h1 className="inf-page-title">Influencer Performance</h1>
          <p className="inf-page-subtitle">Track daily creator views, engagement, cost, and campaign lift from one claymorphic dashboard.</p>
        </div>
        <div className="inf-page-actions">
          <button type="button" className="inf-btn inf-btn--ghost" onClick={resetDemoData}>
            <RefreshCw size={15} /> Reset mock data
          </button>
          <a className="inf-btn inf-btn--primary" href="#ip-performance-form">
            <Plus size={15} /> Add daily numbers
          </a>
        </div>
      </header>

      <InfluencerDashboardCards influencers={influencers} records={allRecords} today={today} />

      <section className="ip-filter-panel">
        <div className="ip-search-box">
          <Search size={17} />
          <input value={filters.query} onChange={(event) => setFilter('query', event.target.value)} placeholder="Search influencer, handle, campaign, platform..." />
        </div>

        <div className="ip-filter-grid">
          <label>
            <span>Date from</span>
            <input type="date" value={filters.startDate} onChange={(event) => setFilter('startDate', event.target.value)} />
          </label>
          <label>
            <span>Date to</span>
            <input type="date" value={filters.endDate} onChange={(event) => setFilter('endDate', event.target.value)} />
          </label>
          <label>
            <span>Influencer</span>
            <select value={filters.influencerId} onChange={(event) => setFilter('influencerId', event.target.value)}>
              <option value="all">All influencers</option>
              {influencers.map((influencer) => (
                <option key={influencer.id} value={influencer.id}>{influencer.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Platform</span>
            <select value={filters.platform} onChange={(event) => setFilter('platform', event.target.value)}>
              <option value="all">All platforms</option>
              {INFLUENCER_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>{platform}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Campaign</span>
            <select value={filters.campaign} onChange={(event) => setFilter('campaign', event.target.value)}>
              <option value="all">All campaigns</option>
              {campaigns.map((campaign) => (
                <option key={campaign} value={campaign}>{campaign}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
              <option value="all">All statuses</option>
              {INFLUENCER_PERFORMANCE_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Performance</span>
            <select value={filters.performance} onChange={(event) => setFilter('performance', event.target.value)}>
              <option value="all">All records</option>
              <option value="best">Best performance</option>
              <option value="lowest">Lowest performance</option>
            </select>
          </label>
        </div>

        <div className="ip-filter-panel__footer">
          <span><Filter size={14} /> Showing {formatNumber(filteredRecords.length)} records and {formatNumber(visibleInfluencers.length)} influencers</span>
          <button type="button" className="inf-btn inf-btn--ghost inf-btn--sm" onClick={() => setFilters(defaultFilters)}>
            <X size={14} /> Clear filters
          </button>
        </div>
      </section>

      <section className="ip-influencer-grid" aria-label="Influencer cards">
        {visibleInfluencers.map((influencer) => (
          <InfluencerCard
            key={influencer.id}
            influencer={influencer}
            latestRecord={latestRecordByInfluencer.get(String(influencer.id))}
          />
        ))}
      </section>

      <InfluencerCharts records={filteredRecords} influencersById={influencersById} />

      <div id="ip-performance-form">
        <InfluencerPerformanceForm
          influencers={influencers}
          editingRecord={editingRecord}
          onSubmit={handleSubmit}
          onCancelEdit={() => setEditingRecord(null)}
        />
      </div>

      <InfluencerPerformanceTable
        records={filteredRecords}
        influencersById={influencersById}
        sort={sort}
        onSort={handleSort}
        onView={setViewRecord}
        onEdit={setEditingRecord}
        onDelete={handleDelete}
      />

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
                ['Followers gained', formatNumber(viewRecord.followersGained)],
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
    </div>
  )
}

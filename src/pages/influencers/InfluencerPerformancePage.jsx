import { useEffect, useMemo, useState } from 'react'
import { Download, Gauge, RefreshCw, Save, Search, X } from 'lucide-react'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { InfluencerCharts } from '../../components/influencers/InfluencerCharts'
import { InfluencerContractTimeline } from '../../components/influencers/InfluencerContractTimeline'
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
  const [sort, setSort] = useState({ key: 'date', direction: 'desc' })
  const [editingRecord, setEditingRecord] = useState(null)
  const [editingContract, setEditingContract] = useState(null)
  const [viewRecord, setViewRecord] = useState(null)
  const [activeMonitorInfluencerId, setActiveMonitorInfluencerId] = useState(null)

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

  const allRecords = useMemo(() => dedupePerformanceRecords(records || []), [records])

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

  function handleSubmit(record) {
    setRecords((prev) => {
      const list = prev || []
      const sameDayIndex = list.findIndex((item) => (
        item.id === record.id ||
        (
          item.contractId === record.contractId &&
          item.date === record.date
        )
      ))
      if (sameDayIndex >= 0) {
        return list.map((item, index) => index === sameDayIndex ? { ...record, id: item.id || record.id || makeRecordId() } : item)
      }
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

  function handleSaveContractEdit() {
    if (!editingContract?.selectedInfluencerId) return
    const selectedInfluencer = influencersById.get(String(editingContract.selectedInfluencerId))
    if (!selectedInfluencer) return
    const contractRecordIds = new Set((editingContract.contract.records || []).map((record) => record.id))
    setRecords((prev) => (prev || []).map((record) => (
      contractRecordIds.has(record.id)
        ? {
            ...record,
            influencerId: selectedInfluencer.id,
            platform: selectedInfluencer.platform,
            campaignName: record.campaignName || selectedInfluencer.assignedCampaign,
            updatedAt: new Date().toISOString(),
          }
        : record
    )))
    setActiveMonitorInfluencerId(selectedInfluencer.id)
    setEditingContract(null)
  }

  function resetDemoData() {
    const seeded = createMockPerformanceRecords(influencers)
    setRecords(seeded)
    setEditingRecord(null)
    setViewRecord(null)
    setActiveMonitorInfluencerId(null)
  }

  return (
    <div className="inf-page ip-page">
      <header className="inf-page-header ip-hero">
        <div>
          <span className="ip-eyebrow"><Gauge size={15} /> Marketing / Social Media</span>
          <h1 className="inf-page-title">Influencer Performance</h1>
          <p className="inf-page-subtitle">Track one contracted video per influencer across 4-5 consecutive daily performance checks.</p>
        </div>
        <div className="inf-page-actions">
          <button type="button" className="inf-btn inf-btn--ghost" onClick={resetDemoData}>
            <RefreshCw size={15} /> Reset mock data
          </button>
        </div>
      </header>

      <InfluencerPerformanceTable
        records={filteredRecords}
        influencersById={influencersById}
        sort={sort}
        onSort={handleSort}
        onView={setViewRecord}
        onEdit={setEditingRecord}
        onDelete={handleDelete}
        activeMonitorInfluencerId={activeMonitorInfluencerId}
        onToggleMonitor={(influencerId) => setActiveMonitorInfluencerId((current) => (
          String(current) === String(influencerId) ? null : influencerId
        ))}
      />

      {activeMonitorContracts.length > 0 ? (
        <InfluencerContractTimeline
          contracts={activeMonitorContracts}
          onEditRecord={setEditingRecord}
          onDeleteRecord={handleDelete}
          onEditContract={(contract) => setEditingContract({
            contract,
            selectedInfluencerId: contract.influencerId,
            query: contract.influencer?.name || '',
          })}
        />
      ) : null}

      <InfluencerCharts records={filteredRecords} influencersById={influencersById} />

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

      {editingRecord ? (
        <div className="ip-modal-backdrop" role="presentation" onClick={() => setEditingRecord(null)}>
          <section className="ip-modal ip-edit-modal" role="dialog" aria-modal="true" aria-label="Edit performance record" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="ip-modal__close" onClick={() => setEditingRecord(null)} aria-label="Close edit record">
              <X size={18} />
            </button>
            <div className="ip-section-heading">
              <span className="ip-section-heading__icon"><Save size={18} /></span>
              <div>
                <h2>Edit Day {getDayNumber(editingRecord.contractStartDate, editingRecord.date) || 1}</h2>
                <p>{influencersById.get(String(editingRecord.influencerId))?.name || 'Influencer'} · {editingRecord.campaignName}</p>
              </div>
            </div>

            <div className="ip-edit-grid">
              {[
                ['Date', 'date', 'date'],
                ['Views', 'views', 'number'],
                ['Shares', 'shares', 'number'],
                ['Likes', 'likes', 'number'],
                ['Comments', 'comments', 'number'],
                ['Saves', 'saves', 'number'],
                ['Followers gained', 'followersGained', 'number'],
                ['Cost', 'cost', 'number'],
              ].map(([label, key, type]) => (
                <label key={key} className="ip-field">
                  <span>{label}</span>
                  <input
                    className="ip-control"
                    type={type}
                    min={type === 'number' ? '0' : undefined}
                    step={key === 'cost' ? '0.01' : undefined}
                    value={editingRecord[key] ?? ''}
                    onChange={(event) => setEditingRecord((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                </label>
              ))}
            </div>

            <label className="ip-field">
              <span>Notes</span>
              <textarea
                className="ip-control ip-control--textarea"
                value={editingRecord.notes || ''}
                onChange={(event) => setEditingRecord((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </label>

            <div className="ip-form__footer">
              <div className="ip-form__hint">Editing only opens when you click a day/row edit icon.</div>
              <div className="ip-form__actions">
                <button type="button" className="inf-btn inf-btn--ghost" onClick={() => setEditingRecord(null)}>
                  <X size={15} /> Cancel
                </button>
                <button
                  type="button"
                  className="inf-btn inf-btn--primary"
                  onClick={() => handleSubmit(normalizePerformanceRecord(editingRecord))}
                >
                  <Save size={15} /> Save
                </button>
              </div>
            </div>
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

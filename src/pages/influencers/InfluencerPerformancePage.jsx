import { ArrowDownWideNarrow, Download, Gauge, Plus, Save, Search, X } from 'lucide-react'
import { InfluencerContractTimeline } from '../../components/influencers/InfluencerContractTimeline'
import { InfluencerPerformanceForm } from '../../components/influencers/InfluencerPerformanceForm'
import { InfluencerLeaderboardPodium } from '../../components/influencers/InfluencerLeaderboardPodium'
import { InfluencerPerformanceTable } from '../../components/influencers/InfluencerPerformanceTable'
import { useAuth, canMutateInfluencerPerformance } from '../../contexts/AuthContext'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'
import { PERFORMANCE_SORT_OPTIONS } from './influencerPerformanceScreenShared'
import { useInfluencerPerformanceScreen } from './useInfluencerPerformanceScreen'
import './influencers.css'
import './InfluencerPerformancePage.css'

export function InfluencerPerformancePage() {
  const {
    user,
    authLoading,
    influencers,
    influencersById,
    syncHint,
    setSyncHint,
    sort,
    editingRecord,
    setEditingRecord,
    editingContract,
    setEditingContract,
    viewRecord,
    setViewRecord,
    isAddRecordOpen,
    setIsAddRecordOpen,
    activeMonitorInfluencerId,
    setActiveMonitorInfluencerId,
    activeMonitorContractId,
    contractTimelineAnchorRef,
    canWritePerformance,
    showNetProfitColumn,
    filteredContracts,
    videoContracts,
    rankingsByContractId,
    activeMonitorContracts,
    handleSort,
    handleSortPreset,
    handleSubmit,
    handleDelete,
    handleSaveContractEdit,
    handlePodiumSelectContract,
    toggleActiveMonitorContract,
  } = useInfluencerPerformanceScreen()

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
            <p>Rank grouped influencer rows by top-to-low metrics like views, likes, sales, cost, or newest records.</p>
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
              {PERFORMANCE_SORT_OPTIONS.filter((option) => !option.adminOnly || showNetProfitColumn).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="ip-performance-sort-panel__quick" aria-label="Quick ranking filters">
            {[
              ['rank:asc', 'Best overall'],
              ['views:desc', 'Top views'],
              ['likes:desc', 'Top likes'],
              ['salesAed:desc', 'Top sales'],
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

      <InfluencerLeaderboardPodium
        videoContracts={videoContracts}
        rankingsByContractId={rankingsByContractId}
        onSelectContract={handlePodiumSelectContract}
      />

      <InfluencerPerformanceTable
        records={filteredContracts}
        influencersById={influencersById}
        rankingByRecordId={rankingsByContractId}
        showNetProfitColumn={showNetProfitColumn}
        sort={sort}
        onSort={handleSort}
        onView={(row) => row?.latest && setViewRecord(row.latest)}
        onEdit={canWritePerformance ? (row) => row?.latest && setEditingRecord(row.latest) : undefined}
        onDelete={canWritePerformance ? (id) => {
          const row = filteredContracts.find((item) => item.id === id)
          if (row?.latest?.id) handleDelete(row.latest.id)
        } : undefined}
        activeMonitorInfluencerId={activeMonitorContractId || activeMonitorInfluencerId}
        onToggleMonitor={(_influencerId, row) => toggleActiveMonitorContract(row)}
      />

      <div ref={contractTimelineAnchorRef} className="ip-contract-timeline-anchor">
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
      </div>

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
                ['Sales AED', formatNumber(viewRecord.salesAed, { currency: 'AED' })],
                ...(showNetProfitColumn
                  ? [['Net profit AED', formatNumber(viewRecord.netProfitAed, { currency: 'AED' })]]
                  : []),
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
                      <em>{influencer.username}</em>
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

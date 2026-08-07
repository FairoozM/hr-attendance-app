import { Gauge, Plus, UserRound, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { InfluencerLeaderboardPodium } from '../../components/influencers/InfluencerLeaderboardPodium'
import { InfluencerPerformanceDebugBoundary } from '../../components/influencers/InfluencerPerformanceDebugBoundary'
import { InfluencerPerformanceTable } from '../../components/influencers/InfluencerPerformanceTable'
import { InfluencerPerformanceContractPanel } from '../../components/influencers/InfluencerPerformanceContractPanel'
import { InfluencerPerformanceModals } from '../../components/influencers/InfluencerPerformanceModals'
import { useAuth, canMutateInfluencerPerformance } from '../../contexts/AuthContext'
import type { InfluencerContractRow } from '../../types/influencer'
import { useInfluencerPerformanceScreen } from './useInfluencerPerformanceScreen'
import { influencerProfileUrl } from './influencerPaymentsRoiUtils'
import {
  INFLUENCER_PERFORMANCE_SECTION_LABELS,
  INFLUENCER_PERFORMANCE_SECTIONS,
  isPerformanceSectionActive,
  type InfluencerPerformanceSection,
} from './influencerPerformanceSections'
import './influencers.css'
import './InfluencerPerformancePage.css'
import './InfluencerContracts.css'

export function InfluencerPerformancePage() {
  return (
    <InfluencerPerformanceDebugBoundary>
      <InfluencerPerformancePageBody />
    </InfluencerPerformanceDebugBoundary>
  )
}

function InfluencerPerformancePageBody() {
  const navigate = useNavigate()
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
    isAddRecordOpen,
    setIsAddRecordOpen,
    activeMonitorContractId,
    setActiveMonitorContractId,
    contractTimelineQuery,
    setContractTimelineQuery,
    rankingDatePreset,
    setRankingDatePreset,
    rankingCustomFrom,
    setRankingCustomFrom,
    rankingCustomTo,
    setRankingCustomTo,
    contractTimelineOptions,
    contractTimelineAnchorRef,
    activeSection,
    setActiveSection,
    canWritePerformance,
    showNetProfitColumn,
    filteredContracts,
    influencerFilterId,
    videoContracts,
    rankingsByContractId,
    activeMonitorContracts,
    handleSort,
    handleSubmit,
    handleDelete,
    handleSaveContractEdit,
    handlePodiumSelectContract,
    toggleActiveMonitorContract,
  } = useInfluencerPerformanceScreen()

  function openAddRecord() {
    if (!canWritePerformance) {
      setSyncHint('This account cannot save Influencer Performance to the server. Ask an admin to enable Influencer Performance access.')
      return
    }
    setIsAddRecordOpen(true)
  }

  const filteredInfluencer = influencerFilterId
    ? influencersById.get(String(influencerFilterId))
    : undefined

  return (
    <div className="ip-page ip-performance-layout">
      {filteredInfluencer ? (
        <div className="inf-contracts__filter-banner">
          <UserRound size={14} aria-hidden />
          <span>Filtered by: <strong>{filteredInfluencer.name}</strong></span>
          <Link to="/influencers/performance" className="inf-btn inf-btn--ghost inf-btn--xs">
            <X size={12} aria-hidden /> Clear filter
          </Link>
          <Link to={influencerProfileUrl(String(filteredInfluencer.id))} className="inf-btn inf-btn--ghost inf-btn--xs">
            View profile
          </Link>
        </div>
      ) : null}

      <header className="inf-page-header ip-hero ip-performance-desktop-only">
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
      </header>

      <header className="ip-performance-mobile-header ip-performance-mobile-only">
        <div className="ip-performance-mobile-header__copy">
          <span className="ip-eyebrow"><Gauge size={14} /> Phone view</span>
          <h1 className="inf-page-title">Influencer performance</h1>
          <p className="inf-page-subtitle">Open contract timelines quickly and manage daily check-ins from phone view.</p>
          {syncHint ? (
            <p className="inf-page-subtitle ip-sync-hint" role="status">{syncHint}</p>
          ) : null}
          {!authLoading && user && !canMutateInfluencerPerformance(user) ? (
            <p className="inf-page-subtitle ip-sync-hint ip-sync-hint--muted" role="note">
              View-only: ask an admin for Influencer Performance access to add or edit records.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="inf-btn inf-btn--primary ip-performance-mobile-header__add"
          onClick={openAddRecord}
          disabled={!canWritePerformance}
          title={!canWritePerformance ? 'Requires Influencer Performance access' : undefined}
        >
          <Plus size={15} /> Add
        </button>
      </header>

      <nav className="ip-performance-section-nav" aria-label="Performance sections">
        {INFLUENCER_PERFORMANCE_SECTIONS.map((section: InfluencerPerformanceSection) => (
          <button
            key={section}
            type="button"
            className={`ip-performance-section-nav__btn ${isPerformanceSectionActive(activeSection, section) ? 'ip-performance-section-nav__btn--active' : ''}`}
            aria-current={isPerformanceSectionActive(activeSection, section) ? 'page' : undefined}
            onClick={() => setActiveSection(section)}
          >
            {INFLUENCER_PERFORMANCE_SECTION_LABELS[section]}
          </button>
        ))}
      </nav>

      {isPerformanceSectionActive(activeSection, 'leaderboard') ? (
        <div className="ip-performance-desktop-only">
          <InfluencerLeaderboardPodium
            videoContracts={videoContracts}
            rankingsByContractId={rankingsByContractId}
            onSelectContract={handlePodiumSelectContract}
          />
        </div>
      ) : null}

      {isPerformanceSectionActive(activeSection, 'ranking') ? (
        <div className="ip-performance-desktop-only">
          <InfluencerPerformanceTable
            records={filteredContracts}
            influencersById={influencersById}
            rankingsByContractId={rankingsByContractId}
            showNetProfitColumn={showNetProfitColumn}
            sort={sort}
            onSort={handleSort}
            datePreset={rankingDatePreset}
            onDatePresetChange={setRankingDatePreset}
            rankingCustomFrom={rankingCustomFrom}
            rankingCustomTo={rankingCustomTo}
            onRankingCustomFromChange={setRankingCustomFrom}
            onRankingCustomToChange={setRankingCustomTo}
            showRankingSummary
            onEdit={canWritePerformance ? (row) => row?.latest && setEditingRecord(row.latest) : undefined}
            onDelete={canWritePerformance ? (contractId) => {
              const row = filteredContracts.find((item) => String(item.id) === String(contractId))
              const sortedRecords = [...(row?.records || [])]
                .filter((r): r is NonNullable<typeof r> => Boolean(r && r.id))
                .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
              const rid = row?.latest?.id || sortedRecords[sortedRecords.length - 1]?.id
              if (rid) handleDelete(rid)
            } : undefined}
            activeMonitorInfluencerId={activeMonitorContractId}
            onToggleMonitor={(_influencerId, row: InfluencerContractRow) => toggleActiveMonitorContract(row)}
            onInfluencerClick={(influencerId) => navigate(influencerProfileUrl(influencerId))}
          />
        </div>
      ) : null}

      {isPerformanceSectionActive(activeSection, 'timeline') ? (
        <InfluencerPerformanceContractPanel
          contractTimelineAnchorRef={contractTimelineAnchorRef}
          contractTimelineQuery={contractTimelineQuery}
          onContractTimelineQueryChange={setContractTimelineQuery}
          contractTimelineOptions={contractTimelineOptions}
          activeMonitorContractId={activeMonitorContractId}
          onSelectContract={setActiveMonitorContractId}
          activeMonitorContracts={activeMonitorContracts}
          canWritePerformance={canWritePerformance}
          onOpenAddRecord={openAddRecord}
          showAddRecordInHeading
          onEditRecord={canWritePerformance ? setEditingRecord : undefined}
          onDeleteRecord={canWritePerformance ? handleDelete : undefined}
          onSaveRecord={canWritePerformance ? handleSubmit : undefined}
          onSetEditingContract={canWritePerformance ? setEditingContract : undefined}
        />
      ) : null}

      <InfluencerPerformanceModals
        influencers={influencers}
        influencersById={influencersById}
        isAddRecordOpen={isAddRecordOpen}
        defaultInfluencerId={influencerFilterId}
        onCloseAddRecord={() => setIsAddRecordOpen(false)}
        editingRecord={editingRecord}
        onCloseEditingRecord={() => setEditingRecord(null)}
        editingContract={editingContract}
        onCloseEditingContract={() => setEditingContract(null)}
        onSetEditingContract={setEditingContract}
        onSubmitRecord={handleSubmit}
        onSaveContractEdit={handleSaveContractEdit}
      />
    </div>
  )
}

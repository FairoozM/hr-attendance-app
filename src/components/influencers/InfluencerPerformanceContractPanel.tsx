import { Plus, Search } from 'lucide-react'
import type { RefObject } from 'react'
import { InfluencerContractTimeline } from './InfluencerContractTimeline'
import { influencerInitials } from './influencerPerformanceTableShared'
import { fmtDMYRange } from '../../utils/dateFormat'
import type {
  InfluencerContract,
  InfluencerPerformance,
  InfluencerPerformanceInput,
} from '../../types/influencer'
import { CONTRACT_TIMELINE_RESULTS_CAP } from '../../pages/influencers/influencerPerformanceScreenShared'
import type { EditingContractState } from '../../pages/influencers/useInfluencerPerformanceScreen'

export type InfluencerPerformanceContractPanelProps = {
  contractTimelineAnchorRef: RefObject<HTMLDivElement | null>
  contractTimelineQuery: string
  onContractTimelineQueryChange: (value: string) => void
  contractTimelineOptions: InfluencerContract[]
  activeMonitorContractId: string | number | null
  onSelectContract: (contractId: string | number) => void
  activeMonitorContracts: InfluencerContract[]
  canWritePerformance: boolean
  onOpenAddRecord?: () => void
  showAddRecordInHeading?: boolean
  onEditRecord?: (record: InfluencerPerformance | InfluencerPerformanceInput) => void
  onDeleteRecord?: (id: string | number) => void
  onSaveRecord?: (record: InfluencerPerformanceInput) => void
  onEditContract?: (contract: InfluencerContract) => void
  onSetEditingContract?: (state: EditingContractState | null) => void
}

export function InfluencerPerformanceContractPanel({
  contractTimelineAnchorRef,
  contractTimelineQuery,
  onContractTimelineQueryChange,
  contractTimelineOptions,
  activeMonitorContractId,
  onSelectContract,
  activeMonitorContracts,
  canWritePerformance,
  onOpenAddRecord,
  showAddRecordInHeading = true,
  onEditRecord,
  onDeleteRecord,
  onSaveRecord,
  onEditContract,
  onSetEditingContract,
}: InfluencerPerformanceContractPanelProps) {
  const handleEditContract = onEditContract ?? (onSetEditingContract
    ? (contract: InfluencerContract) => {
        onSetEditingContract({
          contract,
          selectedInfluencerId: contract.influencerId,
          query: contract.influencer?.name || '',
        })
      }
    : undefined)

  return (
    <div ref={contractTimelineAnchorRef} className="ip-contract-timeline-anchor ip-performance-contract-panel">
      <section className="ip-contract-pin-panel" aria-label="Pinned contract timeline search">
        <div className="ip-section-heading ip-contract-pin-panel__heading">
          <div className="ip-contract-pin-panel__heading-copy">
            <span className="ip-section-heading__icon"><Search size={18} /></span>
            <div>
              <h2>Contract timeline</h2>
              <p>Search by influencer name or contract dates as text, then select one contract to populate the timeline.</p>
            </div>
          </div>
          {showAddRecordInHeading && onOpenAddRecord ? (
            <button
              type="button"
              className="inf-btn inf-btn--primary ip-contract-pin-panel__add-record ip-performance-desktop-only"
              onClick={onOpenAddRecord}
              disabled={!canWritePerformance}
              title={!canWritePerformance ? 'Requires Influencer Performance access' : undefined}
            >
              <Plus size={15} /> Add new record
            </button>
          ) : null}
        </div>
        <div className="ip-contract-search">
          <label className="ip-field">
            <span>Search contracts</span>
            <input
              className="ip-control"
              value={contractTimelineQuery}
              onChange={(event) => onContractTimelineQueryChange(event.target.value)}
              placeholder="Influencer name, handle, campaign, or date"
            />
          </label>
          {contractTimelineOptions.length > CONTRACT_TIMELINE_RESULTS_CAP ? (
            <p className="ip-contract-search__cap" role="status">
              Showing first {CONTRACT_TIMELINE_RESULTS_CAP} of {contractTimelineOptions.length} matches — refine your search.
            </p>
          ) : null}
          <div className="ip-contract-search__results">
            {contractTimelineOptions.slice(0, CONTRACT_TIMELINE_RESULTS_CAP).map((contract) => (
              <button
                key={contract.id}
                type="button"
                className={`ip-contract-search__item ${String(activeMonitorContractId || '') === String(contract.id) ? 'ip-contract-search__item--active' : ''}`}
                onClick={() => onSelectContract(contract.id)}
              >
                <span className="ip-contract-search__avatar" aria-hidden="true">
                  <span>{influencerInitials(contract.influencer?.name)}</span>
                  {contract.influencer?.profileImage ? (
                    <img src={contract.influencer.profileImage} alt="" />
                  ) : null}
                </span>
                <span className="ip-contract-search__copy">
                  <strong>{contract.influencer?.name || 'Influencer'}</strong>
                  <em>{contract.campaignName || contract.videoTitle || 'Contract'}</em>
                </span>
                <span className="ip-contract-search__meta">
                  <b>{fmtDMYRange(contract.contractStartDate, contract.latest?.date || contract.latestDate, ' - ')}</b>
                  <small>{contract.recordedDays || 0} of {contract.monitoringDays || 5} check-ins</small>
                </span>
              </button>
            ))}
            {contractTimelineOptions.length === 0 ? (
              <div className="ip-empty-row">No contracts match this search.</div>
            ) : null}
          </div>
        </div>
        {activeMonitorContracts.length > 0 ? (
          <InfluencerContractTimeline
            contracts={activeMonitorContracts}
            onEditRecord={canWritePerformance ? onEditRecord : undefined}
            onDeleteRecord={canWritePerformance ? onDeleteRecord : undefined}
            onSaveRecord={canWritePerformance ? onSaveRecord : undefined}
            onEditContract={canWritePerformance ? handleEditContract : undefined}
          />
        ) : (
          <div className="ip-empty-row">Select a contract above to show its timeline.</div>
        )}
      </section>
    </div>
  )
}

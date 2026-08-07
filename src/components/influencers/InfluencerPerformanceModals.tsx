import { Save, Search, X } from 'lucide-react'
import { InfluencerPerformanceForm } from './InfluencerPerformanceForm'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import type {
  InfluencerPerformance,
  InfluencerPerformanceInput,
  InfluencerPerformanceProfile,
} from '../../types/influencer'
import type { EditingContractState } from '../../pages/influencers/useInfluencerPerformanceScreen'

export type InfluencerPerformanceModalsProps = {
  influencers: InfluencerPerformanceProfile[]
  influencersById: Map<string, InfluencerPerformanceProfile>
  isAddRecordOpen: boolean
  defaultInfluencerId?: string
  onCloseAddRecord: () => void
  editingRecord: InfluencerPerformance | InfluencerPerformanceInput | null
  onCloseEditingRecord: () => void
  editingContract: EditingContractState | null
  onCloseEditingContract: () => void
  onSetEditingContract: (updater: (prev: EditingContractState | null) => EditingContractState | null) => void
  onSubmitRecord: (record: InfluencerPerformanceInput) => void
  onSaveContractEdit: () => void
}

export function InfluencerPerformanceModals({
  influencers,
  influencersById,
  isAddRecordOpen,
  defaultInfluencerId = '',
  onCloseAddRecord,
  editingRecord,
  onCloseEditingRecord,
  editingContract,
  onCloseEditingContract,
  onSetEditingContract,
  onSubmitRecord,
  onSaveContractEdit,
}: InfluencerPerformanceModalsProps) {
  const selectedInfluencer = editingContract
    ? influencersById.get(String(editingContract.selectedInfluencerId))
    : undefined

  return (
    <>
      {isAddRecordOpen ? (
        <div className="ip-modal-backdrop" role="presentation" onClick={onCloseAddRecord}>
          <section className="ip-modal ip-add-record-modal" role="dialog" aria-modal="true" aria-label="Add performance record" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="ip-modal__close" onClick={onCloseAddRecord} aria-label="Close add record">
              <X size={18} />
            </button>
            <InfluencerPerformanceForm
              influencers={influencers}
              editingRecord={null}
              defaultInfluencerId={defaultInfluencerId}
              onSubmit={onSubmitRecord}
              onCancelEdit={onCloseAddRecord}
            />
          </section>
        </div>
      ) : null}

      {editingRecord ? (
        <div className="ip-modal-backdrop" role="presentation" onClick={onCloseEditingRecord}>
          <section className="ip-modal ip-edit-modal" role="dialog" aria-modal="true" aria-label="Edit performance record" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="ip-modal__close" onClick={onCloseEditingRecord} aria-label="Close edit record">
              <X size={18} />
            </button>
            <InfluencerPerformanceForm
              influencers={influencers}
              editingRecord={editingRecord}
              onSubmit={onSubmitRecord}
              onCancelEdit={onCloseEditingRecord}
            />
          </section>
        </div>
      ) : null}

      {editingContract ? (
        <div className="ip-modal-backdrop" role="presentation" onClick={onCloseEditingContract}>
          <section className="ip-modal ip-contract-edit-modal" role="dialog" aria-modal="true" aria-label="Edit contract influencer" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="ip-modal__close" onClick={onCloseEditingContract} aria-label="Close contract edit">
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
                onChange={(event) => onSetEditingContract((prev) => (
                  prev ? { ...prev, query: event.target.value } : prev
                ))}
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
                    onClick={() => onSetEditingContract((prev) => (
                      prev ? { ...prev, selectedInfluencerId: influencer.id, query: influencer.name } : prev
                    ))}
                  >
                    <span>
                      <strong>{influencer.name}</strong>
                      <em>{influencer.username}</em>
                    </span>
                    <b>{formatNumber(influencer.followers)} followers</b>
                  </button>
                ))}
            </div>

            {selectedInfluencer ? (
              <div className="ip-selected-influencer">
                <span>Selected</span>
                <strong>{selectedInfluencer.name}</strong>
                <em>{formatNumber(selectedInfluencer.followers)} followers will show in the monitor.</em>
              </div>
            ) : null}

            <div className="ip-form__footer">
              <div className="ip-form__hint">This updates all saved days for this video contract.</div>
              <div className="ip-form__actions">
                <button type="button" className="inf-btn inf-btn--ghost" onClick={onCloseEditingContract}>
                  <X size={15} /> Cancel
                </button>
                <button type="button" className="inf-btn inf-btn--primary" onClick={onSaveContractEdit}>
                  <Save size={15} /> Save influencer
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}

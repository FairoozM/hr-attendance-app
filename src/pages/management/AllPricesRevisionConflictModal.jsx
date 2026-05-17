import { Modal } from '../../components/Modal'

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.listName]
 * @param {() => void} props.onClose
 * @param {() => void} props.onReloadSaved
 * @param {() => void} props.onSaveAsNew
 */
export function AllPricesRevisionConflictModal({
  open,
  listName,
  onClose,
  onReloadSaved,
  onSaveAsNew,
}) {
  return (
    <Modal open={open} onClose={onClose} title="Saved list changed elsewhere" panelClassName="ap-ec-modal-panel">
      <div className="ap-ec-modal-body">
        <p>
          <strong>{listName || 'This saved list'}</strong> was updated in another tab or session. Reload the saved
          version or save your current draft as a new list.
        </p>
      </div>
      <div className="ap-ec-modal-actions ap-ec-modal-actions--stack">
        <button type="button" className="btn btn--primary" onClick={onReloadSaved}>
          Reload Saved List
        </button>
        <button type="button" className="btn btn--ghost" onClick={onSaveAsNew}>
          Save Current Draft as New List
        </button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}

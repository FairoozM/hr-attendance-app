import { Modal } from '../../components/Modal'

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.currentListName
 * @param {() => void} props.onClose
 * @param {() => void} props.onUpdateCurrent
 * @param {() => void} props.onSaveAsNew
 * @param {() => void} props.onDiscardAndLoad
 */
export function AllPricesLoadGuardModal({
  open,
  currentListName,
  onClose,
  onUpdateCurrent,
  onSaveAsNew,
  onDiscardAndLoad,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Unsaved changes to “${currentListName || 'active list'}”`}
      panelClassName="ap-ec-modal-panel"
    >
      <div className="ap-ec-modal-body">
        <p>
          Your working draft has changes that are not saved to this list. Choose how to continue before loading another
          list.
        </p>
      </div>
      <div className="ap-ec-modal-actions ap-ec-modal-actions--stack">
        <button type="button" className="btn btn--primary" onClick={onUpdateCurrent}>
          Update Current List
        </button>
        <button type="button" className="btn btn--ghost" onClick={onSaveAsNew}>
          Save as New Price List
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDiscardAndLoad}>
          Discard Changes and Load
        </button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
